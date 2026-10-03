import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
	ExtensionAPI,
	ExtensionToolContext,
	ModelRegistry,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const PROVIDER_SCHEMA = Type.Union([
	Type.Literal('openai'),
	Type.Literal('zai'),
	Type.Literal('kimi-coding'),
]);
const PARAMETERS_SCHEMA = Type.Object(
	{
		providers: Type.Optional(
			Type.Array(PROVIDER_SCHEMA, { minItems: 1, maxItems: 3, uniqueItems: true }),
		),
	},
	{ additionalProperties: false },
);
const DEFAULT_PROVIDERS: QuotaProvider[] = ['openai', 'zai', 'kimi-coding'];
const CLI_PROVIDERS = { openai: 'codex', zai: 'zai', 'kimi-coding': 'kimi' } as const;
const WINDOW_SCHEMA = Type.Object(
	{
		minutes: Type.Optional(Type.Integer({ minimum: 1 })),
		remainingPct: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
		resetAt: Type.Optional(Type.String()),
		kind: Type.Optional(Type.Literal('mcp')),
		id: Type.Optional(Type.String()),
		note: Type.Optional(Type.Literal('legacy_counts')),
	},
	{ additionalProperties: false },
);
const OBSERVATION_FIELDS = {
	provider: PROVIDER_SCHEMA,
	source: Type.Optional(Type.Literal('codex')),
	observedAt: Type.Optional(Type.String()),
	windows: Type.Array(WINDOW_SCHEMA),
};
const OUTPUT_SCHEMA = Type.Array(
	Type.Union([
		Type.Object(
			{ ...OBSERVATION_FIELDS, status: Type.Literal('fresh'), observedAt: Type.String() },
			{ additionalProperties: false },
		),
		Type.Object(
			{
				...OBSERVATION_FIELDS,
				status: Type.Literal('stale'),
				reason: Type.Union([Type.Literal('timestamp'), Type.Literal('reset_elapsed')]),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				...OBSERVATION_FIELDS,
				status: Type.Literal('unknown'),
				reason: Type.Union([Type.Literal('timestamp_missing'), Type.Literal('window_incomplete')]),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				provider: PROVIDER_SCHEMA,
				status: Type.Literal('unavailable'),
				reason: Type.Union([
					Type.Literal('auth'),
					Type.Literal('codexbar_missing'),
					Type.Literal('timeout'),
					Type.Literal('cancelled'),
					Type.Literal('bad_output'),
					Type.Literal('provider_error'),
					Type.Literal('output_limit'),
					Type.Literal('local_error'),
				]),
			},
			{ additionalProperties: false },
		),
	]),
);
type QuotaProvider = Static<typeof PROVIDER_SCHEMA>;
type QuotaWindow = Static<typeof WINDOW_SCHEMA>;
type ProviderQuota = Static<typeof OUTPUT_SCHEMA>[number];
type FailureReason = Extract<ProviderQuota, { status: 'unavailable' }>['reason'];

const NULLABLE_STRING = Type.Union([Type.String(), Type.Null()]);
const RAW_WINDOW_SCHEMA = Type.Object({
	usedPercent: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()])),
	windowMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
	resetsAt: Type.Optional(NULLABLE_STRING),
	resetDescription: Type.Optional(NULLABLE_STRING),
	isSyntheticPlaceholder: Type.Optional(Type.Boolean()),
});
const RAW_USAGE_SCHEMA = Type.Object({
	primary: Type.Optional(Type.Union([RAW_WINDOW_SCHEMA, Type.Null()])),
	secondary: Type.Optional(Type.Union([RAW_WINDOW_SCHEMA, Type.Null()])),
	tertiary: Type.Optional(Type.Union([RAW_WINDOW_SCHEMA, Type.Null()])),
	extraRateWindows: Type.Optional(
		Type.Union([
			Type.Array(
				Type.Object({
					id: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9-]+$' }),
					window: RAW_WINDOW_SCHEMA,
					usageKnown: Type.Optional(Type.Boolean()),
				}),
			),
			Type.Null(),
		]),
	),
	updatedAt: Type.Optional(NULLABLE_STRING),
});
const RAW_PAYLOAD_SCHEMA = Type.Array(
	Type.Object({
		provider: Type.String(),
		usage: Type.Optional(Type.Union([RAW_USAGE_SCHEMA, Type.Null()])),
		error: Type.Optional(Type.Object({})),
	}),
	{ minItems: 1, maxItems: 1 },
);
type RawWindow = Static<typeof RAW_WINDOW_SCHEMA>;

