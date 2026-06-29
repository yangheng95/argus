# Mission Session Agent Identity

Date: 2026-06-06

## Problem

Mission sessions can be resumed through the generic `session/:sessionID/prompt_async`
route from the panel composer. That route accepts `SessionPrompt.PromptInput` without a
required `agent`.

When `agent` is absent, `createUserMessage` falls back to the configured default agent.
In the observed incident the default agent was `coding`, so a `kind="mission"` session
received new user envelopes tagged `agent="coding"`. The session loop then loaded and
executed the coding agent tool surface inside the mission conversation.

This is not a Mission tool registry problem. Mission's static tool surface did not grant
`write`, `edit`, or `bash`. The execution identity was changed by a malformed continuation
message.

## Evidence

Observed database state:

| Session                          | Mission            | State                                                                                                  |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `ses_1685c9c58ffecDeMafFkgy5FjJ` | `3c7e280c3acc31bc` | Polluted: mission messages first, then coding user and assistant messages in the same mission session. |
| `ses_16790b0ddffegZkRomLK5OY77O` | `11a7dd0b0ec266ec` | Clean: only mission user and assistant messages.                                                       |

The polluted mission session contains coding tool calls including `write`, `edit`,
`bash`, browser tools, and `todowrite`. The user-visible card still rendered as Mission
because the transcript grouping uses the mission session/channel, while execution used
`Message.User.agent`.

## Call-Site Audit

| Surface                             | File                                                      | Current behavior                                                                                                 | Required behavior                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission wake                        | `packages/opencorvus/src/server/routes/mission.ts`        | Calls `SessionWake.wake({ agent: "mission" })`.                                                                  | Keep. This entry is already correct.                                                                                                           |
| Session wake                        | `packages/opencorvus/src/session/wake.ts`                 | Defaults missing wake agent to the configured default agent.                                                     | Keep for new generic sessions only; do not use it to infer continuation identity for existing mission sessions.                                |
| Shared session identity helper      | `packages/opencorvus/src/session/agent-identity.ts`       | Missing. Each caller could independently fall back to default agent.                                             | Single helper owns the agent-owned `SessionKind -> agent` mapping for append/continuation inputs.                                              |
| Generic prompt routes               | `packages/opencorvus/src/server/routes/session.ts`        | `prompt` and `prompt_async` pass request body through `applySessionPromptRouteOverlay`.                          | Normalize continuation identity at this boundary before enqueue or execute.                                                                    |
| Route overlay                       | `packages/opencorvus/src/server/routes/session.ts`        | Only overlays right-sidebar coding context.                                                                      | Extend the same input-construction layer to restore session-owned agent identity for mission continuations.                                    |
| Task queue                          | `packages/opencorvus/src/scheduler/task-queue-service.ts` | Direct queue callers can enqueue a prompt without `agent`.                                                       | Normalize queued and immediately executed prompt inputs before metadata persistence or execution.                                              |
| Session wake                        | `packages/opencorvus/src/session/wake.ts`                 | Existing session wake defaults missing agent to configured default agent.                                        | Existing agent-owned sessions use the session-owned identity before defaulting.                                                                |
| Retired TUI runtime                 | `packages/opencorvus/src/tui/runtime.ts`                  | Removed by `specs/records/2026-06/2026-06-10-tui-removal-plan.md`; no longer a current call site.                       | No current action. Preserve this row only as historical audit context.                                                                         |
| Direct reply / task message context | `packages/opencorvus/src/task-api/index.ts`               | Direct reply can preserve a polluted historical envelope.                                                        | Preserve the existing build-envelope refusal, then normalize agent-owned target sessions before writing a reply.                               |
| User message creation               | `packages/opencorvus/src/session/prompt/parts.ts`         | Missing `agent` becomes `Agent.defaultAgent`.                                                                    | Keep defaulting only for new generic direct prompts. Continuation inputs should arrive with an explicit agent.                                 |
| Session execution loop              | `packages/opencorvus/src/session/loop.ts`                 | Uses `lastUser.agent` as the execution identity and tool source.                                                 | Keep. This is the correct single execution source.                                                                                             |
| Runtime contract set                | `packages/opencorvus/src/session/loop.ts`                 | Protects stage agents, not mission.                                                                              | Do not add mission to the stage runtime contract set as a workaround. Mission is a primary session agent, not a stage worker runtime contract. |
| Panel composer                      | `packages/overlay/src/services/task.ts`                   | Selected session source posts to `session/:id/prompt_async` without `agent`.                                     | It may remain thin if the server normalizes identity. Optional client metadata must not be the authority.                                      |
| Direct agent reply                  | `packages/opencorvus/src/task-api/index.ts`               | Explicitly tags replies with the target prompt agent and documents that `Message.User.agent` controls execution. | Use this as the design precedent: continuation envelopes must preserve the target session agent.                                               |

