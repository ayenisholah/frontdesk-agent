import express, { type Request, type Response, type NextFunction } from "express";
import type { Check } from "./checks.js";
import type { Logger } from "./log.js";

import { createWhatsAppRouter, type WhatsAppOptions } from "./whatsapp.js";

export interface AppOptions {
  checks: Record<string, Check>;
  log: Logger;
  release: string;
  whatsapp?: WhatsAppOptions;
}

export function createApp({ checks, log, release, whatsapp }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    });
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      log.info("request", {
        method: req.method,
        path: ["/healthz", "/readyz", "/webhooks/whatsapp"].includes(req.path)
          ? req.path
          : "unmatched",
        status: res.statusCode,
        ms: Math.round(ms),
      });
    });
    next();
  });

  if (whatsapp) app.use("/webhooks/whatsapp", createWhatsAppRouter(whatsapp, log));

  // Liveness: the process is up. Never touches dependencies.
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", release });
  });

  // Readiness: every dependency answers within its timeout (NFR-11).
  app.get("/readyz", async (_req, res) => {
    const results = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, "ok"] as const;
        } catch {
          log.warn("readiness check failed", { check: name, code: "dependency_unavailable" });
          return [name, "fail"] as const;
        }
      }),
    );
    const ok = results.every(([, s]) => s === "ok");
    res
      .status(ok ? 200 : 503)
      .json({ status: ok ? "ok" : "degraded", release, checks: Object.fromEntries(results) });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error("unhandled error", { code: "internal" });
    res.status(500).json({ error: "internal" });
  });

  return app;
}
