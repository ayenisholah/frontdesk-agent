ALTER TABLE "InboundWork" DROP CONSTRAINT "InboundWork_state_check";
ALTER TABLE "InboundWork"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseUntil" TIMESTAMPTZ,
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "finishedAt" TIMESTAMPTZ,
  ADD COLUMN "reason" TEXT,
  ADD CONSTRAINT "InboundWork_state_check" CHECK (state IN ('pending', 'processing', 'done', 'skipped', 'dead'));
