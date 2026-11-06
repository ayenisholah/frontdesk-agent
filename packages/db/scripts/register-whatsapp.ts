import { parseArgs } from "node:util";
import { createDb, registerWhatsAppNumber } from "../src/index";

async function main() {
  const { values } = parseArgs({
    options: { "business-id": { type: "string" }, "phone-number-id": { type: "string" } },
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
    console.log("WhatsApp registration saved.");
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Registration failed. Check the arguments, business ID and database connection; existing numbers cannot be reassigned.",
  );
  process.exitCode = 1;
});
