import type { SendMessage, SendResult } from "@frontdesk/channels";
import type { createDeliveryStore, DeliveryRef } from "@frontdesk/db";
type Store = Pick<ReturnType<typeof createDeliveryStore>, "route" | "defer" | "begin" | "resolve">;
type Sender = { phoneNumberId: string; credentialEnv: string; version: string };
export function createOutboundProcessor(deps: {
  store(businessId: string): Store;
  limit(route: { senderId: string; recipientId: string }): Promise<number>;
  send(sender: Sender, message: SendMessage): Promise<SendResult>;
}) {
  return async (ref: DeliveryRef) => {
    const store = deps.store(ref.businessId);
    const route = await store.route(ref.id);
    if (!route) return;
    if (route.state === "pending") {
      const wait = await deps.limit(route);
      if (wait > 0) {
        await store.defer(ref.id, wait);
        return;
      }
    }
    const claim = await store.begin(ref.id);
    if (claim.state !== "send") return;
    let result: SendResult;
    try {
      result = await deps.send(claim.sender, claim.message);
    } catch {
      result = { state: "uncertain" };
    }
    await store.resolve(claim.attemptId, result);
  };
}
