ALTER TABLE "AgentRun" ADD COLUMN "ratesVersion" TEXT NOT NULL DEFAULT 'unversioned', ADD COLUMN "reply" TEXT;
CREATE UNIQUE INDEX "AgentRun_conversationId_triggerMessageId_key" ON "AgentRun"("conversationId", "triggerMessageId");
CREATE TABLE "AgentUsage" (
  "id" UUID NOT NULL PRIMARY KEY,
  "runId" UUID NOT NULL REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "modelId" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "costMicros" INTEGER NOT NULL,
  "ratesVersion" TEXT NOT NULL
);
CREATE INDEX "AgentUsage_runId_idx" ON "AgentUsage"("runId");
CREATE TABLE "AgentTaskFailure" (
  "conversationId" UUID NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "task" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("conversationId", "task")
);
