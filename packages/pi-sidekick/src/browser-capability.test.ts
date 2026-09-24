import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { dirname, relative, resolve } from "node:path";
import { SIDEKICK_BROWSER_SKILL_PATH, hasSidekickBrowserSkill } from "./browser-capability.ts";

test("bundled browser skill matching requires the exact normalized absolute path", () => {
  assert.equal(existsSync(SIDEKICK_BROWSER_SKILL_PATH), true);
  assert.equal(hasSidekickBrowserSkill([]), false);
  assert.equal(
    hasSidekickBrowserSkill([
      resolve(dirname(SIDEKICK_BROWSER_SKILL_PATH), "..", "other-skill", "SKILL.md"),
    ]),
    false,
  );
  assert.equal(
    hasSidekickBrowserSkill([
      resolve(dirname(SIDEKICK_BROWSER_SKILL_PATH), "..", "sidekick-browser", ".", "SKILL.md"),
    ]),
    true,
  );
  assert.equal(
    hasSidekickBrowserSkill([relative(process.cwd(), SIDEKICK_BROWSER_SKILL_PATH)]),
    false,
  );
});
