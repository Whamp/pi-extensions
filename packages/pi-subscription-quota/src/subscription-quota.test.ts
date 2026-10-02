import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Value } from 'typebox/value';
import {
	registerSubscriptionQuotaTool,
	parseCodexbarUsage,
	createSubscriptionQuotaTool,
	type SubscriptionQuotaDependencies,
} from './subscription-quota.ts';

const CONTEXT = {
	modelRegistry: new ModelRegistry(
		await ModelRuntime.create({
			credentials: {
				async read() {
					return undefined;
				},
				async list() {
					return [];
				},
				async modify(provider, update) {
					return update(undefined);
				},
				async delete() {},
			},
			modelsPath: null,
			refreshOnCreate: false,
		}),
	),
};
const NOW = Date.parse('2026-10-02T19:40:00Z');
const FIXTURE = fileURLToPath(new URL('./test-utils/codexbar-fixture.mjs', import.meta.url));
const AMBIENT_ENV = {
	...process.env,
	Z_AI_API_KEY: 'wrong-zai',
	KIMI_CODE_API_KEY: 'wrong-kimi',
	KIMI_AUTH_TOKEN: 'wrong-cookie',
	KIMI_CODE_BASE_URL: 'https://wrong.example',
	KIMI_CODE_OAUTH_HOST: 'https://wrong.example',
	Z_AI_QUOTA_URL: 'https://wrong.example',
	Z_AI_API_HOST: 'wrong.example',
	OPENAI_API_KEY: 'wrong-openai',
	CODEXBAR_TOKEN: 'wrong-token',
	CODEX_HOME: '/never-use-this',
	CODEXBAR_CONFIG: '/never-read-this',
};

function parseUsage(usage: string, provider: 'openai' | 'zai' | 'kimi-coding' = 'openai') {
	const cliProvider = { openai: 'codex', zai: 'zai', 'kimi-coding': 'kimi' }[provider];
	return parseCodexbarUsage(
		`[{"provider":"${cliProvider}","usage":${usage}}]`,
		provider,
		NOW,
		NOW + 1000,
	);
}

function captureTool(dependencies: SubscriptionQuotaDependencies) {
	let registrations = 0;
	const tool = registerSubscriptionQuotaTool(
		{
			registerTool(definition) {
				assert.equal(definition.name, 'subscription_quota');
				registrations++;
			},
		},
		dependencies,
	);
	assert.equal(registrations, 1);
	return tool;
}

async function fixtureTool(mode = 'success', timeoutMs = 1000) {
	const directory = await mkdtemp(join(tmpdir(), 'quota-test-'));
	await chmod(FIXTURE, 0o755);
	await mkdir(join(directory, '.codex'), { mode: 0o700 });
	await writeFile(
		join(directory, '.codex', 'auth.json'),
		JSON.stringify({ tokens: { access_token: 'native-openai', refresh_token: 'native-refresh' } }),
		{ mode: 0o600 },
	);
	const requested: string[] = [];
	const dependencies: SubscriptionQuotaDependencies = {
		async getProviderAuth(provider) {
			requested.push(provider);
			return { auth: { apiKey: `pi-${provider}` }, source: 'OAuth' };
		},
		executable: FIXTURE,
		env: {
			...AMBIENT_ENV,
			HOME: directory,
			QUOTA_TEST_MODE: mode,
			QUOTA_TEST_DIRECTORY: directory,
		},
		now: () => NOW,
		timeoutMs,
	};
	const tool = captureTool(dependencies);
	return { directory, requested, tool, dependencies };
}

async function assertChildCleanup(directory: string, providers: string[]) {
	for (const provider of providers) {
		const metadata: { directory: string; pid: number; scoped: boolean } = JSON.parse(
			await readFile(join(directory, `${provider}.json`), 'utf8'),
		);
		assert.equal(metadata.scoped, true);
		await assert.rejects(access(metadata.directory), { code: 'ENOENT' });
		assert.throws(() => process.kill(metadata.pid, 0), { code: 'ESRCH' });
	}
}

test('weekly-only OpenAI is a compact literal observation, with no phantom primary', () => {
	assert.deepEqual(
		parseUsage(
			'{"updatedAt":"2026-10-02T19:40:00Z","primary":null,"secondary":{"usedPercent":77,"windowMinutes":10080,"resetsAt":"2026-10-03T16:58:53Z"},"accountEmail":"private@example.com"}',
		),
		{
			provider: 'openai',
			source: 'codex',
			windows: [{ minutes: 10080, remainingPct: 23, resetAt: '2026-10-03T16:58:53Z' }],
			status: 'fresh',
			observedAt: '2026-10-02T19:40:00Z',
		},
	);
});

