import assert from "node:assert/strict";
import { test } from "node:test";
import { LeadProfileMode, LeadReminderEventKind, LeadReminderKind } from "../enums.ts";
import {
  reduceLeadReminderState,
  selectLeadPromptProfile,
  selectSidekickPromptProfile,
} from "./selectors.ts";
import type { LeadReminderState } from "./types.ts";

const EMPTY_REMINDER_STATE = (): LeadReminderState => ({
  delivered: [],
  delegationAdmitted: false,
});

test("lead selector preserves non-tool axes and always selects GitHub authority", () => {
  const ids = new Set<string>();
  for (const strict of [false, true]) {
    for (const broadExploration of [false, true]) {
      for (const activeToolNames of [[], ["gh"], ["bash"]]) {
        for (const renderedBrowser of [false, true]) {
          const profile = selectLeadPromptProfile({
            modelId: "unknown-model",
            activeToolNames,
            leadProfile: strict ? LeadProfileMode.STRICT : LeadProfileMode.STANDARD,
            broadExploration,
            renderedBrowser,
          });
          ids.add(profile.id);
          assert.equal(profile.id.includes("/strict/"), strict);
          assert.equal(profile.id.includes("/broad/"), broadExploration);
          assert.equal(profile.id.includes("/github/"), true);
          assert.equal(profile.id.endsWith("/browser"), renderedBrowser);
        }
      }
    }
  }
  assert.equal(ids.size, 8);
});

test("lead auto mode follows legacy model aliases", () => {
  const modeFor = (modelId: string): string =>
    selectLeadPromptProfile({
      modelId,
      activeToolNames: [],
      leadProfile: LeadProfileMode.AUTO,
      broadExploration: false,
      renderedBrowser: false,
    }).id;
  for (const model of [
    "fusion",
    "fusion-gpt-6-astra-high",
    "fusion-gpt-5-6-sol",
    "gpt-6-astra",
    "gpt-5.6-sol-high",
    "gpt-5-6-sol",
  ]) {
    assert.match(modeFor(model), /^lead\/strict\//u, model);
  }
  for (const model of ["fusion-claude-fable-5-1", "claude-opus-5", "unknown-model"]) {
    assert.match(modeFor(model), /^lead\/standard\//u, model);
  }
});

test("sidekick selector enables browser guidance from an explicit capability", () => {
  const explicitBrowser = selectSidekickPromptProfile({
    activeToolNames: ["bash"],
    preferExec: true,
    browserAvailable: true,
  });
  assert.equal(explicitBrowser.id, "sidekick/browser/simple/ephemeral/none");

  const bashOnly = selectSidekickPromptProfile({
    activeToolNames: ["bash"],
    preferExec: true,
  });
  assert.equal(bashOnly.id, "sidekick/no-browser/simple/ephemeral/none");
});

test("sidekick selector maps Pi shell-first and todo tool names", () => {
  const full = selectSidekickPromptProfile({
    activeToolNames: ["browser", "grep", "read", "edit", "exec", "todo"],
    preferExec: true,
  });
  assert.equal(full.id, "sidekick/browser/todo/persistent/exec");
  const piShellFirst = selectSidekickPromptProfile({
    activeToolNames: ["bash", "grep", "read", "edit"],
    preferExec: true,
  });
  assert.equal(piShellFirst.id, "sidekick/no-browser/simple/ephemeral/exec");
  const piDefaults = selectSidekickPromptProfile({
    activeToolNames: ["read", "write", "edit", "bash", "grep", "find", "ls"],
    preferExec: false,
  });
  assert.equal(piDefaults.id, "sidekick/no-browser/simple/ephemeral/builtin");
  assert.doesNotMatch(piDefaults.text, /shell sessions are persistent/u);
  const todo = selectSidekickPromptProfile({
    activeToolNames: ["todo"],
    preferExec: false,
  });
  assert.equal(todo.id, "sidekick/no-browser/todo/ephemeral/none");
});

test("reminder reducer selects all six profiles and enforces one-shot delegation semantics", () => {
  const reminderIds = new Set<string>();
  for (const broadExploration of [false, true]) {
    for (const renderedBrowser of [false, true]) {
      const transition = reduceLeadReminderState(EMPTY_REMINDER_STATE(), {
        kind: LeadReminderEventKind.LEAD_TURN_STARTED,
        broadExploration,
        renderedBrowser,
      });
      assert.ok(transition.reminder);
      reminderIds.add(transition.reminder.id);
      assert.deepEqual(transition.nextState.delivered, [LeadReminderKind.FIRST_MESSAGE]);
      assert.equal(
        reduceLeadReminderState(transition.nextState, {
          kind: LeadReminderEventKind.LEAD_TURN_STARTED,
          broadExploration,
          renderedBrowser,
        }).reminder,
        undefined,
      );
    }
  }
  for (const renderedBrowser of [false, true]) {
    const transition = reduceLeadReminderState(EMPTY_REMINDER_STATE(), {
      kind: LeadReminderEventKind.LEAD_MUTATOR_OBSERVED,
      toolName: "edit",
      broadExploration: false,
      renderedBrowser,
    });
    assert.ok(transition.reminder);
    reminderIds.add(transition.reminder.id);
  }
  assert.equal(reminderIds.size, 6);

  const delegated = reduceLeadReminderState(EMPTY_REMINDER_STATE(), {
    kind: LeadReminderEventKind.DELEGATION_ADMITTED,
  }).nextState;
  assert.equal(delegated.delegationAdmitted, true);
  assert.equal(
    reduceLeadReminderState(delegated, {
      kind: LeadReminderEventKind.LEAD_MUTATOR_OBSERVED,
      toolName: "write",
      broadExploration: false,
      renderedBrowser: false,
    }).reminder,
    undefined,
  );
  for (const toolName of ["edit", "write", "MultiEdit", "apply_patch", "notebook_edit"]) {
    assert.ok(
      reduceLeadReminderState(EMPTY_REMINDER_STATE(), {
        kind: LeadReminderEventKind.LEAD_MUTATOR_OBSERVED,
        toolName,
        broadExploration: false,
        renderedBrowser: false,
      }).reminder,
      toolName,
    );
  }
  assert.equal(
    reduceLeadReminderState(EMPTY_REMINDER_STATE(), {
      kind: LeadReminderEventKind.LEAD_MUTATOR_OBSERVED,
      toolName: "bash",
      broadExploration: false,
      renderedBrowser: false,
    }).reminder,
    undefined,
  );
});
