import { describe, expect, it } from "vitest";
import { parseAgentConfig, ModelFailure } from "../src/index";

const env = {
  AWS_REGION: "eu-west-1",
  BEDROCK_MODEL_ID: "eu.anthropic.example",
  BEDROCK_MODEL_ID_SMALL: "eu.anthropic.small",
  BEDROCK_RATES: JSON.stringify({
    version: "test",
    models: {
      "eu.anthropic.example": { inputMicrosPerToken: 3, outputMicrosPerToken: 15 },
      "eu.anthropic.small": { inputMicrosPerToken: 1, outputMicrosPerToken: 5 },
    },
  }),
};

describe("agent configuration", () => {
  it("requires EU models and versioned rates for both models", () => {
    expect(parseAgentConfig(env).region).toBe("eu-west-1");
    expect(() => parseAgentConfig({ ...env, AWS_REGION: "us-east-1" })).toThrow();
    expect(() => parseAgentConfig({ ...env, BEDROCK_MODEL_ID: "global.example" })).toThrow();
    expect(() => parseAgentConfig({ ...env, BEDROCK_RATES: "{}" })).toThrow();
    expect(() => parseAgentConfig({ ...env, BEDROCK_RATES: "not json" })).toThrow(
      "Invalid agent configuration",
    );
    expect(() => parseAgentConfig({ ...env, BEDROCK_MODEL_ID_SMALL: "eu.missing" })).toThrow();
    expect(() => parseAgentConfig({})).toThrow();
  });

  it("does not expose provider error details", () => {
    expect(new ModelFailure("unavailable").message).toBe("Model unavailable");
  });
});
