import { runConversationTurn, type ConversationOptions } from "@frontdesk/agent";
import { createAgentStore, createInboxStore, prepareInboxTurn, type Db } from "@frontdesk/db";
import { createInboundProcessor } from "./inbound";
import { cancelModel } from "./cancel-model";

type Options = Omit<ConversationOptions, "store"> & {
  db: Db;
  report: () => void;
  retentionDays?: number;
};
export function createAgentWorker(options: Options) {
  const { db, clock, report } = options;
  return createInboundProcessor({
    inbox: (businessId) => createInboxStore(db, businessId, clock, options.retentionDays),
    prepare: (claim) => prepareInboxTurn(db, { ...claim.scope, lease: claim.lease }, clock),
    execute: (claim, signal) =>
      runConversationTurn(
        {
          ...options,
          store: createAgentStore(db, { ...claim.scope, lease: claim.lease, signal }, clock),
          model: cancelModel(options.model, signal),
          classifier: cancelModel(options.classifier, signal),
        },
        claim.messageId,
      ),
    report,
  });
}
