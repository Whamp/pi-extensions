import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	directZaiWindows,
	directKimiEvidence,
	compareQuotaWindows,
	createQuotaVerificationReport,
} from './verify-live.mjs';

const KIMI_PAYLOAD = {
	usage: { limit: '100', used: '41', remaining: '59', resetTime: '2026-10-03T10:00:00Z' },
	limits: [
		{
			window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
			detail: { limit: '200', used: '10', remaining: '190', resetTime: '2026-10-02T23:00:00Z' },
		},
	],
	usages: {
		limit_7d: { used_ratio: 0, reset_time: '2026-10-03T10:00:01.450Z' },
		limit_5h: { used_ratio: 0.05, reset_time: '2026-10-02T23:00:00Z' },
	},
};

test('default verification hides contradictory Kimi ratios; diagnostics must be explicit', () => {
	const observations = [
		{ provider: 'kimi-coding', windows: [{ minutes: 10080, remainingPct: 56 }] },
	];
	const comparisons = [{ provider: 'kimi-coding', matched: true }];
	const warning = { reason: 'kimi_weekly_count_ratio_disagreement', ratioUsed: 0 };
	assert.deepEqual(createQuotaVerificationReport(observations, comparisons, warning), {
		observations,
		comparisons,
	});
	assert.deepEqual(createQuotaVerificationReport(observations, comparisons, warning, true), {
		observations,
		comparisons,
		warnings: [warning],
	});
	assert.deepEqual(createQuotaVerificationReport(observations, comparisons, undefined, true), {
		observations,
		comparisons,
	});
});

test('live Kimi oracle separately flags weekly contradiction while accepting matching count fallback', () => {
	assert.deepEqual(directKimiEvidence(KIMI_PAYLOAD), {
		windows: [
			{ minutes: 10080, remainingPct: 59, resetAt: '2026-10-03T10:00:00Z' },
			{ minutes: 300, remainingPct: 95, resetAt: '2026-10-02T23:00:00Z' },
		],
		warning: {
			reason: 'kimi_weekly_count_ratio_disagreement',
			countUsed: 41,
			countLimit: 100,
			ratioUsed: 0,
			matchingReset: true,
		},
	});
});

test('live Kimi oracle does not borrow legacy counts across resets or monthly pools', () => {
	const differentReset = structuredClone(KIMI_PAYLOAD);
	differentReset.usages.limit_7d.reset_time = '2026-10-04T10:00:00Z';
	assert.equal(directKimiEvidence(differentReset).windows[0].remainingPct, 100);
	assert.equal(directKimiEvidence(differentReset).warning.matchingReset, false);
	const monthly = structuredClone(KIMI_PAYLOAD);
	monthly.usages.limit_month_total = { used_ratio: 0.2, reset_time: '2026-10-31T10:00:00Z' };
	assert.equal(directKimiEvidence(monthly).windows[0].remainingPct, 100);
	assert.deepEqual(directKimiEvidence(monthly).windows[2], {
		minutes: 43200,
		remainingPct: 80,
		resetAt: '2026-10-31T10:00:00Z',
	});
});

test('live ZAI oracle keeps weekly and five-hour limits and separate MCP quota', () => {
	assert.deepEqual(
		directZaiWindows({
			success: true,
			code: 200,
			data: {
				limits: [
					{
						type: 'TOKENS_LIMIT',
						unit: 3,
						number: 5,
						percentage: 22,
						nextResetTime: Date.parse('2026-10-02T23:00:00Z'),
					},
					{
						type: 'TOKENS_LIMIT',
						unit: 6,
						number: 1,
						percentage: 59,
						nextResetTime: Date.parse('2026-10-03T10:00:00Z'),
					},
					{
						type: 'TIME_LIMIT',
						unit: 5,
						number: 1,
						percentage: 0,
						nextResetTime: Date.parse('2026-10-31T10:00:00Z'),
					},
				],
			},
		}),
		[
			{ minutes: 300, remainingPct: 78, resetAt: '2026-10-02T23:00:00.000Z' },
			{ minutes: 10080, remainingPct: 41, resetAt: '2026-10-03T10:00:00.000Z' },
			{ minutes: 43200, remainingPct: 100, resetAt: '2026-10-31T10:00:00.000Z', kind: 'mcp' },
		],
	);
	assert.equal(
		directZaiWindows({
			success: true,
			code: 200,
			data: {
				limits: [
					{
						type: 'CREDIT_LIMIT',
						unit: 3,
						number: 5,
						percentage: 10,
						usage: 100,
						currentValue: 30,
						remaining: 80,
					},
				],
			},
		})[0].remainingPct,
		70,
	);
});

test('live comparison rejects missing windows, MCP conflation, changed percentages, and reset periods', () => {
	const expected = [{ minutes: 10080, remainingPct: 59, resetAt: '2026-10-03T10:00:00Z' }];
	assert.equal(compareQuotaWindows(expected, expected), true);
	assert.equal(compareQuotaWindows([], expected), false);
	assert.equal(compareQuotaWindows([{ ...expected[0], remainingPct: 100 }], expected), false);
	assert.equal(compareQuotaWindows([{ ...expected[0], kind: 'mcp' }], expected), false);
	assert.equal(
		compareQuotaWindows([{ ...expected[0], resetAt: '2026-10-04T10:00:00Z' }], expected),
		false,
	);
});

test('live oracles reject unsupported payloads rather than fabricate capacity', () => {
	assert.throws(() => directZaiWindows({ data: { limits: [] } }));
	assert.throws(() => directKimiEvidence({ usage: { limit: '100', used: 'not-a-count' } }));
	assert.deepEqual(directKimiEvidence({}).windows, []);
});
