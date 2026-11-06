CREATE TABLE "WhatsAppRegistration" (
  "phoneNumberId" TEXT PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WhatsAppRegistration_businessId_idx" ON "WhatsAppRegistration"("businessId");
CREATE TABLE "InboundWork" (
  "sequence" BIGSERIAL PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "messageId" UUID NOT NULL REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "phoneNumberId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('text', 'unsupported')),
  "state" TEXT NOT NULL DEFAULT 'pending' CHECK ("state" = 'pending'),
  "providerTimestamp" TIMESTAMPTZ NOT NULL,
  "receivedAt" TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX "InboundWork_messageId_key" ON "InboundWork"("messageId");
CREATE INDEX "InboundWork_state_sequence_idx" ON "InboundWork"("state", "sequence");
CREATE INDEX "InboundWork_businessId_sequence_idx" ON "InboundWork"("businessId", "sequence");
