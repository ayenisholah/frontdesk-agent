-- Rules Prisma's schema language can't express. See docs/adr/0010-booking-concurrency.md.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Each active booking occupies one lane, from 0 to capacity - 1.
ALTER TABLE "Booking" ADD COLUMN "lane" INTEGER NOT NULL DEFAULT 0;

-- An unpaid booking gives up its slot at this time (FR-PY-3).
ALTER TABLE "Booking" ADD COLUMN "depositDueAt" TIMESTAMPTZ;
CREATE INDEX "Booking_status_depositDueAt_idx" ON "Booking" ("status", "depositDueAt");

-- Backstop: two active bookings can never share a lane at the same time, even if
-- application code is wrong.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_no_lane_overlap"
  EXCLUDE USING gist (
    "businessId" WITH =,
    "lane" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  ) WHERE ("status" IN ('pending_deposit', 'confirmed'));

-- A conversation holds at most one slot at a time (FR-BK-2).
CREATE UNIQUE INDEX "Hold_one_active_per_conversation"
  ON "Hold" ("conversationId") WHERE "status" = 'active';