## Design

The system needs one identity invariant:

> Every user message appended to an existing agent-owned session must carry the session's
> owned agent identity before it reaches `createUserMessage`.

For Mission, the owned identity is `mission`.

This is an input-construction fix, not a tool gate. The session loop should continue using
`Message.User.agent` as the execution source. Tool resolution should not inspect session
kind to deny specific tools after the wrong agent has already been selected.

### Server-Side Source of Truth

Add a server-side resolver for existing session prompt identity in the session layer:

```ts
type SessionPromptIdentity = {
  agent: string
  reason: "session-kind" | "request" | "default"
}
```

Resolution order:

1. For known primary owned session kinds where the kind is itself an agent name, set
   `agent = session.kind`.
2. Explicit request `agent` remains valid for generic sessions that are not owned by an
   agent kind.
3. For generic assistant/coding sessions, preserve the current explicit or default behavior.

This keeps Mission as a normal primary agent session. It does not add a denylist, an
allowlist, a user-interface-only rule, or a runtime-contract gate.

### Prompt Route Application

`prompt` and `prompt_async` must share the same normalization path:

1. Load the target session.
2. Apply existing sidebar overlay logic.
3. Resolve continuation agent identity from the loaded session and prompt body.
4. Pass the normalized prompt into `TaskQueueService.executePrompt` or
   `TaskQueueService.enqueuePrompt`.

The synchronous and asynchronous routes must not diverge.

### Client Contract

The overlay may keep posting to `session/:sessionID/prompt_async` for selected session
sources. The server is authoritative because the client cannot be trusted to know whether
the selected session is Mission, Explore, Coding, or a future primary agent session.

Client tests should assert that Mission selected-session input still reaches the canonical
session prompt route, but the identity regression must be covered on the server route.

## Tests

Required regression coverage:

| Layer            | Test                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Server route     | Posting to `POST /session/:missionSessionID/prompt_async` without `agent` enqueues a prompt whose normalized input has `agent: "mission"`. |
| Server route     | `POST /session/:missionSessionID/prompt` follows the same identity normalization as `prompt_async`.                                        |
| Task queue       | Direct `TaskQueueService.enqueuePrompt` and `executePrompt` calls normalize agent-owned sessions before metadata persistence or execution. |
| Session wake     | `SessionWake.wake()` on an existing mission session writes `agent: "mission"` even when the caller passes `agent: "coding"`.               |
| Direct reply     | Build-envelope refusal still happens before normalization; non-build polluted envelopes should not be propagated for agent-owned sessions. |
| Negative control | A normal coding/right-sidebar session still receives coding identity and project team tool overlays.                                       |

## Incident Cleanup

After the code fix lands, clean the observed incident separately:

1. Preserve the polluted session evidence until the regression test exists.
2. Inspect `D:\myhexin-local\demos\eco` dirty files against the polluted tool-call list.
3. Decide whether to discard, commit, or re-run those changes through the corrected Mission
   path. Do not bulk reset the repository.
4. Stop any stray development server only after confirming it is not user-owned work.

## Non-Goals

- Do not remove `write`, `edit`, or `bash` from the coding agent to make this symptom
  disappear.
- Do not add Mission to the stage runtime-contract-required set.
- Do not add front-end-only blocks or hidden message visibility flags.
- Do not create a second Mission reply endpoint if the canonical session prompt route can
  preserve identity correctly.
- Do not rewrite transcript rendering to hide the polluted messages; the transcript should
  make real message provenance visible.
