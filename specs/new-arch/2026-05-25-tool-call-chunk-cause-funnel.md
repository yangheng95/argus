# 2026-05-25 Tool Call Chunk Cause Funnel

## Evidence

- AI SDK v6 `node_modules/.bun/ai@6.0.172.../node_modules/ai/dist/index.js`:
  - `parseToolCall` lines 3789-3803 returns `type:"tool-call"`, `invalid:true`, raw/parsed `input`, and original `error`.
  - `runToolsTransformation` lines 6310-6331 enqueues that invalid `tool-call` and immediately enqueues a paired `tool-error` carrying the same `toolCallId`, `input`, and error message.
- Current `session/processor.ts` drops invalid array/string inputs at `tool-call` by re-normalizing via `normalizeToolInput`, leaving the part pending.
- Current `tool-error` / `tool-result` handlers require `status === "running"`, so the paired SDK error cannot update that pending part.
- Current cleanup rewrites any remaining open tool part to a static abort label, losing the SDK parse cause and original input.
- Reproducer added in `packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts`: invalid `tool-call` plus paired `tool-error` initially failed because the persisted part contained that static abort label.

## Call Point Inventory

| Surface                                                            | Current behavior                                                                                  | Change                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `session/processor.ts` tool-call                                   | Re-normalizes `value.input`; invalid non-object breaks before persisting                          | Persist SDK `value.input` as `unknown`; do not re-parse or skip                                           |
| `session/processor.ts` tool-result/tool-error                      | Only accepts `running`                                                                            | Accept `running` or `pending`; synthesize start time from existing running time or `Date.now()`           |
| `session/processor.ts` cleanup                                     | Writes a static abort label                                                                       | Throw typed `ProcessorLostPartsError` for remaining pending/running parts                                 |
| `session/processor.ts` catch                                       | Message-level error only                                                                          | Stamp open tool parts with `ToolFailureCause` from the caught original cause before final lost-part audit |
| `session/message.ts` schemas                                       | Tool error stores string `error`; pending/running inputs require object                           | Store `failure: ToolFailureCause`; relax pending/running/error input to `z.unknown()`                     |
| `session/message.ts` replay                                        | `safeToolInput` converts invalid input to `{}` and pending/running use a static interrupted label | Replay original input and render only persisted `ToolFailureCause` text                                   |
| `session/loop.ts` task wrapper                                     | Writes a static execution-failed fallback                                                         | Persist `ToolFailureCause` from thrown failure; if no thrown failure exists, throw a typed contract error |
| `agent/runner.ts` hard error                                       | Reads only `finalMessage.info.error`                                                              | Also scan assistant tool parts for `ToolFailureCause` and raise `AgentRunError`                           |
| `session/compaction.ts`                                            | Reads `part.state.error`                                                                          | Render `ToolFailureCause`                                                                                 |
| `acp/agent.ts`, `cli/cmd/run.ts`, `cli/cmd/tui/util/transcript.ts` | Display `part.state.error`                                                                        | Display rendered `ToolFailureCause`                                                                       |
| `engine/engine.sql.ts`                                             | Artifact kind lacks tool execution failures                                                       | Add `tool-execute-error`                                                                                  |
| `engine/persist.ts`                                                | No writer for tool part failures                                                                  | Add `recordToolExecuteError` modeled after `recordOrchestratorStreamError`                                |
| `engine/store.ts`, `engine/describe.ts`                            | No reader/projection for tool execute artifacts                                                   | Add newest-first list and describe/render section                                                         |

## ToolFailureCause Contract

Declare `ToolFailureCause` in `packages/opencorvus/src/session/tool-failure-cause.ts`:

- `kind`: stable family, e.g. `tool-input-invalid`, `tool-execute-error`, `llm-activity-error`, `processor-lost-parts`.
- `name`: original error class/name when available.
- `message`: original error message; no fabricated fallback strings.
- `originSite`: code boundary that observed the failure, e.g. `session.processor.tool-error`.
- `classification`: retry/triage class supplied by the observing boundary.
- `data`: optional structured details such as `toolCallId`, `toolName`, `partIDs`, or raw error data.

All model replay and human/UI renderers call one formatter for this structure. No caller writes independent error prose.

## Implementation Plan

1. Replace `ToolStateError.error` with `ToolStateError.failure`, relax open/error inputs to `z.unknown()`, and update readers.
2. Align processor chunk contract:
   - remove `normalizeToolInput` early return in `tool-call`;
   - use raw SDK input for running/error/completed states;
   - accept pending matches in `tool-result` and `tool-error`;
   - convert caught LLM activity/provider causes into open part `ToolFailureCause`;
   - throw `ProcessorLostPartsError` if any open parts remain after catch handling.
3. Delete the three fallback strings and update all grep hits.
4. Extend runner hard-error detection to part-level `ToolFailureCause`.
5. Add `tool-execute-error` artifact kind, writer, reader, describe projection, and render section.
6. Run targeted suites: `bun test packages/opencorvus/test/session/ packages/opencorvus/test/agent/`, plus engine tests covering the new artifact reader/writer.

## Tests

- Invalid AI SDK tool-call pair persists original input and structured cause.
- Idle-gate/abort path stamps open parts with the real LLM activity cause.
- Clean finish with residual pending part throws `ProcessorLostPartsError`.
- Runner detects part-level `ToolFailureCause` and throws `AgentRunError`.
- `toModelMessages` renders structured cause text and never emits the deleted interrupted string.
- `tool-execute-error` artifact writer and describe reader round-trip.
