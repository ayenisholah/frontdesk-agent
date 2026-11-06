// LLM loop, tool definitions, guardrails and tracing. Amazon Bedrock behind a ModelClient.
export { createBedrockClient, type BedrockOptions } from "./bedrock-client";
export { parseAgentConfig, type AgentConfig } from "./config";
export { ModelFailure } from "./model-failure";
export { runTurn, type HandoffReason, type Step, type Turn, type TurnResult } from "./loop";
export type {
  ChatMessage,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ToolCall,
  ToolResult,
  ToolSpec,
  Usage,
} from "./model-client";
export { defineTool, type Tool } from "./tools";

export {
  createBusinessTools,
  HANDOFF_REPLY,
  type BusinessContext,
  type BusinessResult,
  type BusinessHandoff,
  type Slot,
  type StoredHold,
  type ToolStore,
  type HoldInput,
  type AvailabilityInput,
} from "./business-tools";

export {
  runConversationTurn,
  type ConversationOptions,
  type ConversationResult,
} from "./conversation";
export type {
  AgentStore,
  ConversationSnapshot,
  ClaimResult,
  RunFinish,
  RunInfo,
  UsageRecord,
} from "./agent-store";
