import { accessSync, constants } from "node:fs";
import path from "node:path";

/** A supported graphical editor whose CLI can show a blocking two-file diff. */
export interface DiffEditor {
  executable: "zeditor" | "zed" | "code";
  label: "Zed" | "VS Code";
}

const DIFF_EDITORS: Record<DiffEditor["executable"], DiffEditor> = {
  zeditor: { executable: "zeditor", label: "Zed" },
  zed: { executable: "zed", label: "Zed" },
  code: { executable: "code", label: "VS Code" },
};

/** Finds executable names available on the current PATH. */
export function findPathExecutables(
  executableNames: readonly string[],
  pathValue = process.env.PATH ?? "",
): Set<string> {
  const available = new Set<string>();
  const directories = pathValue.split(path.delimiter).filter(Boolean);

  for (const executableName of executableNames) {
    for (const directory of directories) {
      try {
        accessSync(path.join(directory, executableName), constants.X_OK);
        available.add(executableName);
        break;
      } catch {
        // Continue searching PATH.
      }
    }
  }

  return available;
}

/** Selects an installed diff editor, honoring PI_FILES_DIFF_EDITOR when configured. */
export function selectDiffEditor(
  availableExecutables: ReadonlySet<string>,
  preferredExecutable = process.env.PI_FILES_DIFF_EDITOR,
): DiffEditor | null {
  const configured = preferredExecutable?.trim();
  if (configured) {
    const editor = DIFF_EDITORS[configured as DiffEditor["executable"]];
    return editor && availableExecutables.has(editor.executable) ? editor : null;
  }

  for (const executable of ["zeditor", "zed", "code"] as const) {
    if (availableExecutables.has(executable)) return DIFF_EDITORS[executable];
  }
  return null;
}

/** Builds a blocking graphical diff command so temporary base files can be removed safely. */
export function buildDiffCommand(
  executable: DiffEditor["executable"],
  basePath: string,
  workingPath: string,
): { executable: string; args: string[] } {
  return {
    executable,
    args: ["--wait", "--diff", basePath, workingPath],
  };
}

/** Returns host-appropriate wording for revealing a file's containing directory. */
export function describeRevealAction(platform = process.platform): string {
  return platform === "darwin" ? "Reveal in Finder" : "Reveal in file manager";
}
