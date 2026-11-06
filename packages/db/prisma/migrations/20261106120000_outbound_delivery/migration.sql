ALTER TABLE "WhatsAppRegistration" ADD COLUMN "credentialEnv" TEXT,
  ADD COLUMN "graphVersion" TEXT, ADD COLUMN "ownerPhone" TEXT,
  ADD COLUMN "templates" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "OutboundWork" ALTER COLUMN "inboundSequence" DROP NOT NULL;
ALTER TABLE "OutboundWork" ADD COLUMN "ownerReason" TEXT,
  ADD COLUMN "recipientRole" TEXT NOT NULL DEFAULT 'customer',
  ADD COLUMN "incidentId" UUID UNIQUE,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseUntil" TIMESTAMPTZ,
  ADD COLUMN "finishedAt" TIMESTAMPTZ,
  ADD COLUMN "reason" TEXT;
UPDATE "OutboundWork" w SET "ownerReason" = c."handoffReason"
  FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
  WHERE w."messageId" = m.id AND w."allowOwner";
CREATE TABLE "DeliveryAttempt" (
  id UUID PRIMARY KEY, "outboundId" UUID NOT NULL REFERENCES "OutboundWork"(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, "recipientHash" TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'started',
  "providerMessageId" TEXT, "lastStatusAt" TIMESTAMPTZ, "startedAt" TIMESTAMPTZ NOT NULL, "finishedAt" TIMESTAMPTZ,
  UNIQUE ("outboundId", number)
);
CREATE TABLE "DeliveryIncident" (
  id UUID PRIMARY KEY, "businessId" UUID NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
  "conversationId" UUID NOT NULL REFERENCES "Conversation"(id) ON DELETE CASCADE,
  "outboundId" UUID NOT NULL UNIQUE REFERENCES "OutboundWork"(id) ON DELETE CASCADE,
  reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DeliveryIncident_businessId_state_idx" ON "DeliveryIncident"("businessId", state);
