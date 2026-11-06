// Prisma schema, client and the business-config mapping.
export { createDb, type Db } from "./client";
export { loadBusinessConfig, saveBusinessConfig } from "./business";
export {
  bookFromHold,
  cancelBooking,
  rescheduleBooking,
  type BookResult,
  type CancelResult,
  type RescheduleResult,
} from "./bookings";
export { placeHold, releaseExpired, type HoldResult } from "./holds";
export type { Clock } from "./slots";
export * from "./generated/enums";
export { createToolStore } from "./agent-tools";
export type { AgentScope } from "./agent-scope";
export { createAgentStore } from "./agent-store";
export { openSandbox, appendSandboxMessage } from "./sandbox";
export { inspectSandbox } from "./sandbox-inspect";

export { createWhatsAppIntake } from "./whatsapp-intake";
export { registerWhatsAppNumber } from "./whatsapp-registration";

export { createInboxStore } from "./inbox";
export type { InboxRef, InboxClaim } from "./inbox";
export { LeaseLost } from "./inbox-lease";
export type { InboxLease } from "./inbox-lease";
