import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "typebox";
import { Parse } from "typebox/value";
import { Outcome } from "./enums.ts";
import { hasErrorCode, normalizeError } from "./errors.ts";
import type { SettledHandoff, Snapshot } from "./types.ts";
import { zeroUsage } from "./types.ts";
import { assertSidekickChildSession } from "./sidekick/session.ts";
import type { SidekickChildSessionAdmission } from "./sidekick/session.ts";
import { SIDEKICK_SNAPSHOT_SCHEMA } from "./sidekick/sidekick-state-schema.ts";

const LOCK_OWNER_SCHEMA = Type.Object({ pid: Type.Integer({ minimum: 1 }), nonce: Type.String() });

/** Writes one JSON document atomically without replacing the previous bytes on failure. */
export function atomicJson(path: string, value: unknown): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Single-writer, private, parent-session-specific state. No model keys are stored. */
export class SidekickStore {
  readonly dir: string;
  readonly parentId: string;
  readonly cwd: string;
  readonly childSessionAdmission?: SidekickChildSessionAdmission;
  private nonce: string | undefined;

  constructor(
    root: string,
    cwd: string,
    parentId: string,
    childSessionAdmission?: SidekickChildSessionAdmission,
  ) {
    this.parentId = parentId;
    this.cwd = resolve(cwd);
    this.childSessionAdmission = childSessionAdmission
      ? {
          sessionDir: resolve(childSessionAdmission.sessionDir),
          parentSessionFile: childSessionAdmission.parentSessionFile,
        }
      : undefined;
    const key = createHash("sha256").update(`${this.cwd}\0${parentId}`).digest("hex").slice(0, 32);
    this.dir = join(root, "sidekick", "sessions", key);
  }
  acquire(): void {
    if (this.nonce) return;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const path = join(this.dir, "lock.json");
    const nonce = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(path, "wx", 0o600);
        try {
          writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }));
        } finally {
          closeSync(fd);
        }
        this.nonce = nonce;
        return;
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw normalizeError(error);
        // A malformed or live lock fails closed rather than risking two writers.
        let owner: { pid: number; nonce: string };
        try {
          owner = Parse(LOCK_OWNER_SCHEMA, JSON.parse(readFileSync(path, "utf8")));
        } catch (error) {
          throw new Error(
            `Unreadable Sidekick lock: ${path}. Check for another Pi instance before removing it.`,
            { cause: normalizeError(error) },
          );
        }
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if (hasErrorCode(error, "ESRCH") && attempt === 0) {
            try {
              unlinkSync(path);
            } catch (unlinkError) {
              if (!hasErrorCode(unlinkError, "ENOENT")) throw normalizeError(unlinkError);
            }
            continue;
          }
        }
        throw new Error(
          `This parent session already has a Sidekick owner (PID ${owner.pid}). Close that Pi instance first.`,
        );
      }
    }
    throw new Error("Could not acquire the Sidekick session lock.");
  }
  release(): void {
    if (!this.nonce) return;
    try {
      const path = join(this.dir, "lock.json");
      const owner = Parse(LOCK_OWNER_SCHEMA, JSON.parse(readFileSync(path, "utf8")));
      if (owner.nonce === this.nonce) unlinkSync(path);
    } finally {
      this.nonce = undefined;
    }
  }
  /** Creates empty version-3 Sidekick state with no persisted handoff. */
  fresh(): Snapshot {
    return {
      version: 3,
      parentId: this.parentId,
      cwd: this.cwd,
      epoch: randomUUID(),
      configOverrides: {},
      totals: zeroUsage(),
    };
  }
  /** Loads strict version-3 state and recovers an interrupted running handoff once. */
  load(): Snapshot {
    this.assertOwned();
    const path = join(this.dir, "state.json");
    if (!existsSync(path)) return this.fresh();
    let data: Snapshot;
    try {
      data = Parse(SIDEKICK_SNAPSHOT_SCHEMA, JSON.parse(readFileSync(path, "utf8")));
    } catch (cause) {
      if (cause instanceof SyntaxError) {
        throw new Error(
          `Corrupt Sidekick state: ${path}. Preserve it for inspection before resetting.`,
          { cause },
        );
      }
      throw new Error(`Invalid Sidekick state structure: ${path}`, {
        cause: normalizeError(cause),
      });
    }
    if (data.parentId !== this.parentId || data.cwd !== this.cwd) {
      throw new Error(`Invalid or mismatched Sidekick state: ${path}`);
    }
    const hasUntrustedPath = (value: string): boolean => !isAbsolute(value) || value.includes("\0");
    if (
      data.configOverrides.sidekickExtensions?.some(hasUntrustedPath) ||
      data.configOverrides.sidekickSkills?.some(hasUntrustedPath) ||
      (data.frozenSidekickPrompt &&
        (createHash("sha256").update(data.frozenSidekickPrompt.effectiveText).digest("hex") !==
          data.frozenSidekickPrompt.effectiveSha256 ||
          data.frozenSidekickPrompt.sidekickExtensions.some(hasUntrustedPath) ||
          data.frozenSidekickPrompt.sidekickSkills.some(hasUntrustedPath)))
    ) {
      throw new Error(`Invalid Sidekick state structure: ${path}`);
    }
    if (data.childSession) {
      try {
        if (!this.childSessionAdmission) {
          throw new Error("Persisted Sidekick child session admission context is unavailable.");
        }
        assertSidekickChildSession(data.childSession, {
          parentId: data.parentId,
          epoch: data.epoch,
          admission: this.childSessionAdmission,
          cwd: data.cwd,
        });
      } catch (cause) {
        throw new Error(`Invalid Sidekick state structure: ${path}`, {
          cause: normalizeError(cause),
        });
      }
    }
    try {
      this.validatePersistedReportPath(data, data.handoff);
    } catch (cause) {
      throw new Error(`Invalid Sidekick state structure: ${path}`, {
        cause: normalizeError(cause),
      });
    }
    if (data.handoff?.status === "running") {
      const runningHandoff = data.handoff;
      const recoveryError =
        "Previous Pi process ended during execution. No automatic replay; inspect partial changes.";
      const recoveryNote =
        "Previous Pi process ended before settlement; partial changes may remain. Inspect the working tree.";
      const recoveryReport = [runningHandoff.report, recoveryNote].filter(Boolean).join("\n\n");
      let report = recoveryReport;
      let reportPath: string | undefined;
      let recoveryDiagnostic: string | undefined;
      try {
        reportPath = this.saveReport(data, runningHandoff.id, recoveryReport);
      } catch (cause) {
        const expectedPath = this.reportFilePath(data, runningHandoff.id);
        if (hasErrorCode(cause, "EEXIST")) {
          try {
            if (this.existingReportMatches(expectedPath, recoveryReport)) {
              reportPath = expectedPath;
            } else if (
              runningHandoff.report.trim() !== "" &&
              this.existingReportMatches(expectedPath, runningHandoff.report)
            ) {
              report = runningHandoff.report;
              reportPath = expectedPath;
            } else {
              throw new Error(
                "The existing artifact is not the exact expected regular report file.",
              );
            }
          } catch (reuseCause) {
            recoveryDiagnostic = `Could not reuse interrupted report at ${expectedPath}: ${normalizeError(reuseCause).message}`;
          }
        } else {
          recoveryDiagnostic = `Could not save interrupted report: ${normalizeError(cause).message}`;
        }
      }
      if (recoveryDiagnostic !== undefined) {
        report = `${recoveryReport}\n\n${recoveryDiagnostic}`;
      }
      const interrupted: SettledHandoff = {
        ...runningHandoff,
        status: "settled",
        outcome: Outcome.INTERRUPTED,
        finishedAt: new Date().toISOString(),
        error: recoveryDiagnostic ? `${recoveryError} ${recoveryDiagnostic}` : recoveryError,
        report,
      };
      if (reportPath !== undefined) {
        interrupted.reportPath = reportPath;
      }
      data.handoff = interrupted;
      this.save(data);
    }
    return data;
  }
  save(snapshot: Snapshot): void {
    this.assertOwned();
    this.validatePersistedReportPath(snapshot, snapshot.handoff);
    atomicJson(join(this.dir, "state.json"), snapshot);
  }
  epochDir(snapshot: Snapshot): string {
    if (!/^[a-zA-Z0-9-]+$/u.test(snapshot.epoch)) throw new Error("Unsafe Sidekick epoch.");
    const dir = join(this.dir, snapshot.epoch);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
  /** Saves one complete handoff report under its unique ID without revision suffixes. */
  saveReport(snapshot: Snapshot, id: string, report: string): string {
    this.assertOwned();
    const path = this.reportFilePath(snapshot, id);
    mkdirSync(join(this.dir, snapshot.epoch), { recursive: true, mode: 0o700 });
    writeFileSync(path, report, { mode: 0o600, flag: "wx" });
    return path;
  }
  private reportFilePath(snapshot: Snapshot, id: string): string {
    if (!/^[a-zA-Z0-9-]+$/u.test(snapshot.epoch)) {
      throw new Error("Unsafe Sidekick epoch.");
    }
    if (!/^[a-zA-Z0-9-]+$/u.test(id)) {
      throw new Error("Unsafe Sidekick handoff ID.");
    }
    return resolve(join(this.dir, snapshot.epoch, `${id}.md`));
  }
  private validatePersistedReportPath(snapshot: Snapshot, handoff: Snapshot["handoff"]): void {
    if (!handoff || handoff.status !== "settled" || handoff.reportPath === undefined) {
      return;
    }
    const expectedPath = this.reportFilePath(snapshot, handoff.id);
    if (handoff.reportPath !== expectedPath) {
      throw new Error("Persisted Sidekick report path is not the canonical handoff artifact.");
    }
    let metadata;
    try {
      metadata = lstatSync(expectedPath);
    } catch (cause) {
      throw new Error("Persisted Sidekick report artifact is unavailable.", {
        cause: normalizeError(cause),
      });
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Persisted Sidekick report artifact is not a regular file.");
    }
    const reportBytes = readFileSync(expectedPath);
    if (!reportBytes.equals(Buffer.from(handoff.report, "utf8"))) {
      throw new Error("Persisted Sidekick report artifact bytes do not match the handoff.");
    }
  }
  private existingReportMatches(path: string, report: string): boolean {
    const metadata = lstatSync(path);
    return (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      readFileSync(path).equals(Buffer.from(report, "utf8"))
    );
  }
  private assertOwned(): void {
    if (!this.nonce) throw new Error("Sidekick store is not locked.");
  }
}
