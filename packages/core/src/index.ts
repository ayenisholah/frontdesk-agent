// Domain rules with no I/O: availability, booking rules and policies (Days 3–4).
export { isE164, normalizePhone } from "./phone";
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
