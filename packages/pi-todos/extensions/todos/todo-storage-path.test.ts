import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getLegacyTodosDir,
  getProjectHistoryKey,
  getTodosDir,
  migrateLegacyTodosDir,
} from "./todo-storage-path.ts";

test("project history keys distinguish repositories with the same basename", () => {
  const first = getProjectHistoryKey("/work/client/app");
  const second = getProjectHistoryKey("/work/server/app");

  assert.notEqual(first, second);
  assert.match(first, /^app-[a-f0-9]{12}$/);
  assert.match(second, /^app-[a-f0-9]{12}$/);
});

test("PI_TODO_PATH remains relative to the current project", () => {
  assert.equal(
    getTodosDir("/work/client/app", ".agent-todos", "/history"),
    "/work/client/app/.agent-todos",
  );
});

test("legacy basename storage migrates to the collision-resistant project directory", async () => {
  const historyRoot = await mkdtemp(path.join(os.tmpdir(), "todo-history-"));
  const cwd = "/work/client/app";
  const legacyDir = getLegacyTodosDir(cwd, historyRoot);
  await mkdir(legacyDir, { recursive: true });
  await writeFile(path.join(legacyDir, "deadbeef.md"), "legacy todo", "utf8");

  const destination = await migrateLegacyTodosDir(cwd, undefined, historyRoot);

  assert.equal(destination, getTodosDir(cwd, undefined, historyRoot));
  assert.equal(await readFile(path.join(destination, "deadbeef.md"), "utf8"), "legacy todo");
});

test("concurrent first-use migrations converge on the same destination", async () => {
  const historyRoot = await mkdtemp(path.join(os.tmpdir(), "todo-history-race-"));
  const cwd = "/work/client/app";
  const legacyDir = getLegacyTodosDir(cwd, historyRoot);
  await mkdir(legacyDir, { recursive: true });
  await writeFile(path.join(legacyDir, "cafebabe.md"), "raced todo", "utf8");

  const destinations = await Promise.all([
    migrateLegacyTodosDir(cwd, undefined, historyRoot),
    migrateLegacyTodosDir(cwd, undefined, historyRoot),
  ]);

  assert.deepEqual(destinations, [
    getTodosDir(cwd, undefined, historyRoot),
    getTodosDir(cwd, undefined, historyRoot),
  ]);
  assert.equal(await readFile(path.join(destinations[0], "cafebabe.md"), "utf8"), "raced todo");
});
