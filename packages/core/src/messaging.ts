const WINDOW_MS = 86_400_000;
type PolicyInput = {
  now: Date;
  lastInbound: Date | null;
  status: string;
  allowOwner: boolean;
  template: { verifiedAt: Date } | null;
};
function current(date: Date | null, now: Date) {
  if (!date) return false;
  const age = now.getTime() - date.getTime();
  return age >= 0 && age < WINDOW_MS;
}
/** Approved templates carry fixed configured wording, never an arbitrary agent reply. */
export function messagePolicy(input: PolicyInput): "text" | "template" | "suppress" {
  if (input.status !== "agent" && !(input.status === "owner" && input.allowOwner))
    return "suppress";
  if (current(input.lastInbound, input.now)) return "text";
  return current(input.template?.verifiedAt ?? null, input.now) ? "template" : "suppress";
}
