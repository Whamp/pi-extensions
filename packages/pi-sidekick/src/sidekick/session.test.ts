import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent";
import { test } from "node:test";
import { hasErrorCode, normalizeError } from "../errors.ts";
import {
  assertSidekickChildSession,
  createSidekickChildSession,
  isSidekickChildSession,
  readSidekickChildSessionMarker,
  sidekickParentSessionDirectory,
  SIDEKICK_CHILD_MARKER,
  SIDEKICK_CHILD_SESSION_NAME,
} from "./session.ts";

test("SessionManager child materialization links the unmaterialized parent", async () => {
  const root = mkdtempSync(join(tmpdir(), "sidekick-child-session-"));
  const sessionDir = join(root, "sessions");
  mkdirSync(sessionDir);
  const parent = SessionManager.create(root, sessionDir, { id: "parent-session" });
  const parentSessionFile = parent.getSessionFile();
  assert.ok(parentSessionFile);
  assert.equal(existsSync(parentSessionFile), false);
  try {
    const child = createSidekickChildSession(parent, root, "epoch-one");
    assert.equal(dirname(child.sessionFile), sessionDir);
    assert.equal(existsSync(parentSessionFile), false);
    const entries = parseSessionEntries(readFileSync(child.sessionFile, "utf8"));
    const header = entries[0];
    const sessionInfo = entries[1];
    const marker = entries[2];
    assert.equal(header.type, "session");
    if (header.type !== "session") throw new Error("Child session header was not a session entry.");
    assert.equal(header.parentSession, parentSessionFile);
    assert.equal(header.id, child.sessionId);
    assert.equal(sessionInfo.type, "session_info");
    if (sessionInfo.type !== "session_info")
      throw new Error("Child session name was not a session_info entry.");
    assert.equal(sessionInfo.name, SIDEKICK_CHILD_SESSION_NAME);
    assert.equal(marker.type, "custom");
    if (marker.type !== "custom") throw new Error("Child marker was not a custom entry.");
    assert.equal(marker.customType, SIDEKICK_CHILD_MARKER);
    assert.deepEqual(marker.data, {
      parentId: parent.getSessionId(),
      epoch: "epoch-one",
      sessionId: child.sessionId,
    });
    if (process.platform !== "win32") assert.equal(statSync(child.sessionFile).mode & 0o777, 0o600);

    const reopened = SessionManager.open(child.sessionFile, sessionDir);
    assert.equal(reopened.getSessionId(), child.sessionId);
    assert.equal(reopened.getSessionName(), SIDEKICK_CHILD_SESSION_NAME);
    assert.equal(isSidekickChildSession(reopened), true);
    assert.deepEqual(readSidekickChildSessionMarker(reopened), marker.data);
    const listedChild = (await SessionManager.list(root, sessionDir)).find(
      (session) => session.path === child.sessionFile,
    );
    assert.ok(listedChild);
    assert.equal(listedChild.name, SIDEKICK_CHILD_SESSION_NAME);
    assert.equal(listedChild.parentSessionPath, parentSessionFile);
    assert.doesNotThrow(() =>
      assertSidekickChildSession(child, {
        parentId: parent.getSessionId(),
        epoch: "epoch-one",
        admission: { sessionDir, parentSessionFile },
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("in-memory parents use Pi's default session directory without a phantom parent", async () => {
  const root = mkdtempSync(join(tmpdir(), "sidekick-child-default-dir-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    const parent = SessionManager.inMemory(cwd);
    assert.equal(parent.getSessionDir(), "");
    const expectedDirectory = SessionManager.create(cwd).getSessionDir();
    assert.equal(sidekickParentSessionDirectory(parent, cwd), expectedDirectory);
    const child = createSidekickChildSession(parent, cwd, "epoch-default");
    assert.equal(child.sessionDir, expectedDirectory);
    const childHeader = parseSessionEntries(readFileSync(child.sessionFile, "utf8"))[0];
    assert.equal(childHeader.type, "session");
    if (childHeader.type !== "session") throw new Error("Child header was not a session entry.");
    assert.equal(childHeader.parentSession, undefined);
    assert.equal(parent.getSessionFile(), undefined);
    const listed = await SessionManager.list(cwd, expectedDirectory);
    assert.deepEqual(
      listed.map((session) => session.path),
      [child.sessionFile],
    );
  } finally {
    if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    rmSync(root, { recursive: true, force: true });
  }
});

test("persisted child identity fails closed for counterfeit and mismatched files", () => {
  const root = mkdtempSync(join(tmpdir(), "sidekick-child-validation-"));
  const sessionDir = join(root, "sessions");
  mkdirSync(sessionDir);
  const parent = SessionManager.create(root, sessionDir, { id: "parent-session" });
  const parentSessionFile = parent.getSessionFile();
  const admission = { sessionDir, parentSessionFile };
  const expected = { parentId: parent.getSessionId(), epoch: "epoch-one", admission };
  try {
    const missing = createSidekickChildSession(parent, root, expected.epoch);
    rmSync(missing.sessionFile);
    assert.throws(() => assertSidekickChildSession(missing, expected), /missing/u);

    const outsideDir = join(root, "outside");
    mkdirSync(outsideDir);
    const outsideFile = join(outsideDir, "counterfeit.jsonl");
    const outside = createSidekickChildSession(parent, root, "epoch-outside");
    const bytes = readFileSync(outside.sessionFile);
    // The validator rejects the admitted-directory mismatch before trusting the copied file.
    const outsideIdentity = { ...outside, sessionFile: outsideFile, sessionDir: outsideDir };
    writeFileSync(outsideFile, bytes, { mode: 0o600 });
    assert.throws(
      () =>
        assertSidekickChildSession(outsideIdentity, {
          parentId: parent.getSessionId(),
          epoch: "epoch-outside",
          admission,
        }),
      /outside the admitted/u,
    );

    const renamed = createSidekickChildSession(parent, root, "epoch-renamed");
    const renamedEntries = parseSessionEntries(readFileSync(renamed.sessionFile, "utf8"));
    const sessionInfoEntries = renamedEntries.filter((entry) => entry.type === "session_info");
    assert.equal(sessionInfoEntries.length, 1);
    const sessionInfo = sessionInfoEntries[0];
    if (sessionInfo.type !== "session_info")
      throw new Error("Renamed child session_info entry was not found.");
    sessionInfo.name = "Counterfeit";
    writeFileSync(
      renamed.sessionFile,
      `${renamedEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        assertSidekickChildSession(renamed, {
          ...expected,
          epoch: "epoch-renamed",
        }),
      /unexpected session name/u,
    );

    const lineage = createSidekickChildSession(parent, root, "epoch-lineage");
    const rewriteLineageHeader = (parentSession?: string): void => {
      const entries = parseSessionEntries(readFileSync(lineage.sessionFile, "utf8"));
      const header = entries[0];
      if (header.type !== "session") throw new Error("Lineage header was not a session entry.");
      if (parentSession === undefined) delete header.parentSession;
      else header.parentSession = parentSession;
      writeFileSync(
        lineage.sessionFile,
        `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        { mode: 0o600 },
      );
    };
    rewriteLineageHeader(join(root, "different-parent.jsonl"));
    assert.throws(
      () => assertSidekickChildSession(lineage, { ...expected, epoch: "epoch-lineage" }),
      /parent link does not match/u,
    );
    rewriteLineageHeader(undefined);
    assert.throws(
      () => assertSidekickChildSession(lineage, { ...expected, epoch: "epoch-lineage" }),
      /parent link does not match/u,
    );

    const wrongEpoch = createSidekickChildSession(parent, root, "epoch-wrong");
    assert.throws(
      () => assertSidekickChildSession(wrongEpoch, { ...expected, epoch: "wrong-epoch" }),
      /marker does not match/u,
    );
    assert.throws(
      () =>
        assertSidekickChildSession(wrongEpoch, {
          ...expected,
          epoch: "epoch-wrong",
          parentId: "other-parent",
        }),
      /marker does not match/u,
    );
    assert.throws(
      () =>
        assertSidekickChildSession(
          { ...wrongEpoch, sessionId: "wrong-session" },
          { ...expected, epoch: "epoch-wrong" },
        ),
      /ID does not match/u,
    );

    const duplicate = createSidekickChildSession(parent, root, "epoch-duplicate");
    const duplicateManager = SessionManager.open(duplicate.sessionFile, sessionDir);
    duplicateManager.appendCustomEntry(SIDEKICK_CHILD_MARKER, {
      parentId: parent.getSessionId(),
      epoch: "epoch-duplicate",
      sessionId: duplicate.sessionId,
    });
    assert.throws(
      () =>
        assertSidekickChildSession(duplicate, {
          parentId: parent.getSessionId(),
          epoch: "epoch-duplicate",
          admission,
        }),
      /multiple child markers/u,
    );

    const malformed = createSidekickChildSession(parent, root, "epoch-malformed");
    const malformedEntries = parseSessionEntries(readFileSync(malformed.sessionFile, "utf8"));
    const markerEntry = malformedEntries.find(
      (entry) => entry.type === "custom" && entry.customType === SIDEKICK_CHILD_MARKER,
    );
    if (!markerEntry || markerEntry.type !== "custom")
      throw new Error("Malformed test child marker was not found.");
    const validMarker = readSidekickChildSessionMarker(
      SessionManager.open(malformed.sessionFile, sessionDir),
    );
    if (!validMarker) throw new Error("Malformed test child marker payload was not found.");
    const malformedMarker = {
      ...markerEntry,
      data: { ...validMarker, unexpected: true },
    };
    writeFileSync(
      malformed.sessionFile,
      `${malformedEntries
        .map((entry) => JSON.stringify(entry === markerEntry ? malformedMarker : entry))
        .join("\n")}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        assertSidekickChildSession(malformed, {
          parentId: parent.getSessionId(),
          epoch: "epoch-malformed",
          admission,
        }),
      /Invalid Sidekick child marker data/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct child symlink realpath escape is rejected", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sidekick-child-symlink-"));
  const sessionDir = join(root, "sessions");
  mkdirSync(sessionDir);
  const parent = SessionManager.create(root, sessionDir, { id: "parent-session" });
  const parentSessionFile = parent.getSessionFile();
  const admission = { sessionDir, parentSessionFile };
  try {
    const symlinkSource = createSidekickChildSession(parent, root, "epoch-symlink");
    const outsideDir = join(root, "outside");
    mkdirSync(outsideDir);
    const symlinkTarget = join(outsideDir, "symlink-target.jsonl");
    const symlinkPath = join(sessionDir, "symlink-child.jsonl");
    writeFileSync(symlinkTarget, readFileSync(symlinkSource.sessionFile), { mode: 0o600 });
    try {
      symlinkSync(symlinkTarget, symlinkPath);
    } catch (cause) {
      if (
        process.platform === "win32" &&
        (hasErrorCode(cause, "EPERM") || hasErrorCode(cause, "EACCES"))
      ) {
        t.skip("Windows denied creating the test symlink.");
        return;
      }
      throw normalizeError(cause);
    }
    const symlinkIdentity = {
      ...symlinkSource,
      sessionFile: symlinkPath,
      sessionDir,
    };
    assert.throws(
      () =>
        assertSidekickChildSession(symlinkIdentity, {
          parentId: parent.getSessionId(),
          epoch: "epoch-symlink",
          admission,
        }),
      /resolves outside/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
