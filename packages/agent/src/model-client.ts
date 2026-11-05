// Provider-neutral model types. Everything goes through ModelClient, so evals can compare
// models and tests can run with no network.

export type ToolCall = { id: string; name: string; input: unknown };

export type ToolResult = { toolCallId: string; content: unknown; isError: boolean };

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export type ToolSpec = { name: string; description: string; inputSchema: object };

export type ModelRequest = {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens: number;
};

export type Usage = { inputTokens: number; outputTokens: number };

export type ModelResponse = { text: string; toolCalls: ToolCall[]; usage: Usage };

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
