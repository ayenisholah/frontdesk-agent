// Maps a validated BusinessConfig to rows and back. Loading re-validates, so whatever is in the
// database, the agent only ever sees a config that passes the same schema as the seed and the
// dashboard settings editor.
import {
  assertBusinessConfig,
  formatMinuteOfDay,
  minuteOfDay,
  type BusinessConfig,
} from "@frontdesk/core";
import type { Db } from "./client";
import { lockSlots } from "./slots";

/**
 * Creates or updates a business from config, in one transaction. Idempotent.
 * Services are matched by key: changed ones are updated, removed ones are deactivated (bookings
 * may still reference them), and opening hours are replaced.
 */
export async function saveBusinessConfig(db: Db, input: BusinessConfig): Promise<string> {
  const config = assertBusinessConfig(input);
  const fields = {
    name: config.name,
    timezone: config.timezone,
    currency: config.currency,
    capacity: config.capacity,
    bufferBeforeMinutes: config.buffers.beforeMinutes,
    bufferAfterMinutes: config.buffers.afterMinutes,
    cancellationWindowHours: config.cancellationWindowHours,
    faq: config.faq,
    tone: config.tone,
  };

  return db.$transaction(async (tx) => {
    const business = await tx.business.upsert({
      where: { slug: config.slug },
      create: { slug: config.slug, ...fields },
      update: fields,
      select: { id: true },
    });
    const businessId = business.id;
    // A claim in progress must not read half-changed hours or capacity.
    await lockSlots(tx, businessId);

    for (const [position, s] of config.services.entries()) {
      const data = {
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceCents: s.priceCents,
        depositCents: s.depositCents,
        position,
        active: true,
      };
      await tx.service.upsert({
        where: { businessId_key: { businessId, key: s.id } },
        create: { businessId, key: s.id, ...data },
        update: data,
      });
    }
    await tx.service.updateMany({
      where: { businessId, key: { notIn: config.services.map((s) => s.id) } },
      data: { active: false },
    });

    await tx.openingHours.deleteMany({ where: { businessId } });
    await tx.openingHours.createMany({
      data: config.openingHours.map((h) => ({
        businessId,
        weekday: h.weekday,
        openMinute: minuteOfDay(h.open),
        closeMinute: minuteOfDay(h.close),
      })),
    });

    return businessId;
  });
}

/** Loads a business's config by slug, or null if there is none. Throws if the stored data is invalid. */
export async function loadBusinessConfig(db: Db, slug: string): Promise<BusinessConfig | null> {
  const b = await db.business.findUnique({
    where: { slug },
    include: {
      services: { where: { active: true }, orderBy: { position: "asc" } },
      openingHours: { orderBy: [{ weekday: "asc" }, { openMinute: "asc" }] },
    },
  });
  if (!b) return null;

  return assertBusinessConfig({
    slug: b.slug,
    name: b.name,
    timezone: b.timezone,
    currency: b.currency,
    services: b.services.map((s) => ({
      id: s.key,
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
      depositCents: s.depositCents,
    })),
    openingHours: b.openingHours.map((h) => ({
      weekday: h.weekday,
      open: formatMinuteOfDay(h.openMinute),
      close: formatMinuteOfDay(h.closeMinute),
    })),
    capacity: b.capacity,
    buffers: { beforeMinutes: b.bufferBeforeMinutes, afterMinutes: b.bufferAfterMinutes },
    cancellationWindowHours: b.cancellationWindowHours,
    faq: b.faq,
    tone: b.tone,
  });
}
