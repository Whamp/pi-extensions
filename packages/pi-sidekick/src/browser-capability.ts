import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bundled Sidekick browser skill used for explicit opt-in. */
export const SIDEKICK_BROWSER_SKILL_PATH = resolve(
  SOURCE_DIRECTORY,
  "..",
  "skills",
  "sidekick-browser",
  "SKILL.md",
);

/** Returns whether the exact bundled browser skill path is explicitly trusted. */
export function hasSidekickBrowserSkill(skills: readonly string[]): boolean {
  return skills.some(
    (skill) => isAbsolute(skill) && normalize(skill) === SIDEKICK_BROWSER_SKILL_PATH,
  );
}
