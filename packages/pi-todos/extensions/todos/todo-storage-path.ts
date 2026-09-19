import crypto from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_HISTORY_ROOT = path.join(os.homedir(), ".pi", "history");

/** Returns a readable, collision-resistant identity for one project directory. */
export function getProjectHistoryKey(cwd: string): string {
  const projectPath = path.resolve(cwd);
  const basename = path.basename(projectPath) || "root";
  const digest = crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
  return `${basename}-${digest}`;
}

/** Returns the pre-migration todo directory that used only the project's basename. */
export function getLegacyTodosDir(cwd: string, historyRoot = DEFAULT_HISTORY_ROOT): string {
  return path.join(historyRoot, path.basename(path.resolve(cwd)) || "root", "todos");
}

/** Resolves the todo directory, preserving PI_TODO_PATH-style relative overrides. */
export function getTodosDir(
  cwd: string,
  overridePath = process.env.PI_TODO_PATH,
  historyRoot = DEFAULT_HISTORY_ROOT,
): string {
  if (overridePath?.trim()) return path.resolve(cwd, overridePath.trim());
  return path.join(historyRoot, getProjectHistoryKey(cwd), "todos");
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Moves legacy basename-scoped todos into the collision-resistant project directory once. */
export async function migrateLegacyTodosDir(
  cwd: string,
  overridePath = process.env.PI_TODO_PATH,
  historyRoot = DEFAULT_HISTORY_ROOT,
): Promise<string> {
  const destination = getTodosDir(cwd, overridePath, historyRoot);
  if (overridePath?.trim() || (await pathExists(destination))) return destination;

  const legacyDir = getLegacyTodosDir(cwd, historyRoot);
  if (!(await pathExists(legacyDir))) return destination;

  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await rename(legacyDir, destination);
    await rm(path.dirname(legacyDir), { recursive: false }).catch(() => undefined);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const concurrentMoveCompleted = code === "ENOENT" && (await pathExists(destination));
    if (!concurrentMoveCompleted && code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
  }

  return destination;
}

/** Formats the default todo directory for command and tool descriptions. */
export function getTodosDirLabel(cwd: string, overridePath = process.env.PI_TODO_PATH): string {
  if (overridePath?.trim()) return path.resolve(cwd, overridePath.trim());
  return path.join("~/.pi/history", getProjectHistoryKey(cwd), "todos");
}
