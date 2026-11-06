import { parseArgs } from "node:util";
import { createDb, createDeliveryOperator } from "../src/index";
async function main() {
  const { values } = parseArgs({
    options: {
      "business-id": { type: "string" },
      inspect: { type: "boolean" },
      "resolve-id": { type: "string" },
      resolution: { type: "string" },
      "provider-id": { type: "string" },
    },
    strict: true,
  });
  if (!process.env.DATABASE_URL || !values["business-id"]) throw new Error("Missing configuration");
  const db = createDb(process.env.DATABASE_URL);
  try {
    const operator = createDeliveryOperator(db, values["business-id"], () => new Date());
    if (values.inspect) console.log(JSON.stringify(await operator.inspect(), null, 2));
    else if (values["resolve-id"]) {
      await operator.resolve(values["resolve-id"], {
        state: values.resolution,
        providerMessageId: values["provider-id"],
      });
      console.log("Delivery resolution recorded. No message was resent.");
    } else throw new Error("Missing operation");
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Delivery operation failed. Check the business, operation and database connection.",
  );
  process.exitCode = 1;
});
