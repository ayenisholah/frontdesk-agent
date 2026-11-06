import { expect, it } from "vitest";
import { runRelease, recoverRelease } from "../src/release/runner";
import type { ReleasePorts } from "../src/release/types";
const old = "a".repeat(40),
  next = "b".repeat(40);
function fixture() {
  const calls: string[] = [];
  const ports: ReleasePorts = {
    target: "111111111111/frontdesk-pilot-runtime",
    inspect: async () => ({ app: old, migration: old, count: 1, prepared: "true" }),
    publish: async () => ({
      api: "sha256:" + "a".repeat(64),
      worker: "sha256:" + "b".repeat(64),
      migrate: "sha256:" + "c".repeat(64),
    }),
    update: async (p) => {
      calls.push(JSON.stringify(p));
    },
    migrate: async (record) => {
      record("task-1");
      calls.push("migrate");
    },
    verify: async (sha, count) => {
      calls.push(`verify:${sha}:${count}`);
    },
    record: () => {},
  };
  return { ports, calls };
}
it("migrates before promotion and records immutable images and previous parameters", async () => {
  const { ports, calls } = fixture();
  const result = await runRelease(next, ports);
  expect(result.status).toBe("succeeded");
  expect(result.previous?.app).toBe(old);
  expect(result.migrationTask).toBe("task-1");
  expect(calls).toEqual([
    JSON.stringify({ MigrationReleaseSha: next }),
    "migrate",
    JSON.stringify({ AppReleaseSha: next, DatabasePrepared: "true", ServiceDesiredCount: "1" }),
    `verify:${next}:1`,
  ]);
});
it("blocks promotion on migration or preparation failure", async () => {
  for (const step of ["inspect", "publish", "migrate"] as const) {
    const { ports, calls } = fixture();
    ports[step] = async () => {
      throw new Error("private credential");
    };
    const result = await runRelease(next, ports);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("private credential");
    expect(calls.some((x) => x.includes("AppReleaseSha"))).toBe(false);
  }
});
it("restores previous application parameters after a failed rollout, including first activation", async () => {
  for (const count of [0, 1] as const) {
    const { ports, calls } = fixture();
    ports.inspect = async () => ({ app: old, migration: old, count, prepared: "false" });
    ports.verify = async (sha) => {
      if (sha === next) throw new Error("bad readiness");
    };
    const result = await runRelease(next, ports);
    expect(result.status).toBe("rolled-back");
    expect(calls.at(-1)).toBe(
      JSON.stringify({
        AppReleaseSha: old,
        DatabasePrepared: "false",
        ServiceDesiredCount: String(count),
      }),
    );
  }
});
it("distinguishes rollback failure and supports recovery from a successful manifest", async () => {
  const { ports } = fixture();
  const successful = await runRelease(old, ports);
  expect((await recoverRelease(successful, ports)).status).toBe("recovered");
  await expect(recoverRelease({ ...successful, status: "failed" }, ports)).rejects.toThrow(
    "Invalid recovery manifest",
  );
  ports.update = async (p) => {
    if (p.AppReleaseSha) throw new Error("failed update");
  };
  expect((await runRelease(next, ports)).status).toBe("rollback-failed");
});
it("rejects malformed SHAs, foreign recovery manifests and replaced image digests", async () => {
  const { ports } = fixture();
  await expect(runRelease("not-a-sha", ports)).rejects.toThrow("Invalid release SHA");
  const successful = await runRelease(old, ports);
  await expect(recoverRelease({ ...successful, target: "other" }, ports)).rejects.toThrow(
    "Invalid recovery manifest",
  );
  ports.publish = async () => ({
    api: "sha256:" + "f".repeat(64),
    worker: "sha256:" + "b".repeat(64),
    migrate: "sha256:" + "c".repeat(64),
  });
  await expect(recoverRelease(successful, ports)).rejects.toThrow("Recovery image digest mismatch");
});
