# Session-Scoped Assistant Bridge Channel Contract

## Problem

After switching the overlay to a cloud container server URL, the selected
coding-assistant session can receive a `message.updated` event whose
`payload.info` has no `channel`. `tree-writer` correctly rejects it because
`channel` is the backend-stamped routing source of truth.

The observed event is an `ephemeral-*` session event:

- `type="message.updated"`
- `aggregate="session"` stream shape
- `info.role="assistant"`
- `info.agent="coding-assistant"`
- missing `info.channel` and `info.resolvedRole`

## Grep Coverage

| Surface | Finding |
| --- | --- |
| `packages/overlay/src/services/tree-writer.ts` | `deriveSessionStage()` intentionally throws when `info.channel` is missing. No frontend fallback should be added. |
| `packages/opencorvus/src/protocol/session-mirror.ts` | `mapSessionBusEvent()` already stamps `channel/resolvedRole`, but `shouldMirrorStandaloneSession()` only allows `mission` and right-sidebar metadata assistant sessions. |
| `packages/opencorvus/src/server/routes/session.ts` | `/session/:sessionID/events` is the session-scoped SSE route and delegates live message mapping to `subscribeSessionMirror()`. |
| `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | Task-scoped message bridge already uses `overlayMeta()` as the single source for channel routing. |
| `packages/overlay/src/services/sse.ts` and `packages/overlay/src/services/events.ts` | Session SSE events route directly to tree-writer; there is no safe client-side place to infer missing backend metadata. |

## Fix

Make `session-mirror` treat session-scoped assistant streams as valid targets,
not just sessions with right-sidebar metadata. The route already subscribes by
exact `sessionID`, so the server should enrich the requested assistant session
from `session.kind` and message role using the existing `overlayMeta()` path.

This is not a compatibility fallback: the emitted SSE contract remains
strictly channel-stamped. The change removes the right-sidebar-only special
case from the server mirror eligibility decision.

## Tests

- Update `session-mirror.test.ts` so a plain assistant session is mirrored and
  its `message.updated` payload includes `info.channel="assistant"` and
  `info.resolvedRole="assistant"`.
- Add route-level SSE coverage for `GET /session/:sessionID/events` with a
  plain assistant session, because the original crash was visible only on the
  real session event stream.
- Add a regression test using the cloud-container payload shape from the bug
  report to prove raw assistant message info is enriched before reaching SSE.
