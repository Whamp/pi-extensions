import type { SidekickRunner } from "../src/sidekick/runner.ts";

/** Captured terminal result and usage for one offline handoff. */
export interface CompatibilityHandoffEvidence {
  outcome: string;
  report: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    turns: number;
  };
}
/** Isolated Pi 0.87.1 runner, server, and protocol evidence for the smoke test. */
export interface Pi087CompatibilityHarness {
  runner: SidekickRunner;
  requests: Array<{
    path: string;
    model: string;
    stream: boolean;
    roles: string[];
    authorization: string | undefined;
  }>;
  unexpectedRequests: string[];
  protocolEvents: Array<{
    type: "message_start" | "message_end";
    role: "system" | "user" | "custom";
  }>;
  milestones: Array<{
    type: "turn_end" | "agent_settled";
    status: string | undefined;
    report: string | undefined;
  }>;
  toolExecutionEvents: string[];
  workers: Array<{ pid: number | undefined }>;
  finalEvidence(handoffs: CompatibilityHandoffEvidence[]): {
    hostPiVersion: string;
    provider: string;
    model: string;
    configuredTools: string[];
    apiKey: string;
    serverRequests: Pi087CompatibilityHarness["requests"];
    unexpectedRequests: string[];
    protocolEvents: Pi087CompatibilityHarness["protocolEvents"];
    milestones: Pi087CompatibilityHarness["milestones"];
    toolExecutionEvents: string[];
    childPids: Array<number | undefined>;
    handoffs: CompatibilityHandoffEvidence[];
  };
  cleanup(): Promise<void>;
}
/** Creates the isolated host harness; callers must invoke its cleanup method. */
export function createPi087CompatibilityHarness(options: {
  packageRoot: string;
  piCliPath: string;
  hostManifestPath: string;
}): Promise<Pi087CompatibilityHarness>;
