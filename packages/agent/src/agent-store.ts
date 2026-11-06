import type { BusinessConfig } from "@frontdesk/core";
import type { ChatMessage, Usage } from "./model-client";
import type { Step } from "./loop";
import type { Slot, ToolStore } from "./business-tools";

export type ConversationSnapshot = {
  config: BusinessConfig;
  messages: ChatMessage[];
  customerName: string | null;
  activeHold: (Slot & { expiresAt: string; serviceKey: string }) | null;
  booking: (Slot & { status: string; serviceKey: string }) | null;
};
export type RunInfo = { model: string; promptVersion: string; ratesVersion: string };
export type ClaimResult =
  | { state: "claimed"; runId: string; snapshot: ConversationSnapshot }
  | { state: "replay"; reply: string }
  | { state: "silent" | "busy" };
export type UsageRecord = {
  modelId: string;
  usage: Usage;
  costMicros: number;
  ratesVersion: string;
};
export type RunFinish = {
  reply: string;
  outcome: "replied" | "handoff" | "budget_exceeded" | "error";
  handoff?: string;
  latencyMs: number;
};
export interface AgentStore extends ToolStore {
  claim(messageId: string, info: RunInfo): Promise<ClaimResult>;
  recordUsage(runId: string, usage: UsageRecord): Promise<void>;
  recordStep(runId: string, index: number, step: Step): Promise<void>;
  taskFailure(runId: string, task: string, failed: boolean): Promise<number>;
  finish(runId: string, result: RunFinish): Promise<void>;
}
