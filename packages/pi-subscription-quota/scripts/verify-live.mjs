import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgentDir, ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import subscriptionQuota from '../extensions/subscription-quota/index.ts';
import { getSubscriptionAccessToken } from '../src/subscription-quota.ts';

const OPTIONAL_NUMBER = Type.Optional(Type.Union([Type.Number(), Type.Null()]));
const ZAI_SCHEMA = Type.Object({
	success: Type.Literal(true),
	code: Type.Literal(200),
	data: Type.Object({
		limits: Type.Array(
			Type.Object({
				type: Type.String(),
				unit: Type.Integer(),
				number: Type.Integer(),
				percentage: Type.Integer(),
				usage: OPTIONAL_NUMBER,
				currentValue: OPTIONAL_NUMBER,
				remaining: OPTIONAL_NUMBER,
				nextResetTime: OPTIONAL_NUMBER,
			}),
		),
	}),
});
const COUNT = Type.Union([Type.String({ pattern: '^\\d+$' }), Type.Integer({ minimum: 0 })]);
const DETAIL_SCHEMA = Type.Object({
	limit: COUNT,
	used: Type.Optional(COUNT),
	remaining: Type.Optional(COUNT),
	resetTime: Type.String(),
});
const POOL_SCHEMA = Type.Object({
	used_ratio: Type.Optional(Type.Number({ minimum: 0 })),
	reset_time: Type.Optional(Type.String()),
});
const KIMI_SCHEMA = Type.Object({
	usage: Type.Optional(Type.Union([DETAIL_SCHEMA, Type.Null()])),
	limits: Type.Optional(
		Type.Array(
			Type.Object({
				window: Type.Object({ duration: Type.Integer({ minimum: 1 }), timeUnit: Type.String() }),
				detail: DETAIL_SCHEMA,
			}),
		),
	),
	usages: Type.Optional(
		Type.Object({
			limit_5h: Type.Optional(POOL_SCHEMA),
			limit_7d: Type.Optional(POOL_SCHEMA),
			limit_month_total: Type.Optional(POOL_SCHEMA),
		}),
	),
});

function resetMillis(timestamp) {
	const millis = Date.parse(timestamp);
	if (!Number.isFinite(millis)) {
		throw new Error('Verification invalid reset timestamp');
	}
	return millis;
}

/** Extract coding and MCP percentages and UTC resets from a raw ZAI limits response. */
export function directZaiWindows(payload) {
	if (!Value.Check(ZAI_SCHEMA, payload)) {
		throw new Error('Verification unsupported z.ai payload');
	}
	return payload.data.limits
		.filter((limit) => ['TOKENS_LIMIT', 'CREDIT_LIMIT', 'TIME_LIMIT'].includes(limit.type))
		.map((limit) => {
			const multipliers = { 1: 1440, 3: 60, 5: 1, 6: 10080 };
			const minutes =
				limit.type === 'TIME_LIMIT' && limit.unit === 5 && limit.number === 1
					? 43200
					: multipliers[limit.unit] * limit.number;
			let usedPct = limit.percentage;
			if (limit.usage > 0 && (limit.currentValue != null || limit.remaining != null)) {
				const used = Math.max(
					limit.currentValue ?? 0,
					limit.remaining == null ? 0 : limit.usage - limit.remaining,
				);
				usedPct = (100 * Math.min(limit.usage, Math.max(0, used))) / limit.usage;
			}
			const window = { minutes, remainingPct: 100 - Math.min(100, Math.max(0, usedPct)) };
			if (limit.nextResetTime != null) {
				window.resetAt = new Date(limit.nextResetTime).toISOString();
			}
			if (limit.type === 'TIME_LIMIT') {
				window.kind = 'mcp';
			}
			return window;
		});
}

function countEvidence(detail) {
	if (!detail) {
		return undefined;
	}
	const limit = Number(detail.limit);
	const used = detail.used === undefined ? limit - Number(detail.remaining) : Number(detail.used);
	if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(used) || used < 0) {
		return undefined;
	}
	return { usedPct: Math.min(100, (used / limit) * 100), resetAt: detail.resetTime, used, limit };
}

