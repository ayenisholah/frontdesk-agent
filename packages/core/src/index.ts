// Domain rules with no I/O: availability, booking rules and policies.
export { findSlots, isSlotAvailable, type Interval, type SlotQuery } from "./availability";
export { isE164, normalizePhone } from "./phone";
export { canChangeBooking, type PolicyDecision } from "./policy";
export {
  assertBusinessConfig,
  businessConfigSchema,
  formatMinuteOfDay,
  isTimeZone,
  minuteOfDay,
  parseBusinessConfig,
  type BusinessConfig,
  type OpeningHoursConfig,
  type ParseResult,
  type ServiceConfig,
} from "./config";
export { harborPaws } from "./fixtures/harbor-paws";
export { messagePolicy } from "./messaging";
export { retentionCutoff, DEFAULT_RETENTION_DAYS } from "./retention";
