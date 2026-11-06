CREATE TABLE "ToolExecution" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "callId" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ToolExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ToolExecution_runId_callId_key" ON "ToolExecution"("runId", "callId");
