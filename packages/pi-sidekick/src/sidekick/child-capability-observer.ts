import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { hasErrorCode, normalizeError } from "../errors.ts";

/** Closed child-capability record exchanged before the first Sidekick prompt. */
export const SIDEKICK_CAPABILITY_HANDSHAKE_SCHEMA = Type.Object(
  {
    nonce: Type.String({ minLength: 1 }),
    pid: Type.Integer({ minimum: 1 }),
    activeToolNames: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
/** Schema-derived child-capability handshake record. */
export type SidekickCapabilityHandshake = Static<typeof SIDEKICK_CAPABILITY_HANDSHAKE_SCHEMA>;

/** Minimal host API needed to publish a Sidekick capability handshake. */
export interface ChildCapabilityObserverHost {
  on(event: "session_start", handler: () => Promise<void> | void): void;
  getActiveTools(): string[];
}

function writeCapabilityHandshake(path: string, handshake: SidekickCapabilityHandshake): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(handshake)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch (cause) {
    try {
      unlinkSync(temporaryPath);
    } catch (cleanupCause) {
      if (!hasErrorCode(cleanupCause, "ENOENT")) {
        throw new AggregateError(
          [normalizeError(cause), normalizeError(cleanupCause)],
          "Capability handshake and temporary-file cleanup both failed.",
        );
      }
    }
    throw normalizeError(cause);
  }
}

/** Records the final allowlist-filtered child tools before any sidekick prompt. */
export function registerChildCapabilityObserver(pi: ExtensionAPI): void;
export function registerChildCapabilityObserver(pi: ChildCapabilityObserverHost): void;
export function registerChildCapabilityObserver(pi: ChildCapabilityObserverHost): void {
  pi.on("session_start", async () => {
    const path = process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE;
    const nonce = process.env.PI_SIDEKICK_CAPABILITY_NONCE;
    if (!path && !nonce) {
      return;
    }
    if (!path || !nonce || path.includes("\0") || nonce.includes("\0")) {
      throw new Error("Sidekick capability observer received an invalid handshake contract.");
    }
    writeCapabilityHandshake(path, {
      nonce,
      pid: process.pid,
      activeToolNames: [...new Set(pi.getActiveTools())].sort((left, right) =>
        left.localeCompare(right),
      ),
    });
  });
}