test('duration, not slot order, identifies Kimi windows and validated weekly count evidence', () => {
	assert.deepEqual(
		parseUsage(
			'{"updatedAt":"2026-10-02T19:40:00Z","primary":{"usedPercent":41,"windowMinutes":10080,"resetsAt":"2026-10-03T19:40:00Z","resetDescription":"41/100 requests"},"secondary":{"usedPercent":5,"windowMinutes":300,"resetsAt":"2026-10-02T23:40:00Z"}}',
			'kimi-coding',
		),
		{
			provider: 'kimi-coding',
			windows: [
				{
					minutes: 10080,
					remainingPct: 59,
					resetAt: '2026-10-03T19:40:00Z',
					note: 'legacy_counts',
				},
				{ minutes: 300, remainingPct: 95, resetAt: '2026-10-02T23:40:00Z' },
			],
			status: 'fresh',
			observedAt: '2026-10-02T19:40:00Z',
		},
	);
	const invalidCount = parseUsage(
		'{"primary":{"usedPercent":41,"resetDescription":"101/100 requests"}}',
		'kimi-coding',
	);
	assert.ok('windows' in invalidCount);
	assert.equal(invalidCount.windows[0]?.note, undefined);
});

test('MCP stays separate and unfamiliar named windows retain duration and identity', () => {
	const report = parseUsage(
		'{"updatedAt":"2026-10-02T19:40:00Z","extraRateWindows":[{"id":"zai-mcp","window":{"usedPercent":0,"windowMinutes":43200,"resetsAt":"2026-10-31T19:40:00Z"}},{"id":"other-pool","window":{"usedPercent":10,"windowMinutes":90,"resetsAt":"2026-10-02T20:40:00Z"}}]}',
		'zai',
	);
	assert.deepEqual(report, {
		provider: 'zai',
		windows: [
			{ minutes: 43200, remainingPct: 100, resetAt: '2026-10-31T19:40:00Z', kind: 'mcp' },
			{ minutes: 90, remainingPct: 90, resetAt: '2026-10-02T20:40:00Z', id: 'other-pool' },
		],
		status: 'fresh',
		observedAt: '2026-10-02T19:40:00Z',
	});
});

test('missing usage never manufactures 100% remaining and synthetic windows stay absent', () => {
	assert.deepEqual(
		parseUsage(
			'{"updatedAt":"2026-10-02T19:40:00Z","primary":{"windowMinutes":300,"resetsAt":"2026-10-02T23:40:00Z"},"secondary":{"usedPercent":0,"isSyntheticPlaceholder":true}}',
		),
		{
			provider: 'openai',
			source: 'codex',
			windows: [{ minutes: 300, resetAt: '2026-10-02T23:40:00Z' }],
			status: 'unknown',
			observedAt: '2026-10-02T19:40:00Z',
			reason: 'window_incomplete',
		},
	);
	const unknown = parseUsage(
		'{"extraRateWindows":[{"id":"unreported","usageKnown":false,"window":{"usedPercent":0,"windowMinutes":90}}]}',
	);
	assert.ok('windows' in unknown);
	assert.equal(unknown.windows[0]?.remainingPct, undefined);
});

test('missing observation time, empty observations, and missing reset fail closed', () => {
	assert.deepEqual(parseUsage('{"primary":{"usedPercent":4}}'), {
		provider: 'openai',
		source: 'codex',
		windows: [{ remainingPct: 96 }],
		status: 'unknown',
		reason: 'timestamp_missing',
	});
	assert.equal(parseUsage('{"updatedAt":"2026-10-02T19:40:00Z"}').status, 'unknown');
	assert.equal(
		parseUsage(
			'{"updatedAt":"2026-10-02T19:40:00Z","primary":{"usedPercent":4,"windowMinutes":300}}',
		).status,
		'unknown',
	);
});

test('expired resets and old or future source timestamps mark windows stale', () => {
	for (const timestamp of ['2026-10-02T19:39:54Z', '2026-10-02T19:40:07Z']) {
		const report = parseUsage(
			`{"updatedAt":"${timestamp}","primary":{"usedPercent":41,"windowMinutes":300,"resetsAt":"2026-10-02T23:40:00Z"}}`,
		);
		assert.equal(report.status, 'stale');
		assert.ok('reason' in report);
		assert.equal(report.reason, 'timestamp');
	}
	const expired = parseUsage(
		'{"updatedAt":"2026-10-02T19:40:00Z","primary":{"usedPercent":41,"windowMinutes":300,"resetsAt":"2026-10-02T19:39:00Z"}}',
	);
	assert.ok('reason' in expired);
	assert.equal(expired.reason, 'reset_elapsed');
});