/** Compare Kimi count and ratio pools separately; matching zero placeholders may use counts. */
export function directKimiEvidence(payload) {
	if (!Value.Check(KIMI_SCHEMA, payload)) {
		throw new Error('Verification unsupported Kimi payload');
	}
	const weekly = countEvidence(payload.usage);
	const units = { TIME_UNIT_MINUTE: 1, TIME_UNIT_HOUR: 60, TIME_UNIT_DAY: 1440 };
	const rate = payload.limits?.find(
		(limit) => units[limit.window.timeUnit] * limit.window.duration === 300,
	);
	const session = countEvidence(rate?.detail);
	const pools = payload.usages;
	const windows = [];
	for (const [minutes, count, pool] of [
		[10080, weekly, pools?.limit_7d],
		[300, session, pools?.limit_5h],
		[43200, undefined, pools?.limit_month_total],
	]) {
		const ratio = pool?.used_ratio;
		const sameReset =
			count &&
			pool?.reset_time &&
			Math.abs(resetMillis(count.resetAt) - resetMillis(pool.reset_time)) <= 2000;
		const fallback =
			ratio === 0 && count?.used > 0 && weekly && !pools?.limit_month_total && sameReset;
		if (ratio !== undefined && !fallback) {
			windows.push({
				minutes,
				remainingPct: 100 * (1 - Math.min(1, ratio)),
				resetAt: pool.reset_time,
			});
		} else if (count) {
			windows.push({ minutes, remainingPct: 100 - count.usedPct, resetAt: count.resetAt });
		}
	}
	const weeklyRatio = pools?.limit_7d?.used_ratio;
	const warning =
		weekly &&
		weeklyRatio !== undefined &&
		Math.abs(weekly.usedPct - Math.min(1, weeklyRatio) * 100) > 0.001
			? {
					reason: 'kimi_weekly_count_ratio_disagreement',
					countUsed: weekly.used,
					countLimit: weekly.limit,
					ratioUsed: weeklyRatio,
					matchingReset: Boolean(
						pools.limit_7d.reset_time &&
						Math.abs(resetMillis(weekly.resetAt) - resetMillis(pools.limit_7d.reset_time)) <= 2000,
					),
				}
			: undefined;
	return { windows, warning };
}

/** Check the live tool against direct windows, including omissions and reset clocks. */
export function compareQuotaWindows(actual, expected) {
	if (actual.length !== expected.length) {
		return false;
	}
	return expected.every((window) =>
		actual.some(
			(observed) =>
				observed.minutes === window.minutes &&
				observed.kind === window.kind &&
				Number.isFinite(observed.remainingPct) &&
				Math.abs(observed.remainingPct - window.remainingPct) <= 0.001 &&
				Boolean(observed.resetAt) === Boolean(window.resetAt) &&
				(!window.resetAt ||
					Math.abs(resetMillis(observed.resetAt) - resetMillis(window.resetAt)) <= 2000),
		),
	);
}

async function directUsage(registry, provider, url, signal) {
	const credential = await registry.getProviderAuth(provider);
	const accessToken = getSubscriptionAccessToken(credential);
	if (!accessToken) {
		throw new Error('Verification missing provider auth');
	}
	const response = await fetch(url, {
		headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
		signal,
	});
	if (!response.ok) {
		throw new Error('Verification direct usage request failed');
	}
	const text = await response.text();
	if (text.length > 256 * 1024) {
		throw new Error('Verification direct payload too large');
	}
	return JSON.parse(text);
}

async function verifyLive() {
	const runtime = await ModelRuntime.create({
		authPath: join(getAgentDir(), 'auth.json'),
		modelsPath: join(getAgentDir(), 'models.json'),
		refreshOnCreate: false,
	});
	const registry = new ModelRegistry(runtime);
	let tool;
	subscriptionQuota({
		registerTool(definition) {
			tool = definition;
		},
	});
	if (!tool) {
		throw new Error('Verification subscription quota not registered');
	}
	const signal = AbortSignal.timeout(60_000);
	const [result, zai, kimi] = await Promise.all([
		tool.execute('verify-live', {}, signal, undefined, { modelRegistry: registry }),
		directUsage(registry, 'zai', 'https://api.z.ai/api/monitor/usage/quota/limit', signal),
		directUsage(registry, 'kimi-coding', 'https://api.kimi.com/coding/v1/usages', signal),
	]);
	if (
		!Value.Check(tool.outputSchema, result.structuredContent) ||
		result.content.length !== 1 ||
		result.content[0].text !== JSON.stringify(result.structuredContent)
	) {
		throw new Error('Verification tool output schema mismatch');
	}
	const kimiEvidence = directKimiEvidence(kimi);
	const comparisons = [];
	for (const [provider, expected] of [
		['zai', directZaiWindows(zai)],
		['kimi-coding', kimiEvidence.windows],
	]) {
		const observation = result.structuredContent.find((row) => row.provider === provider);
		comparisons.push({
			provider,
			matched:
				observation?.status === 'fresh' && compareQuotaWindows(observation.windows, expected),
		});
	}
	process.stdout.write(
		JSON.stringify({
			observations: result.structuredContent,
			comparisons,
			warnings: kimiEvidence.warning ? [kimiEvidence.warning] : [],
		}) + '\n',
	);
	if (
		comparisons.some((comparison) => !comparison.matched) ||
		result.structuredContent.some((row) => row.status !== 'fresh')
	) {
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		await verifyLive();
	} catch {
		process.stderr.write(
			'Subscription quota live verification failed; no raw error details emitted.\n',
		);
		process.exitCode = 1;
	}
}