/** Real seams for subscription quota tests: Pi auth, executable, clock, and child environment. */
export interface SubscriptionQuotaDependencies {
	getProviderAuth: ModelRegistry['getProviderAuth'];
	executable?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	now?: () => number;
}

function unavailable(provider: QuotaProvider, reason: FailureReason): ProviderQuota {
	return { provider, status: 'unavailable', reason };
}

function isoTimestamp(value: string): string | undefined {
	if (
		!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
			value,
		)
	) {
		return undefined;
	}
	const daysInMonth = new Date(
		Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0),
	).getUTCDate();
	if (Number(value.slice(8, 10)) > daysInMonth) {
		return undefined;
	}
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds)) {
		return undefined;
	}
	return new Date(milliseconds).toISOString().replace('.000Z', 'Z');
}

function quotaWindow(
	raw: RawWindow,
	provider: QuotaProvider,
	id?: string,
	usageKnown = true,
): QuotaWindow | undefined {
	if (raw.isSyntheticPlaceholder) {
		return undefined;
	}
	const window: QuotaWindow = {};
	if (raw.windowMinutes != null) {
		window.minutes = raw.windowMinutes;
	}
	if (raw.usedPercent != null && usageKnown) {
		window.remainingPct = 100 - raw.usedPercent;
	}
	if (raw.resetsAt != null) {
		const resetAt = isoTimestamp(raw.resetsAt);
		if (!resetAt) {
			throw new Error('Subscription quota invalid reset timestamp');
		}
		window.resetAt = resetAt;
	}
	if (provider === 'zai' && (id === 'zai-mcp' || raw.resetDescription === 'MCP')) {
		window.kind = 'mcp';
	} else if (id) {
		window.id = id;
	}
	if (provider === 'kimi-coding' && raw.resetDescription) {
		const [, used, limit] =
			raw.resetDescription.match(
				/^(?:Rate: )?(\d+)\/(\d+)(?: requests| per \d+ (?:hours?|minutes?))$/,
			) ?? [];
		if (
			Number.isSafeInteger(Number(used)) &&
			Number.isSafeInteger(Number(limit)) &&
			Number(limit) > 0 &&
			Number(used) <= Number(limit)
		) {
			window.note = 'legacy_counts';
		}
	}
	return window;
}

/** Normalize CodexBar JSON; request times bound source freshness, never imply spending permission. */
export function parseCodexbarUsage(
	json: string,
	provider: QuotaProvider,
	startedAt: number,
	finishedAt: number,
): ProviderQuota {
	let payload: Static<typeof RAW_PAYLOAD_SCHEMA>;
	try {
		const decoded: unknown = JSON.parse(json);
		if (!Value.Check(RAW_PAYLOAD_SCHEMA, decoded)) {
			return unavailable(provider, 'bad_output');
		}
		payload = decoded;
	} catch {
		return unavailable(provider, 'bad_output');
	}
	const row = payload[0];
	if (!row || row.provider !== CLI_PROVIDERS[provider]) {
		return unavailable(provider, 'bad_output');
	}
	if (row.error) {
		return unavailable(provider, 'provider_error');
	}
	if (!row.usage) {
		return unavailable(provider, 'bad_output');
	}
	const windows: QuotaWindow[] = [];
	try {
		for (const raw of [row.usage.primary, row.usage.secondary, row.usage.tertiary]) {
			if (raw) {
				const window = quotaWindow(raw, provider);
				if (window) {
					windows.push(window);
				}
			}
		}
		for (const extra of row.usage.extraRateWindows ?? []) {
			const window = quotaWindow(extra.window, provider, extra.id, extra.usageKnown);
			if (window) {
				windows.push(window);
			}
		}
	} catch {
		return unavailable(provider, 'bad_output');
	}
	let observedAt: string | undefined;
	if (row.usage.updatedAt != null) {
		observedAt = isoTimestamp(row.usage.updatedAt);
		if (!observedAt) {
			return unavailable(provider, 'bad_output');
		}
	}
	const observation: { provider: QuotaProvider; windows: QuotaWindow[]; source?: 'codex' } = {
		provider,
		windows,
	};
	if (provider === 'openai') {
		observation.source = 'codex';
	}
	if (!observedAt) {
		return { ...observation, status: 'unknown', reason: 'timestamp_missing' };
	}
	if (Date.parse(observedAt) < startedAt - 5000 || Date.parse(observedAt) > finishedAt + 5000) {
		return { ...observation, status: 'stale', observedAt, reason: 'timestamp' };
	}
	if (windows.some((window) => window.resetAt && Date.parse(window.resetAt) <= finishedAt)) {
		return { ...observation, status: 'stale', observedAt, reason: 'reset_elapsed' };
	}
	if (
		!windows.length ||
		windows.some((window) => window.remainingPct === undefined || window.minutes === undefined)
	) {
		return { ...observation, status: 'unknown', observedAt, reason: 'window_incomplete' };
	}
	return { ...observation, status: 'fresh', observedAt };
}

