# 2026-06-10 Build Card Steer Operator Guidance

> Superseded for overlay targeted steer on 2026-06-29 by
> [2026-06-29-operator-steer-single-source.md](2026-06-29-operator-steer-single-source.md).
> The historical direct-reply/build task-root split below is not current
> runtime behavior. Current contract: every inline sub-agent steer, including
> build, uses `POST /task/:taskID/session/:sessionID/operator-steer`; `POST
> /task/:taskID/message` is strict task-root input and rejects target/build
> session fields.

## Problem

The overlay renders the same inline "Steer" box for every non-root agent or
phase session. For goal execution, the useful target is the build phase, but
the box currently calls `POST /task/:taskID/session/:sessionID/reply`. Build
sessions are intentionally rejected by the direct-reply route, so the build
phase is the one place where the visible control most reliably fails.

The product intent is inverted: requirements / architect / integrity direct
reply is useful but optional; build is the session users most often need to
guide while work is happening.

## Existing Evidence

| Surface                                                                    | Current behavior                                                                                                                         | Decision                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/opencorvus/src/orchestrator/direct-reply.ts`                     | `DIRECT_REPLY_AGENT_KINDS` excludes `build`; `DIRECT_AGENT_SESSION_CONTROL_KINDS` includes `build` for cancel/control only.              | Keep. Direct reply and session control are separate concepts.                  |
| `packages/opencorvus/src/task-api/index.ts::resolveDirectReplyTarget`      | Rejects any session kind outside `DIRECT_REPLY_AGENT_KINDS` with `InvalidReplyTargetKindError`.                                          | Keep for generic direct reply.                                                 |
| `packages/opencorvus/src/task-api/index.ts::appendDirectAgentSessionReply` | Rejects build-tagged envelopes with `BuildSessionDirectReplyError` because the next loop would wake build tools through a generic route. | Keep. This prevents runtime contract pollution.                                |
| `packages/opencorvus/src/orchestrator/tools.ts::steer_subagent`            | Non-build children call `EngineService.replyAgentSession`; live-owned build children return an activity snapshot and never inject.       | Keep. This is the orchestrator tool contract from the 2026-05-24 spec.         |
| `packages/overlay/src/components/Card.tsx`                                 | Build phase cards can identify `phaseSessionKind === "build"` / `phaseID === "build"` and have `phaseSessionID`.                         | Route build phase input through task operator message instead of direct reply. |
| `packages/overlay/src/components/ChatBubble.tsx`                           | Top-level agent cards carry `stage`; a build message card can identify `stage === "build"`.                                              | Route build agent input through task operator message instead of direct reply. |
| `packages/overlay/src/services/task.ts::replyToAgentSession`               | Posts to `/task/:taskID/session/:sessionID/reply`.                                                                                       | Keep for non-build session steering.                                           |
| `packages/opencorvus/src/server/routes/orchestrator.ts`                    | `POST /task/:taskID/message` is the single task-level operator message route.                                                            | Reuse; do not add a parallel route.                                            |

## Historical Constraint

The pre-June build interruption stabilization and steer-subagent probe records explicitly reject out-of-band
build direct replies. The old incident class was caused by generic steering
colliding with goal_run ownership and `SessionRuntimeContract` identity.

Therefore this change must not add `build` to `DIRECT_REPLY_AGENT_KINDS` and
must not make `steer_subagent` call `replyAgentSession` for build sessions.

## Design

Keep one inline component, but give it a routing mode:

- `session`: current direct reply behavior for non-build sessions.
- `task`: build guidance behavior. The UI posts a visible task operator
  message to `/task/:taskID/message`, with a short visible context header that
  names the target build session / phase before the user's text.

This preserves the single backend owner for task-level operator messages. The
orchestrator sees normal user-authored text and decides whether to wait, probe,
cancel stale ownership, or dispatch a fresh `build({ goalID, request })`.

## Non-Goals

- Do not implement provider-native live build continuation in this change.
- Do not create a second build-specific message route.
- Do not hide the build steer box. The visible control should work on the
  build phase, but through the correct orchestrator entry point.
- Do not weaken `BuildSessionDirectReplyError`.

## Test Plan

- Extend `packages/overlay/test/agent-session-controls.test.ts` so
  `sendTaskOperatorMessage` posts to `/task/:taskID/message`.
- Add source-level assertions that `Card.tsx` and `ChatBubble.tsx` route build
  sessions to task operator guidance while preserving `replyToAgentSession`
  for non-build sessions.
- Keep backend direct-reply taxonomy tests unchanged so build direct reply
  remains rejected.
