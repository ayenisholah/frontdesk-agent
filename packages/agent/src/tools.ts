// Tool registry. Tool input comes from the model, so it's untrusted: it's validated here, and
// anything identifying the business or conversation comes from the context, never the input.
import { z } from "zod";
import type { ToolCall, ToolResult, ToolSpec } from "./model-client";

export type Tool<Context> = {
  name: string;
  description: string;
  /** Use z.strictObject, so unknown fields are refused. */
  schema: z.ZodType;
  run: (input: never, context: Context) => Promise<unknown>;
};

/** Keeps a tool's input type tied to its schema. */
export function defineTool<Context, Schema extends z.ZodType>(tool: {
  name: string;
  description: string;
  schema: Schema;
  run: (input: z.output<Schema>, context: Context) => Promise<unknown>;
}): Tool<Context> {
  return tool;
}

export function toolSpecs<Context>(tools: readonly Tool<Context>[]): ToolSpec[] {
  return tools.map(({ name, description, schema }) => ({
    name,
    description,
    inputSchema: z.toJSONSchema(schema),
  }));
}

const failure = (toolCallId: string, message: string): ToolResult => ({
  toolCallId,
  content: { error: message },
  isError: true,
});

/**
 * Runs one tool call. Every failure comes back as a result the model can read, never a
 * throw. An unexpected error's details stay out of the result, because they could leak internals.
 */
export async function runTool<Context>(
  tools: readonly Tool<Context>[],
  call: ToolCall,
  context: Context,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return failure(call.id, `Unknown tool: ${call.name}`);
  const parsed = tool.schema.safeParse(call.input);
  if (!parsed.success) return failure(call.id, `Invalid input: ${z.prettifyError(parsed.error)}`);
  try {
    const content = await tool.run(parsed.data as never, context);
    return { toolCallId: call.id, content, isError: false };
  } catch {
    return failure(call.id, "The tool failed. Don't retry it; hand off to the owner.");
  }
}
