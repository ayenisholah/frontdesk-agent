import { z } from "zod";
import type { Manifest, ReleasePorts, Snapshot } from "./types";
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const recovery = z.object({
  version: z.literal(1),
  target: z.string(),
  sha: shaSchema,
  status: z.literal("succeeded"),
  images: z.object({ api: digest, worker: digest, migrate: digest }),
});
export async function runRelease(sha: string, ports: ReleasePorts): Promise<Manifest> {
  if (!shaSchema.safeParse(sha).success) throw new Error("Invalid release SHA");
  const report: Manifest = { version: 1, target: ports.target, sha, status: "preparing" };
  ports.record(report);
  try {
    report.previous = await ports.inspect();
    report.images = await ports.publish(sha);
    report.status = "migrating";
    ports.record(report);
    await ports.update({ MigrationReleaseSha: sha });
    await ports.migrate((arn) => {
      report.migrationTask = arn;
      ports.record(report);
    });
  } catch {
    report.status = "failed";
    ports.record(report);
    return report;
  }
  report.status = "promoting";
  ports.record(report);
  try {
    await restore(ports, { app: sha, migration: sha, count: 1, prepared: "true" });
    report.status = "succeeded";
  } catch {
    try {
      await restore(ports, report.previous);
      report.status = "rolled-back";
    } catch {
      report.status = "rollback-failed";
    }
  }
  ports.record(report);
  return report;
}
export async function recoverRelease(input: unknown, ports: ReleasePorts): Promise<Manifest> {
  const parsed = recovery.safeParse(input);
  if (!parsed.success || parsed.data.target !== ports.target)
    throw new Error("Invalid recovery manifest");
  await ports.inspect();
  const images = await ports.publish(parsed.data.sha);
  if (
    Object.keys(images).some(
      (key) =>
        images[key as keyof typeof images] !== parsed.data.images[key as keyof typeof images],
    )
  )
    throw new Error("Recovery image digest mismatch");
  await restore(ports, {
    app: parsed.data.sha,
    migration: parsed.data.sha,
    count: 1,
    prepared: "true",
  });
  const report: Manifest = { ...parsed.data, status: "recovered" };
  ports.record(report);
  return report;
}
async function restore(ports: ReleasePorts, snapshot: Snapshot) {
  await ports.update({
    AppReleaseSha: snapshot.app,
    DatabasePrepared: snapshot.prepared,
    ServiceDesiredCount: String(snapshot.count),
  });
  await ports.verify(snapshot.app, snapshot.count);
}