function isolatedEnvironment(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env = { ...inherited };
	for (const name of Object.keys(env)) {
		if (/^(?:KIMI_|Z_AI_|ZAI_|BIGMODEL_|ZHIPU|GLM_|CODEX_|CODEXBAR_|OPENAI_)/.test(name)) {
			delete env[name];
		}
	}
	return env;
}

interface ChildUsage {
	status: 'output';
	json: string;
}
interface ChildFailure {
	status: 'failure';
	reason: FailureReason;
}

function runCodexbar(
	executable: string,
	provider: QuotaProvider,
	env: NodeJS.ProcessEnv,
	signal: AbortSignal,
	timedOut: () => boolean,
): Promise<ChildUsage | ChildFailure> {
	return new Promise((resolve) => {
		let result: ChildUsage | ChildFailure = { status: 'failure', reason: 'local_error' };
		const child = execFile(
			executable,
			[
				'usage',
				'--provider',
				CLI_PROVIDERS[provider],
				'--source',
				provider === 'openai' ? 'oauth' : 'api',
				'--format',
				'json',
				'--json-only',
				'--no-credits',
			],
			{ env, signal, killSignal: 'SIGKILL', maxBuffer: 256 * 1024, encoding: 'utf8' },
			(error, stdout) => {
				if (signal.aborted) {
					result = { status: 'failure', reason: timedOut() ? 'timeout' : 'cancelled' };
				} else if (error) {
					result = {
						status: 'failure',
						reason:
							error.code === 'ENOENT'
								? 'codexbar_missing'
								: error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
									? 'output_limit'
									: error.code === 4
										? 'timeout'
										: 'provider_error',
					};
				} else {
					result = { status: 'output', json: stdout };
				}
			},
		);
		// Await close after abort before deleting the credential directory.
		child.once('close', () => resolve(result));
	});
}

/** Resolve a subscription access token from Pi's API-key or Bearer-header auth contract. */
export function getSubscriptionAccessToken(
	auth: Awaited<ReturnType<ModelRegistry['getProviderAuth']>>,
): string | undefined {
	if (auth?.auth.apiKey) {
		return auth.auth.apiKey;
	}
	const authorization = auth?.auth.headers?.Authorization ?? auth?.auth.headers?.authorization;
	return authorization?.match(/^Bearer (\S+)$/)?.[1];
}