test('malformed percentages, durations, timestamps, envelopes and wrong provider are rejected', () => {
	for (const usage of [
		'{"primary":{"usedPercent":"0"}}',
		'{"primary":{"usedPercent":-1}}',
		'{"primary":{"usedPercent":101}}',
		'{"primary":{"windowMinutes":0}}',
		'{"updatedAt":"yesterday"}',
		'{"primary":{"resetsAt":"bad"}}',
		'[]',
	]) {
		assert.deepEqual(parseUsage(usage), {
			provider: 'openai',
			status: 'unavailable',
			reason: 'bad_output',
		});
	}
	for (const json of [
		'not-json',
		'{}',
		'[]',
		'[{"provider":"zai","usage":{}}]',
		'[{"provider":"codex"},{"provider":"codex"}]',
	]) {
		assert.deepEqual(parseCodexbarUsage(json, 'openai', NOW, NOW), {
			provider: 'openai',
			status: 'unavailable',
			reason: 'bad_output',
		});
	}
	assert.deepEqual(
		parseCodexbarUsage(
			'[{"provider":"codex","error":{"message":"private email and token"}}]',
			'openai',
			NOW,
			NOW,
		),
		{ provider: 'openai', status: 'unavailable', reason: 'provider_error' },
	);
});

test('registered handler defaults all three, sanitizes, matches output schema and cleans child credentials', async () => {
	const fixture = await fixtureTool();
	try {
		const result = await fixture.tool.execute('test', {}, undefined, undefined, CONTEXT);
		assert.deepEqual(fixture.requested, ['openai', 'zai', 'kimi-coding']);
		assert.deepEqual(
			result.structuredContent,
			['openai', 'zai', 'kimi-coding'].map((provider) => {
				const observation: {
					provider: string;
					windows: { minutes: number; remainingPct: number; resetAt: string }[];
					status: string;
					observedAt: string;
					source?: string;
				} = {
					provider,
					windows: [{ minutes: 10080, remainingPct: 59, resetAt: '2026-10-03T19:40:00Z' }],
					status: 'fresh',
					observedAt: '2026-10-02T19:40:00Z',
				};
				if (provider === 'openai') observation.source = 'codex';
				return observation;
			}),
		);
		assert.ok(fixture.tool.outputSchema);
		assert.ok(Value.Check(fixture.tool.outputSchema, result.structuredContent));
		assert.deepEqual(result.content, [
			{ type: 'text', text: JSON.stringify(result.structuredContent) },
		]);
		await assertChildCleanup(fixture.directory, ['codex', 'zai', 'kimi']);
	} finally {
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

test('provider selection resolves only the requested Pi account', async () => {
	const fixture = await fixtureTool();
	try {
		const result = await fixture.tool.execute(
			'test',
			{ providers: ['zai'] },
			undefined,
			undefined,
			CONTEXT,
		);
		assert.deepEqual(fixture.requested, ['zai']);
		assert.ok(Array.isArray(result.structuredContent));
		assert.equal(result.structuredContent.length, 1);
		await assertChildCleanup(fixture.directory, ['zai']);
	} finally {
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

test('Kimi OAuth Bearer headers resolve through Pi and reach only the scoped child', async () => {
	const fixture = await fixtureTool();
	try {
		const tool = captureTool({
			...fixture.dependencies,
			async getProviderAuth() {
				return { auth: { headers: { Authorization: 'Bearer pi-kimi-coding' } }, source: 'OAuth' };
			},
		});
		const result = await tool.execute(
			'test',
			{ providers: ['kimi-coding'] },
			undefined,
			undefined,
			CONTEXT,
		);
		assert.deepEqual(result.structuredContent, [
			{
				provider: 'kimi-coding',
				windows: [{ minutes: 10080, remainingPct: 59, resetAt: '2026-10-03T19:40:00Z' }],
				status: 'fresh',
				observedAt: '2026-10-02T19:40:00Z',
			},
		]);
		await assertChildCleanup(fixture.directory, ['kimi']);
	} finally {
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

test('tool parameter schema restricts providers and forbids empty, duplicate and extra inputs', () => {
	const { parameters } = createSubscriptionQuotaTool();
	assert.ok(Value.Check(parameters, {}));
	assert.ok(Value.Check(parameters, { providers: ['kimi-coding', 'openai'] }));
	for (const params of [
		{ providers: [] },
		{ providers: ['other'] },
		{ providers: ['zai', 'zai'] },
		{ force: true },
	]) {
		assert.equal(Value.Check(parameters, params), false);
	}
});

test('missing auth and non-OAuth OpenAI never launch an ambient-account child', async () => {
	for (const source of [undefined, 'OPENAI_API_KEY', 'oauth', 'OAuth']) {
		const tool = captureTool({
			async getProviderAuth() {
				if (source === 'OAuth') {
					return undefined;
				}
				if (source === undefined) {
					return { auth: { apiKey: 'never-lend-this' } };
				}
				return { auth: { apiKey: 'never-lend-this' }, source };
			},
			executable: '/missing',
		});
		const result = await tool.execute(
			'test',
			{ providers: ['openai'] },
			undefined,
			undefined,
			CONTEXT,
		);
		assert.deepEqual(result.structuredContent, [
			{ provider: 'openai', status: 'unavailable', reason: 'auth' },
		]);
	}
});

test('auth resolution errors are coarse and do not leak raw details', async () => {
	const tool = captureTool({
		async getProviderAuth() {
			throw new Error('private refresh detail');
		},
	});
	const result = await tool.execute('test', {}, undefined, undefined, CONTEXT);
	assert.deepEqual(
		result.structuredContent,
		['openai', 'zai', 'kimi-coding'].map((provider) => ({
			provider,
			status: 'unavailable',
			reason: 'auth',
		})),
	);
});

test('child failure, malformed JSON and output overflow are explicit and still clean up', async () => {
	for (const [mode, reason] of [
		['error', 'provider_error'],
		['malformed', 'bad_output'],
		['overflow', 'output_limit'],
	]) {
		const fixture = await fixtureTool(mode);
		try {
			const result = await fixture.tool.execute(
				'test',
				{ providers: ['zai'] },
				undefined,
				undefined,
				CONTEXT,
			);
			assert.deepEqual(result.structuredContent, [
				{ provider: 'zai', status: 'unavailable', reason },
			]);
			await assertChildCleanup(fixture.directory, ['zai']);
		} finally {
			await rm(fixture.directory, { recursive: true, force: true });
		}
	}
});

test('missing executable returns a stable failure without exposing paths', async () => {
	const fixture = await fixtureTool();
	try {
		const tool = captureTool({ ...fixture.dependencies, executable: '/missing-codexbar' });
		const result = await tool.execute(
			'test',
			{ providers: ['zai'] },
			undefined,
			undefined,
			CONTEXT,
		);
		assert.deepEqual(result.structuredContent, [
			{ provider: 'zai', status: 'unavailable', reason: 'codexbar_missing' },
		]);
	} finally {
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

test('timeout kills the real child before cleanup', async () => {
	const fixture = await fixtureTool('hang', 300);
	try {
		const result = await fixture.tool.execute(
			'test',
			{ providers: ['openai'] },
			undefined,
			undefined,
			CONTEXT,
		);
		assert.deepEqual(result.structuredContent, [
			{ provider: 'openai', status: 'unavailable', reason: 'timeout' },
		]);
		await assertChildCleanup(fixture.directory, ['codex']);
	} finally {
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

test('caller abort is distinct from timeout and waits for child exit', async () => {
	const fixture = await fixtureTool('hang', 3000);
	const controller = new AbortController();
	try {
		const pending = fixture.tool.execute(
			'test',
			{ providers: ['zai'] },
			controller.signal,
			undefined,
			CONTEXT,
		);
		await assert.doesNotReject(async () => {
			for (let attempts = 0; attempts < 100; attempts++) {
				try {
					await access(join(fixture.directory, 'zai.json'));
					controller.abort();
					return;
				} catch {
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
			throw new Error('Fixture did not start within deadline');
		});
		const result = await pending;
		assert.deepEqual(result.structuredContent, [
			{ provider: 'zai', status: 'unavailable', reason: 'cancelled' },
		]);
		await assertChildCleanup(fixture.directory, ['zai']);
	} finally {
		controller.abort();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

test('already cancelled calls do not resolve credentials', async () => {
	let called = false;
	const tool = captureTool({
		async getProviderAuth() {
			called = true;
			return undefined;
		},
	});
	const result = await tool.execute(
		'test',
		{ providers: ['zai'] },
		AbortSignal.abort(),
		undefined,
		CONTEXT,
	);
	assert.equal(called, false);
	assert.deepEqual(result.structuredContent, [
		{ provider: 'zai', status: 'unavailable', reason: 'cancelled' },
	]);
});
