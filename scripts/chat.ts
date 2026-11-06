import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createBedrockClient, parseAgentConfig, runConversationTurn } from "@frontdesk/agent";
import { appendSandboxMessage, createAgentStore, createDb, openSandbox } from "@frontdesk/db";

async function main() {
  const { values } = parseArgs({
    options: {
      fixture: { type: "string", default: "harbor-paws" },
      conversation: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "npm run chat -- --fixture harbor-paws [--conversation UUID]\nFictional data only. Requires DATABASE_URL and validated Bedrock configuration. Type :quit to exit.",
    );
    return;
  }
  const config = parseAgentConfig(process.env);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const clock = () => new Date();
  const model = createBedrockClient({ region: config.region, modelId: config.modelId });
  const classifier = createBedrockClient({ region: config.region, modelId: config.smallModelId });
  let input: ReturnType<typeof createInterface> | undefined;
  try {
    const scope = await openSandbox(db, {
      fixture: values.fixture,
      name: `cli-${randomUUID()}`,
      conversationId: values.conversation,
    });
    const store = createAgentStore(db, scope, clock);
    console.log(`Fictional chat session: ${scope.conversationId}\nType :quit to exit.`);
    input = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
    input.prompt();
    for await (const line of input) {
      if (line.trim() === ":quit") break;
      if (line.trim()) {
        const messageId = await appendSandboxMessage(db, scope, line, clock);
        const result = await runConversationTurn(
          { store, model, classifier, config, clock },
          messageId,
        );
        console.log(result.reply ?? `Conversation ${result.state}.`);
      }
      input.prompt();
    }
  } finally {
    input?.close();
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Chat could not continue. Check database, EU model configuration and AWS access.");
  process.exitCode = 1;
});
