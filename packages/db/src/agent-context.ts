import type { InboxLease } from "./inbox-lease";

export type AgentScope = {
  businessId: string;
  customerId: string;
  conversationId: string;
  lease?: InboxLease;
  signal?: AbortSignal;
};
