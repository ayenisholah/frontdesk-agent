ALTER TABLE "AgentRun" ADD COLUMN "inboxSequence" BIGINT;
CREATE UNIQUE INDEX "AgentRun_inboxSequence_key" ON "AgentRun"("inboxSequence");
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_inboxSequence_fkey" FOREIGN KEY ("inboxSequence") REFERENCES "InboundWork"("sequence") ON DELETE SET NULL;
CREATE TABLE "OutboundWork" (
  "id" UUID NOT NULL PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "messageId" UUID NOT NULL UNIQUE REFERENCES "Message"("id") ON DELETE CASCADE,
  "inboundSequence" BIGINT NOT NULL UNIQUE REFERENCES "InboundWork"("sequence") ON DELETE CASCADE,
  "phoneNumberId" TEXT NOT NULL,
  "allowOwner" BOOLEAN NOT NULL DEFAULT false,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OutboundWork_businessId_state_createdAt_idx" ON "OutboundWork"("businessId", "state", "createdAt");
