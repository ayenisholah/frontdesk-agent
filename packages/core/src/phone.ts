// WhatsApp and Twilio identify customers by E.164 phone number. Every Customer row
// stores this canonical form, so the same person is never split across two records.
const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(value: string): boolean {
  return E164.test(value);
}

/** Strips spaces, dashes, dots and brackets; accepts a leading "00" as "+". Returns null if not E.164. */
export function normalizePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+") && /^\d+$/.test(s)) s = "+" + s;
  return isE164(s) ? s : null;
}
