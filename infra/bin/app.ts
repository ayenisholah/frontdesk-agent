import { readFileSync } from "node:fs";
import { createFoundation } from "../src/app";
import { parseInfraConfig } from "../src/config";
const input: unknown = JSON.parse(
  readFileSync(process.env.INFRA_CONFIG ?? "config/pilot.example.json", "utf8"),
);
createFoundation(parseInfraConfig(input)).app.synth();
