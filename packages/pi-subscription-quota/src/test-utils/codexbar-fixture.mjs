#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const provider = process.argv[process.argv.indexOf('--provider') + 1];
const mode = process.env.QUOTA_TEST_MODE;
const directory = dirname(process.env.CODEXBAR_CONFIG);
const config = JSON.parse(readFileSync(process.env.CODEXBAR_CONFIG, 'utf8'));
assert.equal(statSync(directory).mode & 0o777, 0o700);
assert.equal(statSync(process.env.CODEXBAR_CONFIG).mode & 0o777, 0o600);
assert.deepEqual(config, {
	version: 1,
	providers: [{ id: 'kimi', enabled: true, cookieSource: 'off', source: 'api' }],
});
for (const name of [
	'Z_AI_QUOTA_URL',
	'Z_AI_API_HOST',
	'KIMI_CODE_BASE_URL',
	'KIMI_CODE_OAUTH_HOST',
	'KIMI_AUTH_TOKEN',
	'OPENAI_API_KEY',
	'CODEXBAR_TOKEN',
]) {
	assert.equal(process.env[name], undefined);
}
if (provider === 'codex') {
	const path = join(process.env.CODEX_HOME, 'auth.json');
	assert.equal(process.env.CODEX_HOME, join(process.env.QUOTA_TEST_DIRECTORY, '.codex'));
	assert.equal(statSync(process.env.CODEX_HOME).mode & 0o777, 0o700);
	assert.equal(statSync(path).mode & 0o777, 0o600);
	assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
		tokens: { access_token: 'native-openai', refresh_token: 'native-refresh' },
	});
	assert.equal(process.env.KIMI_CODE_API_KEY, undefined);
	assert.equal(process.env.Z_AI_API_KEY, undefined);
} else {
	assert.equal(process.env.CODEX_HOME, undefined);
	assert.equal(process.env.Z_AI_API_KEY, provider === 'zai' ? 'pi-zai' : undefined);
	assert.equal(process.env.KIMI_CODE_API_KEY, provider === 'kimi' ? 'pi-kimi-coding' : undefined);
}
writeFileSync(
	join(process.env.QUOTA_TEST_DIRECTORY, `${provider}.json`),
	JSON.stringify({ directory, pid: process.pid, scoped: true }),
);
if (mode === 'hang') {
	setInterval(() => {}, 1000);
} else if (mode === 'error') {
	process.stderr.write('private provider details must not escape');
	process.exitCode = 1;
} else if (mode === 'overflow') {
	process.stdout.write('x'.repeat(400000));
} else if (mode === 'malformed') {
	process.stdout.write('not-json');
} else {
	process.stdout.write(
		JSON.stringify([
			{
				provider,
				usage: {
					updatedAt: '2026-10-02T19:40:00Z',
					primary: { usedPercent: 41, windowMinutes: 10080, resetsAt: '2026-10-03T19:40:00Z' },
				},
			},
		]),
	);
}
