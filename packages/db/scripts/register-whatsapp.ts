import { parseArgs } from "node:util";
import { verifyWhatsAppTemplates } from "@frontdesk/channels";
import { createDb, registerWhatsAppNumber, configureWhatsAppDelivery } from "../src/index";

async function main() {
  const { values } = parseArgs({
    options: {
      "business-id": { type: "string" },
      "phone-number-id": { type: "string" },
      "configure-delivery": { type: "boolean", default: false },
      "token-env": { type: "string" },
      "graph-version": { type: "string" },
      "owner-phone": { type: "string" },
      "waba-id": { type: "string" },
      "owner-template": { type: "string" },
      "owner-language": { type: "string" },
      "customer-template": { type: "string" },
      "customer-language": { type: "string" },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createDb(url);
  try {
    await registerWhatsAppNumber(db, {
      businessId: values["business-id"],
      phoneNumberId: values["phone-number-id"],
    });
    if (values["configure-delivery"]) {
      const tokenEnv = values["token-env"];
      if (!tokenEnv || !/^WHATSAPP_[A-Z0-9_]+_TOKEN$/.test(tokenEnv))
        throw new Error("Invalid token reference");
      const templates = await verifyWhatsAppTemplates(
        {
          token: process.env[tokenEnv],
          version: values["graph-version"],
          wabaId: values["waba-id"],
          owner: { name: values["owner-template"], language: values["owner-language"] },
          ...(values["customer-template"]
            ? {
                customer: {
                  name: values["customer-template"],
                  language: values["customer-language"],
                },
              }
            : {}),
        },
        { request: fetch, clock: () => new Date() },
      );
      await configureWhatsAppDelivery(db, {
        businessId: values["business-id"],
        phoneNumberId: values["phone-number-id"],
        credentialEnv: tokenEnv,
        graphVersion: values["graph-version"],
        ownerPhone: values["owner-phone"],
        templates,
      });
    }
    console.log("WhatsApp registration saved.");
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Registration failed. Check the arguments, business ID and database connection; template approval and delivery configuration; existing numbers cannot be reassigned.",
  );
  process.exitCode = 1;
});
