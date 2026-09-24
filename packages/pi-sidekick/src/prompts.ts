import { truncateHead } from "@earendil-works/pi-coding-agent";
import type { Handoff } from "./types.ts";

const REVIEW_NOTICE =
  "UNTRUSTED REPORT: independently inspect the actual changes and run the relevant checks before claiming success or sending another correction.";

/** Formats a terminal or admitted handoff for the model without exposing child traces. */
export function handoffSummary(handoff: Handoff, childSessionPath?: string): string {
  if (handoff.status === "running") {
    return `Sidekick handoff ${handoff.id} | running\nInitial message admitted to the persistent child.\nChild session: ${childSessionPath ?? "native transcript"}`;
  }
  const accounting = handoff.accounting ?? "partial";
  const state = `${handoff.status} / ${handoff.outcome}`;
  const reportLocation = handoff.reportPath
    ? `Full report: ${handoff.reportPath}`
    : "Complete report artifact unavailable; inspect the working tree and child transcript.";
  const childLocation = childSessionPath
    ? `Child session: ${childSessionPath}`
    : "Child session: native transcript";
  const error = handoff.error ? `Error: ${handoff.error}` : "No terminal error was reported.";
  const truncationPath = handoff.reportPath
    ? `Inspect the complete report at ${handoff.reportPath}.`
    : "The complete report artifact is unavailable; inspect the working tree and child transcript.";
  const body = [error, `Report:\n${handoff.report}`].join("\n\n");
  const header = [
    `Sidekick handoff ${handoff.id} | ${state}`,
    `Sidekick turns: ${handoff.usage.turns}; reported cost: $${handoff.usage.cost.toFixed(4)} (${accounting} accounting)`,
    reportLocation,
    childLocation,
    REVIEW_NOTICE,
  ].join("\n");
  const complete = `${header}\n\n${body}`;
  const initial = truncateHead(complete);
  if (!initial.truncated) {
    return initial.content;
  }
  const truncation = `[Report truncated by Pi's default output limits. ${truncationPath}]`;
  return truncateHead(`${header}\n${truncation}\n\n${body}`).content;
}

/** Formats the post-ACK result returned by a nonblocking model call. */
export function handoffAdmissionSummary(kind: "started" | "steered", handoff: Handoff): string {
  return `Sidekick handoff ${handoff.id} ${kind}; the persistent child accepted the message. Use the eventual completion notification and independently inspect the actual changes and checks.`;
}

/** Formats an observation window that ended without terminal evidence. */
export function handoffWaitWindowSummary(handoffId: string, timeoutMs: number): string {
  return `Sidekick handoff ${handoffId}: ${timeoutMs} ms elapsed without stopping the worker or observing a terminal report. The observation requested no stop; the handoff continues unless it settled or was explicitly stopped concurrently. Continue independent lead work or wait again. The eventual completion notification remains available.`;
}

/** Removes terminal control sequences before text enters a Pi UI surface. */
export function cleanDisplay(text: string): string {
  return (
    text
      // oxlint-disable-next-line no-control-regex -- Strip ANSI CSI sequences before text enters Pi UI surfaces.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
      // oxlint-disable-next-line no-control-regex -- Remove remaining terminal controls while preserving line breaks.
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu, "")
  );
}
