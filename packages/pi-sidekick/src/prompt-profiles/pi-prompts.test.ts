import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../config.ts";
import { LeadProfileMode, PromptProfileFamily } from "../enums.ts";
import { LEAD_PROMPT_PROFILES, SIDEKICK_PROMPT_PROFILES } from "./prompt-catalog.ts";
import { composePiLeadSystemPrompt, freezePiSidekickPrompt } from "./pi-prompts.ts";
import { selectLeadPromptProfile, selectSidekickPromptProfile } from "./selectors.ts";
import type { SidekickConfig } from "../config.ts";
import type { RenderedPromptProfile } from "./types.ts";

const AUTHORED_PROFILE = {
  id: "sidekick/test-profile",
  family: PromptProfileFamily.SIDEKICK,
  text: "fixture prompt\nsecond line",
} satisfies RenderedPromptProfile;

test("Pi lead prompt keeps the exact system-prompt separator and final text", () => {
  assert.equal(composePiLeadSystemPrompt(AUTHORED_PROFILE), "\nfixture prompt\nsecond line");
});

test("Pi sidekick prompt freezes final bytes, tools, model, and config lists", () => {
  const config: SidekickConfig = {
    ...DEFAULT_CONFIG,
    sidekick: { provider: "test-provider", id: "worker-model" },
    tools: ["zeta", "alpha", "zeta"],
    sidekickExtensions: ["/trusted/provider.mjs"],
    sidekickSkills: ["/trusted/skill.md"],
  };
  const configModel = config.sidekick;
  assert.ok(configModel);
  const frozen = freezePiSidekickPrompt(AUTHORED_PROFILE, config);

  assert.equal(frozen.profileId, AUTHORED_PROFILE.id);
  assert.equal(frozen.effectiveText, AUTHORED_PROFILE.text);
  assert.equal(
    frozen.effectiveSha256,
    "c76746e199a892f9c68b6ea97a36a0db4507ccc12bbde1d7eb3ffb0517533e4e",
  );
  assert.deepEqual(frozen.activeToolNames, ["alpha", "zeta"]);
  assert.deepEqual(frozen.model, { provider: "test-provider", id: "worker-model" });
  assert.deepEqual(frozen.sidekickExtensions, ["/trusted/provider.mjs"]);
  assert.deepEqual(frozen.sidekickSkills, ["/trusted/skill.md"]);
  assert.equal(frozen.thinking, config.thinking);
  assert.equal("canonicalSha256" in frozen, false);

  assert.notStrictEqual(frozen.activeToolNames, config.tools);
  assert.notStrictEqual(frozen.model, config.sidekick);
  assert.notStrictEqual(frozen.sidekickExtensions, config.sidekickExtensions);
  assert.notStrictEqual(frozen.sidekickSkills, config.sidekickSkills);
  config.tools.push("omega");
  configModel.id = "changed-model";
  config.sidekickExtensions.push("/trusted/later.mjs");
  config.sidekickSkills.push("/trusted/later.md");
  assert.deepEqual(frozen.activeToolNames, ["alpha", "zeta"]);
  assert.deepEqual(frozen.model, { provider: "test-provider", id: "worker-model" });
  assert.deepEqual(frozen.sidekickExtensions, ["/trusted/provider.mjs"]);
  assert.deepEqual(frozen.sidekickSkills, ["/trusted/skill.md"]);
});

test("Pi sidekick prompt requires an exact configured model", () => {
  assert.throws(
    () => freezePiSidekickPrompt(AUTHORED_PROFILE, { ...DEFAULT_CONFIG, sidekick: null }),
    /without an exact sidekick model/u,
  );
});

test("Pi prompt functions consume profiles selected from the final literal arrays", () => {
  const lead = selectLeadPromptProfile({
    modelId: "unknown-model",
    activeToolNames: [],
    leadProfile: LeadProfileMode.STANDARD,
    broadExploration: false,
    renderedBrowser: false,
  });
  assert.strictEqual(
    lead,
    LEAD_PROMPT_PROFILES.find((profile) => profile.id === "lead/standard/direct/github/no-browser"),
  );
  assert.equal(composePiLeadSystemPrompt(lead), `\n${lead.text}`);

  const config: SidekickConfig = {
    ...DEFAULT_CONFIG,
    sidekick: { provider: "test-provider", id: "worker-model" },
  };
  const sidekick = selectSidekickPromptProfile({
    activeToolNames: config.tools,
    preferExec: config.sidekickPreferExec,
  });
  assert.strictEqual(
    sidekick,
    SIDEKICK_PROMPT_PROFILES.find((profile) => profile.id === sidekick.id),
  );
  assert.equal(freezePiSidekickPrompt(sidekick, config).effectiveText, sidekick.text);
});