async function readProviderQuota(
	provider: QuotaProvider,
	dependencies: SubscriptionQuotaDependencies,
	callerSignal?: AbortSignal,
): Promise<ProviderQuota> {
	const deadline = AbortSignal.timeout(dependencies.timeoutMs ?? 45_000);
	const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
	if (signal.aborted) {
		return unavailable(provider, 'cancelled');
	}
	let auth: Awaited<ReturnType<ModelRegistry['getProviderAuth']>>;
	try {
		auth = await boundedAuth(dependencies.getProviderAuth(provider), signal);
	} catch {
		return unavailable(
			provider,
			signal.aborted ? (deadline.aborted ? 'timeout' : 'cancelled') : 'auth',
		);
	}
	const accessToken = getSubscriptionAccessToken(auth);
	if (!accessToken || (provider === 'openai' && auth?.source !== 'OAuth')) {
		return unavailable(provider, 'auth');
	}
	let directory: string | undefined;
	try {
		directory = await mkdtemp(join(tmpdir(), 'pi-subscription-quota-'));
		const env = isolatedEnvironment(dependencies.env ?? process.env);
		env.CODEXBAR_CONFIG = join(directory, 'config.json');
		await writeFile(
			env.CODEXBAR_CONFIG,
			JSON.stringify({
				version: 1,
				providers: [{ id: 'kimi', enabled: true, cookieSource: 'off', source: 'api' }],
			}),
			{ mode: 0o600 },
		);
		if (provider === 'openai') {
			env.CODEX_HOME = join(dependencies.env?.HOME ?? homedir(), '.codex');
		} else if (provider === 'zai') {
			env.Z_AI_API_KEY = accessToken;
		} else {
			env.KIMI_CODE_API_KEY = accessToken;
		}
		const now = dependencies.now ?? Date.now;
		const startedAt = now();
		const result = await runCodexbar(
			dependencies.executable ?? 'codexbar',
			provider,
			env,
			signal,
			() => deadline.aborted,
		);
		return result.status === 'failure'
			? unavailable(provider, result.reason)
			: parseCodexbarUsage(result.json, provider, startedAt, now());
	} catch {
		return unavailable(
			provider,
			signal.aborted ? (deadline.aborted ? 'timeout' : 'cancelled') : 'local_error',
		);
	} finally {
		if (directory) {
			await rm(directory, { recursive: true, force: true });
		}
	}
}

async function boundedAuth(
	auth: ReturnType<ModelRegistry['getProviderAuth']>,
	signal: AbortSignal,
): ReturnType<ModelRegistry['getProviderAuth']> {
	let abort: (() => void) | undefined;
	try {
		return await Promise.race([
			auth,
			new Promise<never>((resolve, reject) => {
				abort = () => reject(new Error('Subscription quota auth resolution interrupted'));
				if (signal.aborted) {
					abort();
				} else {
					signal.addEventListener('abort', abort, { once: true });
				}
			}),
		]);
	} finally {
		if (abort) {
			signal.removeEventListener('abort', abort);
		}
	}
}

/** Define the subscription quota handler; the default resolver is supplied by each Pi invocation. */
export function createSubscriptionQuotaTool(dependencies?: SubscriptionQuotaDependencies) {
	return {
		name: 'subscription_quota',
		label: 'Subscription quota',
		description:
			'Read subscription quota for openai, zai, kimi-coding (default all). OpenAI uses the native Codex login (source:codex), not the Pi inference-only token. Minified JSON observations: windows identified by minutes, remainingPct 0–100, resetAt UTC; kind:mcp is separate tool quota. fresh/stale/unknown describe observation quality, never spending permission. Missing windows are unreported. legacy_counts notes CodexBar count evidence, not a live ratio comparison.',
		parameters: PARAMETERS_SCHEMA,
		outputSchema: OUTPUT_SCHEMA,
		async execute(
			toolCallId: string,
			params: Static<typeof PARAMETERS_SCHEMA>,
			signal: AbortSignal | undefined,
			onUpdate: Parameters<ToolDefinition<typeof PARAMETERS_SCHEMA>['execute']>[3],
			ctx: Pick<ExtensionToolContext, 'modelRegistry'>,
		) {
			const resolvedDependencies = dependencies ?? {
				getProviderAuth: ctx.modelRegistry.getProviderAuth.bind(ctx.modelRegistry),
			};
			const report = await Promise.all(
				(params.providers ?? DEFAULT_PROVIDERS).map(async (provider) => {
					try {
						return await readProviderQuota(provider, resolvedDependencies, signal);
					} catch {
						return unavailable(provider, 'local_error');
					}
				}),
			);
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(report) }],
				structuredContent: report,
				details: {},
			};
		},
	};
}

/** Register and return the read-only subscription quota handler, without cache or polling. */
export function registerSubscriptionQuotaTool(
	pi: Pick<ExtensionAPI, 'registerTool'>,
	dependencies?: SubscriptionQuotaDependencies,
) {
	const tool = createSubscriptionQuotaTool(dependencies);
	pi.registerTool(tool);
	return tool;
}
