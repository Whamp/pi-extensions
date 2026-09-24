import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Parse } from "typebox/value";

/** Custom-entry type used to identify a Pi Sidekick child session. */
export const SIDEKICK_CHILD_MARKER = "pi-sidekick-child" as const;
/** Display name written to every Pi Sidekick child session. */
export const SIDEKICK_CHILD_SESSION_NAME = "Sidekick" as const;

const CHILD_EPOCH_PATTERN = "^[A-Za-z0-9-]+$";
const SIDEKICK_CHILD_MARKER_SCHEMA = Type.Object(
  {
    parentId: Type.String({ minLength: 1 }),
    epoch: Type.String({ minLength: 1, pattern: CHILD_EPOCH_PATTERN }),
    sessionId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** The parent-session methods needed by this extension's documented Pi seam. */
export type ParentSessionManagerLike = Pick<
  SessionManager,
  "getSessionId" | "getSessionDir" | "getSessionFile" | "getEntries"
>;

/** Strict closed schema for the exact child identity persisted with one epoch. */
export const SIDEKICK_CHILD_SESSION_SCHEMA = Type.Object(
  {
    sessionFile: Type.String({ minLength: 1 }),
    sessionDir: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** Exact child session identity persisted with one Sidekick epoch. */
export type SidekickChildSessionIdentity = Static<typeof SIDEKICK_CHILD_SESSION_SCHEMA>;

/** Parent-session directory and exact lineage link admitted for one child session. */
export interface SidekickChildSessionAdmission {
  sessionDir: string;
  parentSessionFile?: string;
}

/** Expected parent and epoch identity for a persisted Sidekick child session. */
export interface SidekickChildSessionExpectation {
  parentId: string;
  epoch: string;
  admission: SidekickChildSessionAdmission;
  cwd?: string;
}

/** Marker data stored in the child session's private custom entry. */
export type SidekickChildSessionMarker = Static<typeof SIDEKICK_CHILD_MARKER_SCHEMA>;

function defaultSidekickSessionDirectory(cwd: string): string {
  // The package root does not export getDefaultSessionDir; this unmaterialized manager only reads Pi's default directory.
  const defaultManager = SessionManager.create(cwd);
  const defaultDirectory = defaultManager.getSessionDir();
  if (!defaultDirectory) throw new Error("Pi did not provide a default session directory.");
  return resolve(defaultDirectory);
}

/** Resolves the directory admitted for child sessions by the parent Pi manager. */
export function sidekickParentSessionDirectory(
  parentSessionManager: ParentSessionManagerLike,
  cwd: string,
): string {
  const configuredDirectory = parentSessionManager.getSessionDir();
  return resolve(configuredDirectory || defaultSidekickSessionDirectory(cwd));
}

interface ChildSessionPath {
  sessionFile: string;
  sessionDir: string;
}

function assertLexicalChildPath(path: ChildSessionPath): void {
  const resolvedFile = resolve(path.sessionFile);
  const resolvedDirectory = resolve(path.sessionDir);
  if (dirname(resolvedFile) !== resolvedDirectory) {
    throw new Error(
      `Sidekick child session must stay directly in the parent session directory: ${resolvedFile}`,
    );
  }
}

function assertDirectChildPath(path: ChildSessionPath): void {
  const resolvedFile = resolve(path.sessionFile);
  const resolvedDirectory = resolve(path.sessionDir);
  assertLexicalChildPath({ sessionFile: resolvedFile, sessionDir: resolvedDirectory });
  let realDirectory: string;
  let realFile: string;
  try {
    realDirectory = realpathSync(resolvedDirectory);
    realFile = realpathSync(resolvedFile);
  } catch (cause) {
    throw new Error(`Cannot resolve the Sidekick child session path: ${resolvedFile}`, { cause });
  }
  if (dirname(realFile) !== realDirectory) {
    throw new Error(
      `Sidekick child session resolves outside the parent session directory: ${resolvedFile}`,
    );
  }
}

function materializeSession(manager: SessionManager, sessionFile: string): void {
  const header = manager.getHeader();
  if (!header) throw new Error("Pi did not produce a child session header.");
  const entries = [header, ...manager.getEntries()];
  const temporaryFile = `${sessionFile}.${randomUUID()}.tmp`;
  try {
    const descriptor = openSync(temporaryFile, "wx", 0o600);
    try {
      for (const entry of entries) {
        const line = JSON.stringify(entry);
        if (!line) throw new Error("Pi produced an unserializable child session entry.");
        writeFileSync(descriptor, `${line}\n`);
      }
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    // A hard link publishes the fully written file atomically and refuses to replace a collision.
    linkSync(temporaryFile, sessionFile);
  } finally {
    if (existsSync(temporaryFile)) unlinkSync(temporaryFile);
  }
}

/** Returns whether a session contains the Sidekick child marker, without trusting its payload. */
export function isSidekickChildSession(sessionManager: ParentSessionManagerLike): boolean {
  return sessionManager
    .getEntries()
    .some((entry) => entry.type === "custom" && entry.customType === SIDEKICK_CHILD_MARKER);
}

/** Parses the unique Sidekick child marker from a session, failing closed on counterfeit data. */
export function readSidekickChildSessionMarker(
  sessionManager: ParentSessionManagerLike,
): SidekickChildSessionMarker | undefined {
  const markerEntries = sessionManager
    .getEntries()
    .filter((entry) => entry.type === "custom" && entry.customType === SIDEKICK_CHILD_MARKER);
  if (markerEntries.length === 0) return undefined;
  if (markerEntries.length !== 1) {
    throw new Error("Sidekick child session contains multiple child markers.");
  }
  const marker = markerEntries[0];
  if (marker.type !== "custom") throw new Error("Invalid Sidekick child marker entry.");
  try {
    return Parse(SIDEKICK_CHILD_MARKER_SCHEMA, marker.data);
  } catch (cause) {
    throw new Error("Invalid Sidekick child marker data.", { cause });
  }
}

/** Creates, materializes, and independently reopens one Pi-owned child session file. */
export function createSidekickChildSession(
  parentSessionManager: ParentSessionManagerLike,
  cwd: string,
  epoch: string,
): SidekickChildSessionIdentity {
  const parentId = parentSessionManager.getSessionId();
  if (!parentId) throw new Error("The parent Pi session has no session ID.");
  const sessionDir = sidekickParentSessionDirectory(parentSessionManager, cwd);
  const parentSessionFile = parentSessionManager.getSessionFile() || undefined;
  const admission = { sessionDir, parentSessionFile };
  const manager = SessionManager.create(
    cwd,
    sessionDir,
    parentSessionFile ? { parentSession: parentSessionFile } : undefined,
  );
  const sessionFile = manager.getSessionFile();
  if (!sessionFile) throw new Error("Pi did not allocate a child session file.");
  assertLexicalChildPath({ sessionFile, sessionDir });
  const sessionId = manager.getSessionId();
  manager.appendSessionInfo(SIDEKICK_CHILD_SESSION_NAME);
  manager.appendCustomEntry(SIDEKICK_CHILD_MARKER, {
    parentId,
    epoch,
    sessionId,
  });
  materializeSession(manager, sessionFile);
  const identity = { sessionFile: resolve(sessionFile), sessionDir, sessionId };
  assertSidekickChildSession(identity, { parentId, epoch, admission });
  return identity;
}

/** Reopens and validates a persisted child file against its expected parent and epoch. */
export function assertSidekickChildSession(
  identity: SidekickChildSessionIdentity,
  expectation: SidekickChildSessionExpectation,
): void {
  if (!isAbsolute(identity.sessionFile) || !isAbsolute(identity.sessionDir)) {
    throw new Error("Persisted Sidekick child session paths must be absolute.");
  }
  const sessionFile = resolve(identity.sessionFile);
  const sessionDir = resolve(identity.sessionDir);
  if (!sessionFile.endsWith(".jsonl")) {
    throw new Error("Persisted Sidekick child session must be a JSONL file.");
  }
  if (!expectation.admission) {
    throw new Error("Persisted Sidekick child session admission context is unavailable.");
  }
  if (sessionDir !== resolve(expectation.admission.sessionDir)) {
    throw new Error(
      "Persisted Sidekick child session is outside the admitted parent session directory.",
    );
  }
  if (!existsSync(sessionFile)) {
    throw new Error(`Persisted Sidekick child session is missing: ${sessionFile}`);
  }
  assertDirectChildPath({ sessionFile, sessionDir });
  let manager: SessionManager;
  try {
    manager = SessionManager.open(sessionFile, sessionDir, expectation.cwd);
  } catch (cause) {
    throw new Error(`Persisted Sidekick child session cannot be reopened: ${sessionFile}`, {
      cause,
    });
  }
  const header = manager.getHeader();
  if (!header || header.id !== identity.sessionId) {
    throw new Error("Persisted Sidekick child session ID does not match its snapshot.");
  }
  if (header.parentSession !== expectation.admission.parentSessionFile) {
    throw new Error("Persisted Sidekick child session parent link does not match its admission.");
  }
  if (manager.getSessionName() !== SIDEKICK_CHILD_SESSION_NAME) {
    throw new Error("Persisted Sidekick child session has an unexpected session name.");
  }
  const marker = readSidekickChildSessionMarker(manager);
  if (
    !marker ||
    marker.parentId !== expectation.parentId ||
    marker.epoch !== expectation.epoch ||
    marker.sessionId !== header.id
  ) {
    throw new Error("Persisted Sidekick child session marker does not match its parent or epoch.");
  }
}
