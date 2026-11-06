export type Parameters = Partial<
  Record<
    "AppReleaseSha" | "MigrationReleaseSha" | "ServiceDesiredCount" | "DatabasePrepared",
    string
  >
>;
export type Snapshot = { app: string; migration: string; count: 0 | 1; prepared: "true" | "false" };
export type Images = Record<"api" | "worker" | "migrate", string>;
export type Manifest = {
  version: 1;
  target: string;
  sha: string;
  status:
    | "preparing"
    | "migrating"
    | "promoting"
    | "succeeded"
    | "failed"
    | "rolled-back"
    | "rollback-failed"
    | "recovered";
  previous?: Snapshot;
  images?: Images;
  migrationTask?: string;
};
export interface ReleasePorts {
  target: string;
  inspect(): Promise<Snapshot>;
  publish(sha: string): Promise<Images>;
  update(parameters: Parameters): Promise<void>;
  migrate(record: (arn: string) => void): Promise<void>;
  verify(sha: string, count: 0 | 1): Promise<void>;
  record(manifest: Manifest): void;
}
