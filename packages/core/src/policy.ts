// Booking policy. Pure: the rule lives here so every caller refuses the same way.

const HOUR_MS = 3_600_000;

export type PolicyDecision = { allowed: true } | { allowed: false; policy: string };

export type ChangeRequest = { startsAt: Date; now: Date; windowHours: number };

/** A booking can be cancelled or moved until `windowHours` before it starts. */
export function canChangeBooking({ startsAt, now, windowHours }: ChangeRequest): PolicyDecision {
  if (startsAt.getTime() - now.getTime() >= windowHours * HOUR_MS) return { allowed: true };
  return {
    allowed: false,
    policy: `Bookings can be cancelled or moved up to ${windowHours} hours before the appointment.`,
  };
}
