import type { BusinessConfig } from "@frontdesk/core";
import { z } from "zod";
import { defineTool, type Tool } from "./tools";

const handoffReasons = [
  "complaint",
  "refund",
  "health",
  "unsupported_price",
  "low_confidence",
  "unknown_question",
  "customer_request",
  "repeated_failure",
] as const;
export type BusinessHandoff = (typeof handoffReasons)[number];
export type Slot = { startsAt: string; endsAt: string };
export type HoldInput = { serviceKey: string; startsAt: string };
export type AvailabilityInput = { serviceKey: string; from: string; to: string };
export type StoredHold =
  { ok: true; hold: Slot & { id: string; expiresAt: string } } | { ok: false; reason: string };
export interface ToolStore {
  availability(input: AvailabilityInput): Promise<Slot[]>;
  hold(runId: string, callId: string, input: HoldInput): Promise<StoredHold>;
  handoff(runId: string, callId: string, reason: string): Promise<void>;
}
export type BusinessContext = {
  config: BusinessConfig;
  store: ToolStore;
  runId: string;
  now: () => Date;
};
export type BusinessResult = { reply: string; failed?: boolean; handoff?: BusinessHandoff };
export const HANDOFF_REPLY = "The owner will reply shortly.";
const unavailable = (): BusinessResult => ({
  reply: "That service or time is unavailable. Please choose another.",
  failed: true,
});
const hasService = (context: BusinessContext, key: string) =>
  context.config.services.some((s) => s.id === key);
const dateTime = z.iso.datetime({ offset: true });
const availabilitySchema = z
  .strictObject({ serviceKey: z.string(), from: dateTime, to: dateTime })
  .refine((v) => {
    const span = Date.parse(v.to) - Date.parse(v.from);
    return span > 0 && span <= 7 * 86_400_000;
  });

function tool<S extends z.ZodType>(
  name: string,
  description: string,
  schema: S,
  run: (input: z.output<S>, context: BusinessContext, callId: string) => Promise<BusinessResult>,
) {
  return defineTool<BusinessContext, S>({ name, description, schema, run });
}

async function handoff(
  context: BusinessContext,
  callId: string,
  reason: BusinessHandoff,
): Promise<BusinessResult> {
  await context.store.handoff(context.runId, callId, reason);
  return { reply: HANDOFF_REPLY, handoff: reason };
}

function formatTime(value: string, zone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const services = tool(
  "get_services",
  "Lists active services and authoritative prices and deposits.",
  z.strictObject({}),
  (_input, { config }) => {
    const money = new Intl.NumberFormat("en", { style: "currency", currency: config.currency });
    const reply = config.services
      .map(
        (s) =>
          `${s.name}: ${money.format(s.priceCents / 100)}; deposit ${money.format(s.depositCents / 100)}.`,
      )
      .join("\n");
    return Promise.resolve({ reply });
  },
);

const availability = tool(
  "check_availability",
  "Find available slots in a range of at most seven days. Times must include a UTC offset.",
  availabilitySchema,
  async (input, context) => {
    if (!hasService(context, input.serviceKey)) return unavailable();
    const slots = await context.store.availability(input);
    if (!slots.length) return unavailable();
    const reply = slots
      .slice(0, 6)
      .map((s) => `${formatTime(s.startsAt, context.config.timezone)} (${s.startsAt})`)
      .join("\n");
    return { reply: `Available times (${context.config.timezone}):\n${reply}` };
  },
);

const hold = tool(
  "hold_slot",
  "Hold an engine-approved time for 15 minutes. This does not confirm a booking.",
  z.strictObject({ serviceKey: z.string(), startsAt: dateTime }),
  async (input, context, callId) => {
    if (!hasService(context, input.serviceKey)) return unavailable();
    const result = await context.store.hold(context.runId, callId, input);
    if (!result.ok) return unavailable();
    const at = (value: string) => formatTime(value, context.config.timezone);
    return {
      reply: `Held ${at(result.hold.startsAt)} until ${at(result.hold.expiresAt)} (${context.config.timezone}). This is not a confirmed booking.`,
    };
  },
);

const faq = tool(
  "answer_faq",
  "Answer from the numbered FAQ in the context. Use null if no FAQ answers the question.",
  z.strictObject({ index: z.number().int().min(0).nullable() }),
  (input, context, callId) => {
    const entry = input.index === null ? undefined : context.config.faq[input.index];
    return entry
      ? Promise.resolve({ reply: entry.answer })
      : handoff(context, callId, "unknown_question");
  },
);

const owner = tool(
  "handoff_to_owner",
  "Stop the conversation and ask the owner to respond.",
  z.strictObject({ reason: z.enum(handoffReasons) }),
  (input, context, callId) => handoff(context, callId, input.reason),
);

export function createBusinessTools(): Tool<BusinessContext>[] {
  return [services, availability, hold, faq, owner];
}
