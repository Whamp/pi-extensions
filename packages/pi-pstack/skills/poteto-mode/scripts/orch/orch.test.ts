import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NotFoundError,
  UserError,
  openStore,
  parseVerdict,
  type OpenStoreOptions,
  type Store,
} from "./store.ts";

const SCRIPT = join(import.meta.dir, "orch.ts");
const directories: string[] = [];
const handles: Store[] = [];

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "orch-test-"));
  directories.push(directory);
  return directory;
}

function useStore(directory: string, options?: OpenStoreOptions): Store {
  const store = openStore(directory, options);
  handles.push(store);
  return store;
}

async function initializedStore(): Promise<{
  readonly directory: string;
  readonly store: Store;
}> {
  const directory = await makeDirectory();
  const store = useStore(directory);
  await store.init();
  return { directory, store };
}

function git({
  args,
  repo,
}: {
  args: readonly string[];
  repo: string;
}): string {
  const result = Bun.spawnSync(["git", "-C", repo, ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString().trim();
}

async function makeGitProgram(directory: string): Promise<string> {
  const repo = join(directory, "repo");
  await mkdir(repo);
  git({ repo, args: ["init", "--initial-branch=master"] });
  git({ repo, args: ["config", "user.name", "Orch Test"] });
  git({ repo, args: ["config", "user.email", "orch@example.com"] });
  await writeFile(join(repo, "base.txt"), "base\n");
  git({ repo, args: ["add", "."] });
  git({ repo, args: ["commit", "-m", "base"] });
  for (const branch of ["change/merged", "change/closed", "change/open"]) {
    git({ repo, args: ["checkout", "-b", branch, "master"] });
    git({ repo, args: ["commit", "--allow-empty", "-m", branch] });
  }
  return repo;
}

interface GithubFixture {
  readonly repo: string;
  readonly repositoryFile: string;
  readonly pullRequestsDirectory: string;
  readonly commandLog: string;
}

interface GithubFixtureOperation<T> {
  readonly directory: string;
  readonly operation: (fixture: GithubFixture) => Promise<T>;
}

function pullRequestFixture(pr: number, branch: string, state = "OPEN") {
  return {
    number: pr,
    headRefName: branch,
    headRefOid: String(pr % 10).repeat(40),
    baseRefName: "master",
    state,
    isDraft: false,
    url: `https://github.com/example/project/pull/${pr}`,
  };
}

async function withFakeGithub<T>(
  params: GithubFixtureOperation<T>,
): Promise<T> {
  const { directory, operation } = params;
  const repo = await makeGitProgram(directory);
  const bin = join(directory, "bin");
  const repositoryFile = join(directory, "repository.json");
  const pullRequestsDirectory = join(directory, "prs");
  const commandLog = join(directory, "gh-commands.txt");
  await mkdir(bin);
  await mkdir(pullRequestsDirectory);
  await writeFile(
    repositoryFile,
    JSON.stringify({
      url: "https://github.com/example/project",
      defaultBranchRef: { name: "master" },
    }),
  );
  for (const row of [
    pullRequestFixture(10, "change/merged", "MERGED"),
    pullRequestFixture(13, "change/closed", "CLOSED"),
    pullRequestFixture(11, "change/open"),
    pullRequestFixture(99, "unrelated"),
  ]) {
    await writeFile(
      join(pullRequestsDirectory, `${row.number}.json`),
      JSON.stringify(row),
    );
  }
  const gh = join(bin, "gh");
  await writeFile(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$(pwd -P)" != "${realpathSync(repo)}" ]; then
  printf 'gh ran outside the fixture repo\\n' >&2
  exit 2
fi
if [ -n "\${GH_REPO:-}" ] || [ -n "\${GH_HOST:-}" ]; then
  printf 'ambient repository override reached gh\\n' >&2
  exit 2
fi
printf '%s\\n' "$*" >> "${commandLog}"
case "$*" in
  "repo view --json url,defaultBranchRef")
    cat "${repositoryFile}"
    ;;
  "pr view "*" --repo https://github.com/example/project --json number,state,headRefName,headRefOid,baseRefName,isDraft,url")
    cat "${pullRequestsDirectory}/$3.json"
    ;;
  *)
    printf 'unexpected gh arguments: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`,
  );
  await chmod(gh, 0o755);
  const gt = join(bin, "gt");
  await writeFile(gt, "#!/bin/sh\necho 'Graphite must not run' >&2\nexit 98\n");
  await chmod(gt, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  try {
    return await operation({
      repo,
      repositoryFile,
      pullRequestsDirectory,
      commandLog,
    });
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
}

function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): RunResult {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], { env });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterEach(async () => {
  for (const store of handles.splice(0).reverse()) {
    await store.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Store", () => {
  it("initializes an idempotent plain-file store and releases its lock", async () => {
    const directory = await makeDirectory();
    const store = useStore(directory);

    expect(await store.init()).toEqual({ store: directory });
    const firstUnits = await readFile(join(directory, "units.tsv"), "utf8");
    const firstLedger = await readFile(join(directory, "ledger.tsv"), "utf8");

    expect(await store.init()).toEqual({ store: directory });
    expect(await readFile(join(directory, "units.tsv"), "utf8")).toBe(
      firstUnits,
    );
    expect(await readFile(join(directory, "ledger.tsv"), "utf8")).toBe(
      firstLedger,
    );
    expect((await readdir(directory)).sort()).toEqual([
      ".orch.lock",
      "frontier.json",
      "gates.md",
      "inbox",
      "ledger.tsv",
      "preferences.md",
      "units.tsv",
    ]);

    await store.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("composes unit add, set, get, list, and counts", async () => {
    const { store } = await initializedStore();

    expect(
      await store.units.add({
        id: "u1",
        track: "build",
        brief: "briefs/u1.md",
      }),
    ).toMatchObject({ id: "u1", state: "pending" });
    expect(
      await store.units.add({ id: "=SUM(A1)", track: "+build" }),
    ).toMatchObject({
      id: "'=SUM(A1)",
      track: "'+build",
    });

    const updated = await store.units.set({
      id: "u1",
      state: "done",
      branch: "poteto/u1",
      pr: 184530,
      sha: "abc123",
    });
    expect(updated).toEqual({
      id: "u1",
      track: "build",
      state: "done",
      branch: "poteto/u1",
      pr: "184530",
      sha: "abc123",
      brief: "briefs/u1.md",
    });
    expect(await store.units.get("u1")).toEqual(updated);
    expect(await store.units.list({ state: "done", track: "build" })).toEqual([
      updated,
    ]);
    expect(await store.units.counts()).toEqual({ done: 1, pending: 1 });
    await expect(store.units.add({ id: "u1", track: "build" })).rejects.toThrow(
      "unit u1 already exists",
    );
    await expect(
      store.units.set({ id: "missing", state: "done" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records, replaces, checks, and summarizes typed ledger verdicts", async () => {
    const { store } = await initializedStore();

    try {
      await store.ledger.check({ pr: 184530, sha: "abc123" });
      throw new Error("expected ledger check to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      if (error instanceof NotFoundError) {
        expect(error.output).toEqual({
          compact: "NOT-VERIFIED",
          json: {
            pr: "184530",
            sha: "abc123",
            verdict: "NOT-VERIFIED",
          },
        });
      }
    }
    expect(() => parseVerdict("looks-good")).toThrow("verdict must be");

    const recorded = await store.ledger.record({
      pr: 184530,
      sha: "abc123",
      verdict: "unit-test-verified",
      evidence: "reports/verify.md",
      verifier: "sol",
    });
    expect(await store.ledger.check({ pr: 184530, sha: "abc123" })).toEqual(
      recorded,
    );
    expect(await store.ledger.summary()).toEqual({
      "unit-test-verified": 1,
    });

    await store.ledger.record({
      pr: 184530,
      sha: "abc123",
      verdict: "live-ui-verified",
      evidence: "reports/live.md",
    });
    expect(await store.ledger.summary()).toEqual({
      "live-ui-verified": 1,
    });
  });

  it("pushes, peeks, and atomically drains inbox pointers", async () => {
    const { directory, store } = await initializedStore();

    const first = await store.inbox.push({
      agent: "worker-1",
      unit: "u1",
      status: "done",
      report: "reports/u1.md",
    });
    expect(first.pointer).toMatchObject({ unit: "u1", status: "done" });
    expect(first.filename).toEndWith(".tsv");
    await store.inbox.push({
      agent: "worker-2",
      unit: "u2",
      status: "failed",
    });

    expect(await store.inbox.count()).toBe(2);
    expect(await store.inbox.peek()).toHaveLength(2);
    expect(await store.inbox.count()).toBe(2);
    expect(await store.inbox.drain()).toHaveLength(2);
    expect(await store.inbox.count()).toBe(0);
    expect(await readdir(join(directory, "inbox"))).toEqual([]);
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith(".inbox-drain-"),
      ),
    ).toEqual([]);
  });

  it("replaces a stale lock whose holder pid is dead", async () => {
    const { directory } = await initializedStore();
    const exited = Bun.spawn(["true"]);
    await exited.exited;
    await writeFile(join(directory, ".orch.lock"), `${exited.pid}\n`);

    const stale: string[] = [];
    const recovered = useStore(directory, {
      onStaleLock: (holder) => stale.push(holder),
    });
    expect(
      await recovered.units.add({ id: "u1", track: "build" }),
    ).toMatchObject({ id: "u1" });
    expect(stale).toEqual([String(exited.pid)]);
    await recovered.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("blocks a writer and steals the pid lock only with force", async () => {
    const { directory, store } = await initializedStore();
    await store.close();
    await writeFile(join(directory, ".orch.lock"), `${process.pid}\n`);

    const blocked = useStore(directory);
    await expect(
      blocked.units.add({ id: "u1", track: "build" }),
    ).rejects.toThrow(`store lock held by pid ${process.pid}`);

    const stolen: string[] = [];
    const forced = useStore(directory, {
      force: true,
      onLockStolen: (holder) => stolen.push(holder),
    });
    expect(await forced.units.add({ id: "u1", track: "build" })).toMatchObject({
      id: "u1",
    });
    expect(stolen).toEqual([String(process.pid)]);
    await forced.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("parks gates, stores standing orders, and renders status", async () => {
    const { directory, store } = await initializedStore();
    await store.units.add({ id: "u1", track: "build" });
    expect(
      await store.gates.park({
        id: "release",
        question: "Ship now?",
        options: "ship,wait",
        defaultAnswer: "wait",
      }),
    ).toMatchObject({ kind: "open", id: "release" });
    expect(await store.standing.add({ line: "Never force push." })).toEqual({
      number: 1,
      line: "Never force push.",
    });

    const first = await store.status.render();
    expect(first.changed).toBe("first render");
    expect(first.summary.openGateIds).toEqual(["release"]);
    expect(await readFile(join(directory, "status.md"), "utf8")).toContain(
      "| release | open | Ship now? |",
    );
    expect((await store.status.render()).changed).toBe("no derived changes");

    expect(
      await store.gates.resolve({ id: "release", answer: "ship" }),
    ).toMatchObject({
      kind: "resolved",
      answer: "ship",
    });
    expect((await store.status.render()).changed).toBe("open gates 1->0");
    expect(await store.gates.list()).toEqual([]);
    expect(await store.standing.show()).toEqual([
      { number: 1, line: "Never force push." },
    ]);
  });

  it("snapshots only enrolled independent PRs using remote heads and the real default branch", async () => {
    const { directory, store } = await initializedStore();
    await withFakeGithub({
      directory,
      operation: async ({ repo, commandLog }) => {
        const result = await store.frontier.set({ repo, prs: [13, 10, 11] });
        expect(result).toEqual({
          generation: 1,
          repository: {
            url: "https://github.com/example/project",
            defaultBranch: "master",
          },
          prs: [
            {
              pr: 10,
              branches: "change/merged",
              sha: "0".repeat(40),
              state: "MERGED",
            },
            {
              pr: 11,
              branches: "change/open",
              sha: "1".repeat(40),
              state: "OPEN",
            },
            {
              pr: 13,
              branches: "change/closed",
              sha: "3".repeat(40),
              state: "CLOSED",
            },
          ],
        });
        expect(git({ repo, args: ["rev-parse", "change/open"] })).not.toBe(
          result.prs[1]?.sha ?? "",
        );
        expect(await store.frontier.show()).toEqual(result);
        expect(
          (await store.frontier.set({ repo, prs: [10, 11, 13] })).generation,
        ).toBe(2);
        expect(await readFile(commandLog, "utf8")).not.toContain("pr view 99 ");
        expect(await store.status.render()).toMatchObject({
          frontier: { generation: 2 },
        });
        const status = await readFile(join(directory, "status.md"), "utf8");
        expect(status).toContain("Default branch: master");
        expect(status).not.toContain("Lowest unmerged");
      },
    });
  });

  it("derives membership from unit PRs without enrolling unrelated repository work", async () => {
    const { directory, store } = await initializedStore();
    for (const id of ["first", "second"]) {
      await store.units.add({ id, track: "build" });
      await store.units.set({
        id,
        state: "review",
        pr: 11,
        branch: "change/open",
      });
    }
    await withFakeGithub({
      directory,
      operation: async ({ repo, commandLog }) => {
        expect((await store.frontier.set({ repo })).prs).toEqual([
          {
            pr: 11,
            branches: "change/open",
            sha: "1".repeat(40),
            state: "OPEN",
          },
        ]);
        expect(await readFile(commandLog, "utf8")).not.toContain("pr view 99 ");
        await expect(store.frontier.set({ repo, prs: [10] })).rejects.toThrow(
          "--prs omits recorded program PRs: 11",
        );
        await expect(
          store.frontier.set({ repo, prs: [11, 11] }),
        ).rejects.toThrow("--prs must not contain duplicates");
        await store.units.set({
          id: "first",
          state: "review",
          branch: "wrong-branch",
        });
        await expect(store.frontier.set({ repo })).rejects.toThrow(
          "head branch does not match unit first",
        );
      },
    });
  });

  it("does not replace the snapshot when a PR read or metadata validation fails", async () => {
    const { directory, store } = await initializedStore();
    await withFakeGithub({
      directory,
      operation: async ({ repo, repositoryFile, pullRequestsDirectory }) => {
        await store.frontier.set({ repo, prs: [10, 11] });
        const saved = await readFile(join(directory, "frontier.json"), "utf8");
        const prFile = join(pullRequestsDirectory, "11.json");
        const valid = pullRequestFixture(11, "change/open");
        for (const mutation of [
          { ...valid, number: 99 },
          { ...valid, url: "https://github.com/other/project/pull/11" },
          { ...valid, headRefOid: "bad-sha" },
          { ...valid, state: "UNKNOWN" },
          { ...valid, isDraft: true },
          { ...valid, baseRefName: "change/merged" },
          { ...valid, headRefName: "" },
        ]) {
          await writeFile(prFile, JSON.stringify(mutation));
          await expect(
            store.frontier.set({ repo, prs: [10, 11] }),
          ).rejects.toBeInstanceOf(UserError);
          expect(await readFile(join(directory, "frontier.json"), "utf8")).toBe(
            saved,
          );
        }
        await writeFile(prFile, "not JSON");
        await expect(
          store.frontier.set({ repo, prs: [10, 11] }),
        ).rejects.toThrow("returned invalid JSON");
        expect(await readFile(join(directory, "frontier.json"), "utf8")).toBe(
          saved,
        );
        await rm(prFile);
        await expect(
          store.frontier.set({ repo, prs: [10, 11] }),
        ).rejects.toThrow("gh pr view 11");
        expect(await readFile(join(directory, "frontier.json"), "utf8")).toBe(
          saved,
        );
        await writeFile(
          repositoryFile,
          JSON.stringify({
            url: "https://github.com/other/project",
            defaultBranchRef: { name: "master" },
          }),
        );
        await expect(store.frontier.set({ repo, prs: [10] })).rejects.toThrow(
          "program repository changed",
        );
        expect(await readFile(join(directory, "frontier.json"), "utf8")).toBe(
          saved,
        );
      },
    });
  });

  it("rejects empty enrollment without clearing existing program history", async () => {
    const { directory, store } = await initializedStore();
    await expect(store.frontier.set({ repo: directory })).rejects.toThrow(
      "program has no PRs",
    );
    expect(await store.frontier.show()).toEqual({ generation: 0, prs: [] });
  });

  it("invalidates an old verdict when the enrolled remote PR head changes", async () => {
    const { directory, store } = await initializedStore();
    await withFakeGithub({
      directory,
      operation: async ({ repo, pullRequestsDirectory }) => {
        await store.frontier.set({ repo, prs: [11] });
        await store.ledger.record({
          pr: 11,
          sha: "1".repeat(40),
          verdict: "unit-test-verified",
          evidence: "report.md",
        });
        await writeFile(
          join(pullRequestsDirectory, "11.json"),
          JSON.stringify({
            ...pullRequestFixture(11, "change/open"),
            headRefOid: "a".repeat(40),
          }),
        );
        const refreshed = await store.frontier.set({ repo, prs: [11] });
        expect(refreshed.prs[0]?.sha).toBe("a".repeat(40));
        await expect(
          store.ledger.check({ pr: 11, sha: "a".repeat(40) }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(
          await store.ledger.check({ pr: 11, sha: "1".repeat(40) }),
        ).toMatchObject({
          verdict: "unit-test-verified",
          sha: "1".repeat(40),
        });
      },
    });
  });

  it("rejects malformed TSV, verdict, frontier, and inbox data", async () => {
    const { directory, store } = await initializedStore();

    await writeFile(join(directory, "units.tsv"), "wrong\n");
    await expect(store.units.list()).rejects.toThrow(
      "units.tsv has an invalid header",
    );
    await writeFile(
      join(directory, "units.tsv"),
      "id\ttrack\tstate\tbranch\tpr\tsha\tbrief\nshort\trow\n",
    );
    await expect(store.units.list()).rejects.toThrow(
      "units.tsv has a malformed row",
    );

    await writeFile(
      join(directory, "ledger.tsv"),
      "pr\tsha\tverdict\tevidence\tverifier\tts\n1\tsha\tinvalid\treport\tme\tnow\n",
    );
    await expect(store.ledger.summary()).rejects.toThrow(
      "ledger.tsv has invalid verdict invalid",
    );

    await writeFile(join(directory, "frontier.json"), '{"generation":"1"}\n');
    await expect(store.frontier.show()).rejects.toThrow(
      "frontier.json has an invalid shape",
    );

    await writeFile(join(directory, "inbox", "bad.tsv"), "too\tshort\n");
    await expect(store.inbox.peek()).rejects.toThrow(
      "inbox pointer bad.tsv is malformed",
    );
  });

  it("rejects operations after close", async () => {
    const { store } = await initializedStore();
    await store.close();
    await expect(store.units.list()).rejects.toThrow("store is closed");
    await expect(store.status.render()).rejects.toBeInstanceOf(UserError);
  });
});

describe("orch CLI", () => {
  it("prints commander help and rejects invalid parsing with exit 1", async () => {
    const help = runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Commands:");
    expect(help.stdout).toContain("unit");
    expect(help.stdout).toContain("ledger");

    const frontierHelp = runCli(["frontier", "set", "--help"]);
    expect(frontierHelp.code).toBe(0);
    expect(frontierHelp.stdout).toContain("--repo <dir>");
    expect(frontierHelp.stdout).toContain("--prs <n,...>");

    const directory = await makeDirectory();
    const invalid = runCli(["--store", directory, "unit", "add", "u1"]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("required option '--track <track>'");
  });

  it("rejects relative program directories before writing", () => {
    const direct = runCli(["--store", ".pi/pstack/programs/example", "init"]);
    expect(direct.code).toBe(1);
    expect(direct.stderr).toContain(
      "must be an absolute shared program directory",
    );
    const inherited = runCli(["init"], {
      ...process.env,
      ORCH_STORE: "relative",
    });
    expect(inherited.code).toBe(1);
    expect(inherited.stderr).toContain(
      "must be an absolute shared program directory",
    );
  });

  it("refreshes program PRs through the real CLI with ambient repository overrides excluded", async () => {
    const directory = await makeDirectory();
    expect(runCli(["--store", directory, "init"]).code).toBe(0);
    await withFakeGithub({
      directory,
      operation: async ({ repo }) => {
        const result = runCli(
          [
            "--store",
            directory,
            "--json",
            "frontier",
            "set",
            "--repo",
            repo,
            "--prs",
            "11",
          ],
          {
            ...process.env,
            GH_REPO: "other/project",
            GH_HOST: "other.example",
          },
        );
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          generation: 1,
          repository: {
            url: "https://github.com/example/project",
            defaultBranch: "master",
          },
          prs: [
            {
              pr: 11,
              branches: "change/open",
              sha: "1".repeat(40),
              state: "OPEN",
            },
          ],
        });
      },
    });
  });

  it("accepts ORCH_STORE and emits complete JSON", async () => {
    const directory = await makeDirectory();
    const env = { ...process.env, ORCH_STORE: directory };
    expect(runCli(["init"], env).code).toBe(0);

    const added = runCli(
      ["unit", "add", "u1", "--track", "build", "--json"],
      env,
    );
    expect(added.code).toBe(0);
    expect(JSON.parse(added.stdout)).toEqual({
      id: "u1",
      track: "build",
      state: "pending",
      branch: "",
      pr: "",
      sha: "",
      brief: "",
    });
  });

  it("maps user and not-found outcomes to the preserved exit codes", async () => {
    const directory = await makeDirectory();
    expect(runCli(["--store", directory, "init"]).code).toBe(0);

    const missingRepo = runCli(["--store", directory, "frontier", "set"]);
    expect(missingRepo.code).toBe(1);
    expect(missingRepo.stderr).toContain("set --repo <dir> or ORCH_REPO");

    const userError = runCli([
      "--store",
      directory,
      "unit",
      "add",
      "",
      "--track",
      "build",
    ]);
    expect(userError.code).toBe(1);
    expect(userError.stderr).toContain("unit id must not be empty");

    const missingUnit = runCli([
      "--store",
      directory,
      "unit",
      "get",
      "missing",
    ]);
    expect(missingUnit.code).toBe(2);
    expect(missingUnit.stderr).toContain("unit missing not found");

    const missingLedger = runCli([
      "--store",
      directory,
      "--json",
      "ledger",
      "check",
      "184530",
      "abc123",
    ]);
    expect(missingLedger.code).toBe(2);
    expect(JSON.parse(missingLedger.stdout)).toEqual({
      pr: "184530",
      sha: "abc123",
      verdict: "NOT-VERIFIED",
    });
    expect(missingLedger.stderr).toBe("");
  });
});
