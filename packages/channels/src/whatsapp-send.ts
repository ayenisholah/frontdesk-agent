import { z } from "zod";

export type SendResult =
  | { state: "accepted"; providerMessageId: string }
  | { state: "retryable_rejection"; retryAfterMs: number }
  | { state: "permanent_rejection" | "uncertain" };
export type SendMessage = {
  recipient: string;
  attemptId: string;
  content:
    | { type: "text"; body: string }
    | { type: "template"; name: string; language: string; incidentId?: string };
};
const settings = z.object({
  token: z.string().min(1),
  phoneNumberId: z.string().regex(/^\d+$/),
  version: z.string().regex(/^v\d+\.\d+$/),
});
const accepted = z.object({
  messages: z.array(z.object({ id: z.string().min(1).max(256) })).min(1),
});
const transientCodes = new Set([4, 80007, 130429, 131056]);
const rejected = z.object({
  error: z.object({ code: z.number().int(), is_transient: z.boolean().optional() }),
});

function payload(message: SendMessage) {
  const common = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: message.recipient.replace(/^\+/, ""),
    biz_opaque_callback_data: message.attemptId,
  };
  const content = message.content;
  if (content.type === "text")
    return { ...common, type: "text", text: { body: content.body, preview_url: false } };
  return {
    ...common,
    type: "template",
    template: {
      name: content.name,
      language: { code: content.language },
      ...(content.incidentId
        ? {
            components: [
              { type: "body", parameters: [{ type: "text", text: content.incidentId }] },
            ],
          }
        : {}),
    },
  };
}

async function classify(response: Response): Promise<SendResult> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: "uncertain" };
  }
  if (response.ok) {
    const parsed = accepted.safeParse(body);
    return parsed.success
      ? { state: "accepted", providerMessageId: parsed.data.messages[0]!.id }
      : { state: "uncertain" };
  }
  const error = rejected.safeParse(body);
  if (!error.success) return { state: "uncertain" };
  if (
    response.status === 429 ||
    response.status >= 500 ||
    transientCodes.has(error.data.error.code) ||
    error.data.error.is_transient
  ) {
    return {
      state: "retryable_rejection",
      retryAfterMs: retryAfter(response.headers.get("retry-after")),
    };
  }
  return { state: "permanent_rejection" };
}

/** Never log or return provider error bodies, credentials or recipient details. */
export function createWhatsAppSender(options: {
  token: string;
  phoneNumberId: string;
  version: string;
  request?: typeof fetch;
}) {
  const parsed = settings.safeParse(options);
  if (!parsed.success) throw new Error("Invalid sender configuration");
  const { token, phoneNumberId, version } = parsed.data;
  const request = options.request ?? fetch;
  return async (message: SendMessage): Promise<SendResult> => {
    try {
      const response = await request(
        `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(payload(message)),
          signal: AbortSignal.timeout(15_000),
        },
      );
      return await classify(response);
    } catch {
      return { state: "uncertain" };
    }
  };
}

function retryAfter(header: string | null) {
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header!) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 86_400_000) : 0;
}
