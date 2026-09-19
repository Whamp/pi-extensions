# pi-jev-pruner

Prune noisy bash output with [TypeSafe](https://docs.typesafe.ai) Jev before the
model reads it.

pi's bash tool truncates a long result to its **last 2000 lines** and saves the
complete stream to a temp file. The tail is rarely where the answer is: the first
error of a 40 000-line build log is usually the one that matters. This extension
reads the complete stream, asks Jev one question per chunk — *does any line here
need to remain available?* — against the conversation, and replaces the chunks
that score below the threshold with a marker naming the file the dropped lines
are still in.

```text
pi runs a bash command → complete output scored by Jev → model receives kept chunks + a marker
```

## Install

```bash
pi install git:github.com/Whamp/pi-extensions
```

Or load just this package for one session:

```bash
pi -e ./packages/pi-jev-pruner
```

## Credentials

The extension never holds the TypeSafe API key. Requests go through Agent Vault,
which matches `api.typesafe.ai/v1/*` against its service table and adds the
bearer credential on the way out. The extension holds a **proxy token** instead:
a revocable, proxy-only agent token that cannot read credentials. Point
`proxyUrl` at your Agent Vault host, and read the token from its command line.

Resolution order:

| Value | Sources, in order |
| --- | --- |
| Proxy token | `AGENT_VAULT_TOKEN`, then the configured Proton Pass item via `pass-cli` |
| Root CA | `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE` / `CURL_CA_BUNDLE`, then `~/.agent-vault/mitm-ca.pem`, then a cached copy, then `ssh <agent-vault-host> 'docker exec Agent-Vault agent-vault ca fetch'` (cached to `~/.pi/agent/extensions/jev-pruner-agent-vault-ca.pem`) |
| Proxy URL | `proxyUrl` from the config file; defaults to `http://127.0.0.1:14322` |

When any of these is unavailable the extension does nothing at all: tool output
is left exactly as pi produced it.

## What it will not touch

| Output | Behaviour |
| --- | --- |
| Under the token gate | Passed through without reading history or calling Jev |
| JSON, XML, YAML, diffs, `cat`/`jq`/`git diff`/`base64`/`openssl` output | Left verbatim: cutting a hole in a document the agent may parse leaves something that looks complete but is not |
| Binary | Left verbatim |
| Credential-like commands or output | Left verbatim, and never sent to Jev |
| Anything Jev fails to score | Left verbatim |

## Configuration

`~/.pi/agent/extensions/jev-pruner.json` (honours `PI_CODING_AGENT_DIR`). Every
field is optional; an invalid field falls back to its default rather than
disabling the extension.

```json
{
	"enabled": true,
	"minTokens": 4000,
	"chunkLines": 20,
	"keepThreshold": 0.5,
	"maxStateTokens": 25000,
	"maxScoringRequests": 8,
	"model": "jev-latest",
	"proxyUrl": "http://127.0.0.1:14322",
	"passVaultName": "Secrets",
	"passItemTitle": "vault-host Agent Vault agent-token",
	"agentVaultSshTarget": "root@vault-host"
}
```

The three Agent Vault fields are the only ones that describe your setup rather
than Jev's behaviour, and each is off when empty:

| Field | Effect when set | Effect when empty |
| --- | --- | --- |
| `passVaultName` + `passItemTitle` | `pass-cli` reads the proxy token from that Proton Pass item | the proxy token must come from `AGENT_VAULT_TOKEN` |
| `agentVaultSshTarget` | `ssh <target> docker exec Agent-Vault agent-vault ca fetch` supplies and caches the root CA | the root CA must come from the environment or the cache |

`/jev-pruner` prints the active configuration and what happened to the last
large output; `/jev-pruner on` and `/jev-pruner off` toggle pruning and save it.

## How a decision is made

1. The complete output is split into chunks of `chunkLines` lines. Lines longer
   than 2000 characters are split first, and the chunk size widens rather than
   dropping lines when the 200-chunk cap would be hit.
2. The conversation comes from the active session branch: user and assistant
   text, tool calls with their results, and compaction summaries, most recent
   turns first within a token budget.
3. One `noul` question per chunk goes to Jev, batched so each request stays
   inside `maxStateTokens`. Build, install, and test commands add guidance about
   diagnostics and result counts; search commands add guidance about matches,
   paths, and line numbers.
4. A chunk is kept when Jev scores it at or above `keepThreshold`, when it
   matches a narrow error pattern, when it could not be scored, or when it is
   the first or last chunk. A dropped run becomes one marker:

   ```text
   [jev-pruner dropped 2840 lines; full output: /tmp/pi-bash-8a4c1d.log (read or grep it if needed)]
   ```

5. When pi already saved the complete stream, that file is the archive. When pi
   did not, the extension writes it to `.pi/jev-pruner/bash-<toolCallId>.txt`
   (self-gitignored) **before** returning the pruned text, because a dropped line
   with no file behind it is gone for good. A failed write abandons the prune.

## Differences from the Claude Code plugin

[jev-pruner](https://github.com/tamaratran/jev-pruner) wraps Claude's `tool.call`
result and has to invent its own archive, because Claude hands it the output.
pi already truncates and archives, so this package starts from the complete
stream and reuses pi's file. It also drops the Claude plugin's
persisted-output shrink machinery, which exists to fit a host display limit pi
does not have.

## Tests

```bash
pnpm --filter @whamp/pi-jev-pruner test        # offline suite, no network
pnpm --filter @whamp/pi-jev-pruner typecheck   # tsc --noEmit
```

The offline suite replaces the `JevAsker` seam, so no test reaches the network.
For a real end-to-end check against Jev through Agent Vault:

```bash
node --experimental-strip-types scripts/jev-live.ts
```
