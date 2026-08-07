# Right Sidebar Session Bridge Channel Fix

## Problem

Right-sidebar coding assistant live events are mirrored from `protocol/session-mirror.ts`.
That path emits `message.updated` with raw `info`, so `info.channel` is absent and
`packages/overlay/src/services/tree-writer.ts` correctly throws:

`tree-writer: message info is missing channel -- bridge enrichment contract broken`

## Evidence

Full-repo grep covered the relevant event and bridge surfaces:

| Surface                                                           | Finding                                                                                                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/services/tree-writer.ts`                    | `deriveSessionStage()` requires backend-stamped `channel`; no frontend fallback should be added.                                                   |
| `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | Task-scoped events use `enrichProperties()` and already stamp `channel/resolvedRole`.                                                              |
| `packages/opencorvus/src/protocol/session-mirror.ts`              | Session-scoped mirror stamps only mission payloads; right-sidebar assistant sessions are passed through raw.                                       |
| `packages/opencorvus/src/server/routes/session.ts`                | `/session/:sessionID/conversation` used the mission-only transcript enrichment path, so right-sidebar hydrate had the same missing-channel defect. |
| `packages/opencorvus/src/executor/opencorvus.ts`                  | Uses `mapSessionBusEvent()` for executor event streams; keep event shape compatible while enriching message payloads.                              |

## Fix

Use one standalone-session enrichment path in `session-mirror.ts`:

- Mission keeps existing semantics: user messages go to `channel="main"`, assistant messages go to `channel="mission"`.
- Right-sidebar coding assistant and other standalone assistant sessions get `role="user"` as `main/user`, and assistant/tool output as `assistant/assistant`.
- `message.part.updated`, `message.part.delta`, removals, and transcript hydrate all use the same session/message role lookup instead of frontend fallback.

## Tests

- Extend `packages/opencorvus/test/protocol/session-mirror.test.ts` to assert right-sidebar live `message.updated`, `message.part.updated`, and `message.part.delta` carry `channel/resolvedRole`.
- Add hydrate coverage proving `enrichStandaloneSessionTranscript()` stamps right-sidebar assistant transcript messages and parts.
