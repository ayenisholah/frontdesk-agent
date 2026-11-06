ALTER TABLE "Message" ADD COLUMN "redactedAt" TIMESTAMPTZ;
ALTER TABLE "AgentRun" ADD COLUMN "redactedAt" TIMESTAMPTZ;
CREATE INDEX "Message_redactedAt_createdAt_idx" ON "Message"("redactedAt", "createdAt");
CREATE INDEX "AgentRun_redactedAt_startedAt_idx" ON "AgentRun"("redactedAt", "startedAt");
