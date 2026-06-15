# Provider Tool Call ID Normalization

Date: 2026-06-15
Status: implementation plan

## Acronyms

- LLM: Large Language Model, the model provider receiving transformed messages.
- SDK: Software Development Kit, the provider adapter layer used by `ai`.

## Problem

Vendor-specific tool call ID normalization rewrites IDs independently per part.
Claude replaces invalid characters with `_`, so `call:a` and `call/a` collide.
Mistral truncates to nine alphanumeric characters, so `abcdefghi1` and
`abcdefghi2` collide. Mistral also inserts a fixed assistant `"Done."` message
between `tool` and `user`, which is a provider-only synthetic message not
present in the real conversation stream.

## Call Point Sweep

| Surface | Call point | Decision |
| --- | --- | --- |
| Vendor transform | `packages/opencorvus/src/provider/vendor-messages.ts` `claudeSanitizeToolCallIds` | Replace per-part rewrite with a request-local original-ID to normalized-ID mapping that preserves uniqueness and tool-call/tool-result pairing. |
| Vendor transform | `vendor-messages.ts` `mistralToolCallIdPadAndSeq` | Use the same mapping discipline while keeping Mistral's exact nine-character alphanumeric constraint. |
| Vendor transform | `vendor-messages.ts` `mistralToolCallIdPadAndSeq` tool-to-user bridge | Remove the synthetic assistant message; message sequence issues must be handled by real conversation construction or explicit provider failure, not hidden content. |
| Shared transform | `packages/opencorvus/src/provider/transform.ts` | No contract change; it remains the dispatcher through `normalizeVendorMessages`. |
| Tests | `packages/opencorvus/test/provider/transform.test.ts` | Add collision tests for Claude and Mistral plus a no-synthetic-bridge assertion. |
| Existing request contract | `packages/opencorvus/test/provider/request-body-contract.test.ts` | Existing single-ID sanitization expectation remains valid for non-colliding IDs. |

## Acceptance

- Distinct original tool call IDs remain distinct after vendor normalization.
- A tool result keeps the same normalized ID as its corresponding tool call.
- Mistral normalized IDs remain exactly nine alphanumeric characters.
- Mistral normalization does not create a fixed assistant bridge message.
