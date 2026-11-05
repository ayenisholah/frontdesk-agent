// Seeds the fictional pilot business. Safe to run repeatedly.
import { harborPaws } from "@frontdesk/core";
import { createDb, saveBusinessConfig } from "../src/index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = createDb(url);
try {
  const id = await saveBusinessConfig(db, harborPaws);
  const services = await db.service.count({ where: { businessId: id, active: true } });
  console.log(
    `Seeded ${harborPaws.slug} (${id}): ${services} services, ${harborPaws.openingHours.length} opening intervals`,
  );
} finally {
  await db.$disconnect();
}
