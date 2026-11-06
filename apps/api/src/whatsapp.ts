import escapeHtml from "escape-html";
import { rateLimit } from "express-rate-limit";
import express from "express";
import {
  parseWhatsAppWebhook,
  parseWhatsAppStatuses,
  type WhatsAppStatus,
  verifyWhatsAppSignature,
  type AcceptInbound,
} from "@frontdesk/channels";
import type { Logger } from "./log.js";

export interface WhatsAppOptions {
  appSecret: string;
  verifyToken: string;
  accept: AcceptInbound;
  acceptStatus?: (status: WhatsAppStatus) => Promise<unknown>;
}

export function createWhatsAppRouter(options: WhatsAppOptions, log: Logger) {
  const router = express.Router();
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "rate_limited" },
    }),
  );
  router.get("/", (req, res) => {
    const challenge = req.query["hub.challenge"];
    if (
      req.query["hub.mode"] !== "subscribe" ||
      req.query["hub.verify_token"] !== options.verifyToken ||
      typeof challenge !== "string" ||
      !/^\d{1,32}$/.test(challenge)
    ) {
      res.sendStatus(403);
      return;
    }
    res.type("text/plain").send(escapeHtml(challenge));
  });
  router.post(
    "/",
    express.raw({ type: () => true, limit: "1mb", inflate: false }),
    createMessageHandler(options, log),
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

function createMessageHandler(options: WhatsAppOptions, log: Logger): express.RequestHandler {
  return async (req, res) => {
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyWhatsAppSignature(body, req.get("x-hub-signature-256"), options.appSecret)) {
      res.sendStatus(401);
      return;
    }
    let messages;
    let statuses;
    try {
      const payload: unknown = JSON.parse(body.toString("utf8"));
      messages = parseWhatsAppWebhook(payload);
      statuses = parseWhatsAppStatuses(payload);
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
      await acceptStatuses(options, statuses);
      res.sendStatus(200);
    } catch {
      log.error("whatsapp storage unavailable", { code: "storage_failure" });
      res.sendStatus(503);
    }
  };
}

async function acceptStatuses(options: WhatsAppOptions, statuses: WhatsAppStatus[]) {
  for (const status of statuses) await options.acceptStatus?.(status);
}
