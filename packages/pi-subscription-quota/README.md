# Subscription quota

`subscription_quota` reports Pi subscription quota through CodexBar CLI 0.71.0.
The extension requires Pi 1.0.0+, Node.js 22.19+, and `codexbar` on `PATH`.

The tool accepts an optional `providers` array containing `openai`, `zai`, or
`kimi-coding`. The default is all three. OpenAI means the Codex subscription,
not OpenAI API billing.

```json
{ "providers": ["zai", "kimi-coding"] }
```

## Result

The tool returns minified JSON text and the same value in `structuredContent`.
Its `outputSchema` describes both successful and unavailable observations.
A weekly-only OpenAI response has no invented five-hour window.

```json
[
	{
		"provider": "openai",
		"source": "codex",
		"windows": [{ "minutes": 10080, "remainingPct": 23, "resetAt": "2026-10-03T16:58:53Z" }],
		"status": "fresh",
		"observedAt": "2026-10-02T19:40:00Z"
	}
]
```

Each window has its own duration in `minutes`, remaining percentage in
`remainingPct`, and UTC `resetAt`, when reported. Duration identifies the window,
not its position. Unknown durations remain absent. Extra named windows retain
an `id`. `kind:"mcp"` identifies separate MCP tool quota, not model quota.
Missing usage never becomes 100% remaining. Synthetic placeholders stay absent.

Observation status does not grant spending permission:

- `fresh` means the source timestamp falls within the request interval, with five
  seconds of clock tolerance, and all reported windows have usage, duration, and
  a future reset.
- `stale` retains windows but marks an out-of-interval timestamp or elapsed reset.
- `unknown` marks a missing source timestamp or incomplete window evidence.
- `unavailable` reports a coarse auth, process, output, or local failure reason.

CodexBar owns provider quota interpretation. For Kimi, `note:"legacy_counts"`
means CodexBar supplied a valid request-count description. The tool does not
collect a second payload or claim that it detected a count-versus-ratio conflict.
CodexBar uses nonzero counts when zero ratios describe the same reset period and
no monthly ratio pool is present. Its [upstream fix](https://github.com/steipete/CodexBar/pull/3755)
includes a live comparison against the affected account's dashboard. That supports
the workaround, but Kimi's mixed-response semantics remain undocumented.

## Credential boundary

Each call resolves auth through `ctx.modelRegistry.getProviderAuth`.
Pi owns Kimi OAuth renewal. OpenAI requires Pi to use OAuth, then CodexBar reads
the separately signed-in native Codex account at `~/.codex`. Its observations
include `source:"codex"`. Pi's current inference-only OpenAI token cannot read
the quota endpoint. The tool does not assert that the two logins are the same
account. Sign in to Codex with the subscription account you want to measure.
No Pi refresh token is passed to CodexBar. Custom `CODEX_HOME` paths are not supported.

ZAI and Kimi receive only their resolved credential through child environment
variables. A private temporary CodexBar config disables Kimi cookies.
Inherited provider credentials and endpoint overrides do not reach the child.
Temporary directories use mode `0700`, and config files use mode `0600`.
Cleanup waits for the child to exit, including cancellation and timeout.

Each provider has a 45-second deadline and a 256 KiB limit per output stream.
Auth resolution is bounded for the tool caller, but Pi's ongoing refresh can
finish after cancellation because the registry facade has no signal parameter.
There are no retries, caches, background polls, account emails, or paid balances.

## Verification commands

Package checks from the repository root:

```sh
	pnpm --filter @whamp/pi-subscription-quota test
	pnpm --filter @whamp/pi-subscription-quota typecheck
```

The live verifier invokes the registered handler with a real Pi `ModelRegistry`,
without a model call:

```sh
	pnpm --filter @whamp/pi-subscription-quota verify:live
```

The verifier uses Pi's normal auth and models paths. OAuth renewal can update
Pi's saved credentials. No private config is changed by the verifier itself.
It compares ZAI and Kimi windows against direct authenticated usage responses,
including weekly quota. It prints only sanitized observations and comparisons.
A Kimi weekly count-versus-ratio disagreement appears as a separate warning.
Matching CodexBar count fallback can pass despite that warning. A window mismatch
or non-fresh observation exits nonzero. Quota changes during the requests can
require another verification run.
