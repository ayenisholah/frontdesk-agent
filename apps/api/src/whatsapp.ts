import express from "express";
import {
  parseWhatsAppWebhook,
  verifyWhatsAppSignature,
  type AcceptInbound,
} from "@frontdesk/channels";
import type { Logger } from "./log.js";

export interface WhatsAppOptions {
  appSecret: string;
  verifyToken: string;
  accept: AcceptInbound;
}

export function createWhatsAppRouter(options: WhatsAppOptions, log: Logger) {
  const router = express.Router();
  router.get("/", (req, res) => {
    const challenge = req.query["hub.challenge"];
    if (
      req.query["hub.mode"] !== "subscribe" ||
      req.query["hub.verify_token"] !== options.verifyToken ||
      typeof challenge !== "string" ||
      !challenge
    ) {
      res.sendStatus(403);
      return;
    }
    res.type("text/plain").send(challenge);
  });
  router.post(
    "/",
    express.raw({ type: () => true, limit: "1mb", inflate: false }),
    async (req, res) => {
      const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!verifyWhatsAppSignature(body, req.get("x-hub-signature-256"), options.appSecret)) {
        res.sendStatus(401);
        return;
      }
      let messages;
      try {
        messages = parseWhatsAppWebhook(JSON.parse(body.toString("utf8")));
      } catch {
        res.sendStatus(400);
        return;
      }
      try {
        for (const message of messages) {
          const result = await options.accept(message);
          if (result === "unregistered" || result === "conflict") {
            log.warn("whatsapp intake rejected", { code: result });
            res.sendStatus(result === "conflict" ? 409 : 503);
            return;
          }
        }
        res.sendStatus(200);
      } catch {
        log.error("whatsapp storage unavailable", { code: "storage_failure" });
        res.sendStatus(503);
      }
    },
  );
  router.use(
    (
      err: { type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.sendStatus(err.type === "entity.too.large" ? 413 : 400);
    },
  );
  return router;
}
