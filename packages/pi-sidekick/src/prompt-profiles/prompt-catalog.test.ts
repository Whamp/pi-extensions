import assert from "node:assert/strict";
import { test } from "node:test";
import { PromptProfileFamily } from "../enums.ts";
import {
  LEAD_PROMPT_PROFILES,
  REMINDER_PROMPT_PROFILES,
  SIDEKICK_PROMPT_PROFILES,
} from "./prompt-catalog.ts";
import type { RenderedPromptProfile } from "./types.ts";

function profileIds(profiles: readonly RenderedPromptProfile[]): string[] {
  return profiles.map((profile) => profile.id).sort();
}

test("final prompt catalogue includes each complete selector combination", () => {
  assert.equal(LEAD_PROMPT_PROFILES.length, 16);
  assert.equal(SIDEKICK_PROMPT_PROFILES.length, 24);
  assert.equal(REMINDER_PROMPT_PROFILES.length, 6);

  const expectedLeadIds: string[] = [];
  for (const policy of ["standard", "strict"]) {
    for (const exploration of ["direct", "broad"]) {
      for (const authority of ["no-github", "github"]) {
        for (const browser of ["no-browser", "browser"]) {
          expectedLeadIds.push(`lead/${policy}/${exploration}/${authority}/${browser}`);
        }
      }
    }
  }
  assert.deepEqual(profileIds(LEAD_PROMPT_PROFILES), expectedLeadIds.sort());

  const expectedSidekickIds: string[] = [];
  for (const browser of ["no-browser", "browser"]) {
    for (const task of ["simple", "todo"]) {
      for (const shell of ["ephemeral", "persistent"]) {
        for (const filePreference of ["none", "builtin", "exec"]) {
          expectedSidekickIds.push(`sidekick/${browser}/${task}/${shell}/${filePreference}`);
        }
      }
    }
  }
  assert.deepEqual(profileIds(SIDEKICK_PROMPT_PROFILES), expectedSidekickIds.sort());

  const expectedReminderIds = [
    ...["direct", "broad"].flatMap((exploration) =>
      ["no-browser", "browser"].map(
        (browser) => `reminder/first-message/${exploration}/${browser}`,
      ),
    ),
    "reminder/first-edit/no-browser",
    "reminder/first-edit/browser",
  ];
  assert.deepEqual(profileIds(REMINDER_PROMPT_PROFILES), expectedReminderIds.sort());

  const allProfiles = [
    ...LEAD_PROMPT_PROFILES,
    ...SIDEKICK_PROMPT_PROFILES,
    ...REMINDER_PROMPT_PROFILES,
  ];
  assert.equal(new Set(allProfiles.map((profile) => profile.id)).size, 46);
});

test("final prompt catalogue contains only final text and the correct family", () => {
  for (const [profiles, family] of [
    [LEAD_PROMPT_PROFILES, PromptProfileFamily.LEAD],
    [SIDEKICK_PROMPT_PROFILES, PromptProfileFamily.SIDEKICK],
    [REMINDER_PROMPT_PROFILES, PromptProfileFamily.REMINDER],
  ] as const) {
    for (const profile of profiles) {
      assert.deepEqual(Object.keys(profile).sort(), ["family", "id", "text"]);
      assert.equal(profile.family, family, profile.id);
      assert.doesNotMatch(profile.text, /\{[A-Z][A-Z_]*\}/u, profile.id);
    }
  }
});
