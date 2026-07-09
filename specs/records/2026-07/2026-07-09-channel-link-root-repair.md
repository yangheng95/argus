# Channel Link Root Repair - 2026-07-09

## Recall

User request: use independent agents to investigate the OpenCorvus channel chain, repair the issues found, and keep iterating until no new channel-chain issue is found.

Acceptance criteria:

1. A first message from a configured channel that creates a task must persist `engine_channel_binding` from server-derived channel context even when the control LLM omits `platform`, `channel`, or `thread` tool parameters.
2. If a model-supplied `panel.create_task` channel identity conflicts with the server-derived channel context, task creation must fail before `EngineService.createTask`.
3. Partial model-supplied channel identity for `panel.create_task` must fail before task creation instead of silently creating an unbound task.
4. Existing bound channel follow-up routing through `ChannelIngress.findBinding` must remain intact.
5. Pending interaction replies resolved inside `ChannelIngress.message` must remain deterministic and must not depend on the control LLM.
6. Current configured channels must stay on protocol 1: `ChannelRuntime` delivers adapter messages through `client.channel.message`, while legacy `task_report` is not treated as the configured-channel standby path.
7. Attachment forwarding through channel/control/panel must remain strict: data URL inputs are decoded and forwarded, non-data URLs are rejected.
8. Focused tests must prove the channel-binding repair and existing attachment/binding behavior.

Hard constraints:

- No fallback, compatibility branch, or second source for channel identity.
- No gate or host-side bypass that teaches the model a route while leaving the underlying channel identity leak intact.
- No destructive git operation and no worktree creation.
- Preserve unrelated dirty overlay/spec changes already present in the workspace.

Read before implementation:

- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/03-control.md`
- `specs/records/2026-06/2026-06-17-channel-runtime-fail-fast-config-and-uploads.md`
- `specs/records/2026-06/2026-06-12-standalone-session-bridge-channel-contract.md`
- `specs/records/2026-06/remove-global-project-sentinel-2026-06-16.md`
- `packages/opencorvus/src/channel/ingress.ts`
- `packages/opencorvus/src/control/message.ts`
- `packages/opencorvus/src/control/message-schema.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/panel/capability.ts`
- Existing channel/panel tests under `packages/opencorvus/test/channel`, `packages/opencorvus/test/gateway`, `packages/opencorvus/test/tool`, and `packages/opencorvus/test/panel`.

Whole-repo grep evidence:

- `rg "ChannelIngress|ControlMessageInput|ChannelRuntime|OPENCORVUS_CHANNEL_PROTOCOL|client.channel.message|task_report"` shows configured channels start through `ChannelSupervisor` with `OPENCORVUS_CHANNEL_PROTOCOL="1"` and route runtime messages into `client.channel.message`; `task_report` remains in `packages/channel-runtime` but is not the configured-channel task wake path.
- `rg "channelBinding|engine_channel_binding|existingTaskByChannelBinding|bindThread"` shows durable binding is written from `EngineService.createTask` input through `engine/pipeline.ts` into `engine_channel_binding`, and lookup/conflict checks live in `task-api/index.ts` plus `ChannelIngress.findBinding`.
- `rg "create_task|platform|channel|thread" packages/opencorvus/src/control packages/opencorvus/src/tool packages/opencorvus/src/panel` shows `ChannelIngress` passes channel/thread into `ControlMessageInput`, but current `ControlMessage.run` does not place a server-derived binding object in tool `extra`; current `panel.create_task` writes binding only when the LLM supplies all three `platform/channel/thread` params.

Independent agents:

- Sagan: ingress and binding reliability audit. Pending at implementation start.
- Euler: protocol 1 channel-runtime vs legacy task-report audit. Pending at implementation start.
- Hubble: tests, capability contract, and permission-reply audit. Pending at implementation start.

## Root Cause

`ChannelIngress.message` already knows the authoritative channel identity: `platform`, `channel`, and `thread`. It passes those fields into `ControlMessage.handle`, but `ControlMessage.run` only exposes them to the LLM inside a JSON user part. The panel tool context receives `surface`, `source`, `requestID`, `originalText`, and attachments, but no server-owned channel identity.

`panel.create_task` therefore persists `channelBinding` only when the model includes `platform`, `channel`, and `thread` in its tool call. The first channel message can create a valid task with no durable `engine_channel_binding`; later messages from the same channel thread cannot find the task.

The repair is to carry the server-owned channel identity in tool context and make `panel.create_task` resolve binding identity from that single source. Model-supplied binding parameters are accepted only when they match the server context exactly, or when no server context exists and all three explicit fields are present.

## Implementation Plan

1. Add a strict server-channel-binding helper in `ControlMessage.run` that emits `extra.channelBinding` only when `surface` is a real `ChannelId` and both `channel` and `thread` are present.
2. Add a `panel.create_task` binding resolver that:
   - validates `extra.channelBinding`,
   - rejects partial model-supplied binding parameters,
   - rejects conflicts between server context and model parameters,
   - returns the server context when present,
   - preserves explicit complete binding only for callers without server channel context.
3. Derive channel task `source` from the resolved binding rather than from a lone `params.platform`.
4. Add focused tests for server-derived binding, conflict rejection, partial-identity rejection, and explicit complete binding behavior.
5. Run focused tests, then inspect diffs and agent feedback for any new channel-chain issues.
