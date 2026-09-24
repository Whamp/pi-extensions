import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerSidekick } from "./src/extension.ts";
import { registerChildCapabilityObserver } from "./src/sidekick/child-capability-observer.ts";

/** Registers the parent workflow or the child capability observer for the current Pi process. */
export default function piSidekick(pi: ExtensionAPI): void {
  // Defense in depth: an explicitly loaded provider extension must not recursively
  // install Sidekick in a child. Discovery is disabled in that process as well.
  if (process.env.PI_SIDEKICK_CHILD === "1") {
    if (process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE) {
      registerChildCapabilityObserver(pi);
    }
    return;
  }
  registerSidekick(pi, Type);
}
