# 0004: Claude on Amazon Bedrock behind ModelClient

**Status:** Accepted

## Context

The SPEC first chose OpenAI. With everything else moving to AWS, a second vendor adds an API key to protect, another bill and another place customer text is sent. No agent code existed when this was decided.

## Decision

Use Claude on Amazon Bedrock through the Converse API, authenticated by IAM. All model calls go through a `ModelClient` interface. Model IDs come from `BEDROCK_MODEL_ID` and `BEDROCK_MODEL_ID_SMALL`, never from code.

## Consequences

- No model API key to store or rotate, and spend sits on the AWS bill.
- Customer messages stay within AWS for inference. [Data privacy](../DATA_PRIVACY.md) must record this.
- Model availability and quotas vary by region, so M4's region choice depends on them.
- Evals can still compare models and providers through `ModelClient`.
