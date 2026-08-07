# Work Harness and Chat/Mission Infrastructure Convergence

Date: 2026-07-29

## Recall

### User requirements

- Refactor Work so it is based on the existing Chat and Mission systems and
  reuses their infrastructure.
- Keep the Work harness independent. Work must not become a Chat mode or lose
  its persisted product/runtime identity.
- Think through the ownership model before implementation.
- Perform the refactor in a new Git worktree.
- Ask Claude Code for an independent architecture proposal before
  implementation.

### Acceptance criteria

1. Work remains a fixed `work` primary-assistant identity with its own system
   prompt, default Skill and Model Context Protocol (MCP) assignments, tool
   policy, delivery policy, and persisted `experience="work"` identity.
2. Work continues to use the canonical Session, Message, streaming
   `SessionLoop`, Provider, permission, Skill loader, MCP resolver,
   `ToolRegistry`, `AttachmentStore`, Interactive Artifact, conversation
   lifecycle, Server-Sent Events (SSE), and Work Ledger implementations.
3. Durable Work orchestration continues through the real Mission session,
   Task, Goal, scheduler, cancellation, receipt, and project-archive paths.
   Work does not add a Task/Goal store, queue, state machine, hidden message,
   synthetic message, or host routing gate.
4. One explicit Work harness owner materializes the Work prompt, default
   capability assignment, Work-only tool policy, and parent-only delivery
   policy. The primary registry and shared runtime consume that owner instead
   of defining Work policy inline.
5. Chat and Work capability settings use one implementation with exact
   per-experience ownership. Work settings are readable and writable without
   mutating Chat settings.
6. Mission handoff transport carries the exact caller conversation experience
   from persisted server identity. The Overlay does not infer it from current
   local selection.
7. Work Ledger conversation rows represent the shared conversation family and
   retain exact `chat | work` experience identity.
8. Existing Work Office presentation production remains Work-harness-owned
   while continuing to use the shared Office process supervision, attachment,
   and Interactive Artifact infrastructure.
9. Focused non-UI contract tests cover harness ownership, capability isolation,
   handoff lineage, receipt participation, cancellation/archive behavior, and
   Work Office visibility. No UI automated test is added, modified, updated, or
   run.
10. The changed Overlay surfaces are exercised on a real isolated page and
    inspected through goal/region-bound screenshots. Typecheck, API route,
    generated OpenAPI/Software Development Kit (SDK), internationalization,
    document-health, and diff checks pass.
11. The implementation is committed with a `dsw-33987` subject, merged back to
    the `v0.0.24beta` delivery branch, and pushed to the git-cc `myhexin`
    remote without disturbing concurrent changes.

### Hard constraints

- Preserve every staged, unstaged, and untracked change in the original
  `/Users/yangheng/Desktop/opencorvus` worktree.
- The authorized implementation worktree is
  `/Users/yangheng/Desktop/opencorvus-work-harness-refactor` on
  `codex/work-harness-refactor`, based exactly on
  `myhexin/v0.0.24beta@a2d0654a72545176713af6b1e9ff5cdc6c1f933f`.
- Do not restart, refresh, terminate, or otherwise alter the user's running
  OpenCorvus or Overlay process.
- Do not add fallback behavior, compatibility aliases, dual writes, a generic
  base-harness framework, a Work `SessionLoop`, Work Task/Goal persistence, a
  Work scheduler, a Work artifact store, a workflow state machine, or a host
  gate.
- Work remains an independent harness. Reusing infrastructure does not mean
  sharing Chat's prompt, capability assignment, tool policy, or product
  identity.
- All conversation and Mission participants/messages remain real and visible.
- UI acceptance is manual real-page interaction and screenshot inspection
  only. UI automated tests are out of scope and prohibited.

### Sources read

- Root `AGENTS.md`.
- `specs/current/architecture/08-agent-tool-adapter.md`.
- `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-28-work-conversation-experience.md`.
- `specs/records/2026-07/2026-07-29-conversation-backed-work-office-capability.md`.
- Agent runtime ownership:
  `agent/{primary-assistant-registry,role-contract,tool-pool-data,session-agent-runtime}.ts`.
- Conversation ownership:
  `chat/{identity,session,capability,handoff,global-chat-service}.ts` and
  `server/routes/{right-sidebar-conversation,coding,chat,global}.ts`.
- Shared execution:
  `session/{loop,message-identity,wake}.ts`.
- Mission ownership:
  `mission/{session,caller-participant,caller-receipt}.ts`,
  `server/routes/mission.ts`, and the `panel.wake_mission` implementation.
- Work delivery:
  `tool/{delegate-agent,work-office-presentation,tool-id-catalog}.ts` and
  `work-office/presentation.ts`.
- Transport and Overlay:
  `work-ledger/projection.ts`, `transport-protocol/src/index.ts`,
  `overlay/services/{conversation-session,mission,work-ledger,chat-capability}.ts`,
  `overlay/components/{WorkLedger,ConfigDialogHost}.tsx`, and
  `overlay/main.tsx`.

### Whole-repository search

The implementation plan follows a repository-wide inventory of these symbols:

```text
primary_assistant_capabilities
ChatCapability
ConversationExperience
RIGHT_SIDEBAR_*
RightSidebarConversation*
wake_work
wake_mission
MissionHandoff*
callerExperience
WorkLedgerChatRow
kind: "chat"
WORK_OFFICE_TOOL_IDS
work_office_*
agentID === "chat" | "work"
```

The inventory produced 344 matches in 47 production files. Their dispositions
are grouped below; generated SDK/OpenAPI occurrences are regenerated rather
than edited.

| Owner/callers                                                                                                       | Disposition                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/primary-assistant-registry.ts`                                                                               | Keep the fixed `work` identity; consume the prompt and defaults from the Work harness owner instead of defining Work policy inline.                                                    |
| `agent/role-contract.ts`, `session-agent-runtime.ts`, `message-identity.ts`                                         | Preserve the existing fixed identity and shared runtime snapshot/identity resolution.                                                                                                  |
| `agent/tool-pool-data.ts`, `tool/tool-id-catalog.ts`, `tool/delegate-agent.ts`                                      | Keep the shared pool/registry mechanisms; source Work-only and parent-only tool policy from the Work harness owner.                                                                    |
| `chat/identity.ts`, `chat/session.ts`, `server/routes/right-sidebar-conversation.ts`, `chat/global-chat-service.ts` | Preserve the existing parameterized conversation infrastructure. This task does not move directories merely to rename ownership.                                                       |
| `chat/capability.ts`, `chat/capability-transaction.ts`, config validation/removal callers                           | Generalize the implementation to exact Chat/Work experience inputs while keeping one catalog lock and one resolver. Move default Work assignment ownership to the Work harness.        |
| `server/routes/chat.ts`, `server/routes/coding.ts`                                                                  | Replace the Chat-only capability route with one parameterized capability route family mounted for both Chat and Work. Do not duplicate handler bodies or retain a compatibility alias. |
| `session/loop.ts`                                                                                                   | Preserve the sole streaming loop. Replace inline Chat/Work capability branching with the shared conversation-capability classifier; do not add a harness loop.                         |
| `session/wake.ts`, automation callers                                                                               | Replace the Chat-specific new-session profile input with an exact conversation experience input.                                                                                       |
| `tool/panel.ts`, `panel/capability.ts`, `chat/handoff.ts`                                                           | Keep real Chat-to-Work and conversation-to-Mission handoffs. Reject Work-to-Work wake, use shared caller attachment helpers, and retain exact visible messages.                        |
| `mission/session.ts`, `caller-participant.ts`, `caller-receipt.ts`, `server/routes/mission.ts`                      | Preserve Mission ownership. Add exact caller experience to the existing handoff event/projection; do not add a Work-specific Mission path.                                             |
| `tool/work-office-presentation.ts`, `work-office/presentation.ts`                                                   | Keep typed Work tools and shared Office runtime. Move policy declarations to Work harness ownership without copying process/attachment/artifact infrastructure.                        |
| `work-ledger/projection.ts`, `server/routes/work-ledger.ts`, transport protocol                                     | Preserve the existing shared conversation row discriminator and exact `experience`; add `callerExperience` to Mission handoff transport.                                               |
| Overlay conversation/mission/work-ledger services and `main.tsx`                                                    | Consume server-owned caller experience and parameterized conversation capability routes. Preserve one store, hydration path, archive path, and SSE stream.                             |
| Overlay capability Settings surface                                                                                 | Present the exact active conversation harness assignment through the existing settings primitives; no second resource manager or local config state.                                   |
| Generated OpenAPI, SDK, and API docs                                                                                | Regenerate from route/schema sources after the direct contract replacement.                                                                                                            |

### Claude Code review

Claude Code completed a read-only repository review before this plan. It
confirmed that Work already correctly reuses Session/Message/SessionLoop,
Provider/permission, conversation lifecycle, AttachmentStore, Interactive
Artifact, Mission Task/Goal/scheduler, and Mission receipt infrastructure. It
identified the missing Work capability API, the misleading `ChatCapability`
ownership, inline Chat/Work branching in SessionLoop, Work-to-Work wake, the
client-derived Mission caller experience, and the absence of one explicit Work
harness materialization owner.

This plan accepts those behavioral findings but narrows the proposed structural
change: it does not perform a broad `chat/` to `conversation/` directory move,
because the current parameterized infrastructure already has one implementation
and moving every import would add risk without changing ownership behavior.

### Codex second review refinement

After tracing the Work Ledger renderers, the `kind: "chat"` value was confirmed
to be an internal shared-row discriminator; user-visible identity already comes
from the exact `experience: "chat" | "work"` field. Renaming that discriminator
would touch transport, projection, command palette, ledger actions, and Overlay
unions without changing harness ownership or visible semantics. This task
therefore preserves it and changes only the defective Mission handoff
provenance. The plan's original row-kind replacement is explicitly withdrawn.

The final independent diff review found one API precision regression: both
capability routes initially referenced a shared response schema whose
`agent_id` was `"chat" | "work"`. The implementation was revised so the shared
schema factory emits exact `ChatCapabilitySettings` and
`WorkCapabilitySettings` route contracts, with OpenAPI tests asserting the
literal identity. A second Claude Code review was attempted but could not start
because the account had reached its monthly usage limit; the earlier Claude
architecture review remains the Claude input used by this record.

## Decision

### One explicit Work harness owner

Add a small Work-owned module that exports:

- the code-owned Work runtime prompt;
- the immutable default Work Skill/MCP assignment;
- the Work-only Office tool IDs;
- the parent-only Work delivery tool IDs; and
- Work handoff policy text consumed by the existing primary-assistant and
  delegation materializers.

This is not a `BaseHarness`, registry, loop, or engine. It is the single policy
owner consumed by the existing generic runtime.

### One conversation capability implementation

Replace `ChatCapability` with a conversation capability implementation
parameterized by exact `chat | work` identity:

- one assignment schema;
- one project catalog lock;
- one Skill/MCP validation path;
- one Skill surface resolver;
- one runtime MCP resolver;
- one settings projection;
- one atomic update path.

Chat and Work supply different default assignment data. Their public API paths
are exact thin mounts of the same route builder. Updating Work can never mutate
Chat and vice versa.

### Mission remains the durable orchestration owner

Work decides through its own prompt whether a request stays in the Work
conversation or is offered to Mission. A confirmed handoff uses the existing
real Mission session, caller attachment replay, Mission wake, Mission Tasks and
Goals, status/cancellation, visible handoff event, and terminal receipt. Work
stores no Mission state and receives no hidden execution channel.

The handoff event itself carries the caller's persisted conversation
experience. The Overlay verifies the currently selected caller against that
server fact before activating Mission and archiving the caller.

### Work Ledger represents conversations honestly

Chat and Work remain one conversation row family with an exact experience
discriminator. The family is named `conversation`, not `chat`, because Work is
not Chat mode. Mission and Task rows remain unchanged.

## Data flow

### Direct Work

```text
Overlay Work submit
  -> shared conversation create/claim route with experience=work
  -> assistant Session metadata.conversation.experience=work
  -> shared SessionWake / SessionPrompt / SessionLoop
  -> PrimaryAssistantRegistry materializes work runtime from Work harness policy
  -> shared Skill/MCP/ToolRegistry/permission execution
  -> shared AttachmentStore and Interactive Artifact persistence
  -> shared conversation hydration/SSE/abort/archive/Work Ledger projection
```

### Work to Mission

```text
Work assistant calls panel.wake_mission
  -> visible operator confirmation
  -> existing Mission session + persisted caller session/message lineage
  -> exact caller model + real attachment replay
  -> Mission SessionWake and visible mission.handoff event
  -> existing Mission Task/Goal/scheduler/cancellation/project archive
  -> Overlay hydrates Mission, then archives the exact Work caller
  -> terminal Mission writes one visible receipt participant message to Work
```

There is no Work-owned Task, Goal, scheduler, receipt, archive, or artifact
projection in either path.

## Implementation stages

1. Materialize Work harness policy and make the primary registry/tool pool/
   delegation paths consume it.
2. Generalize capability ownership and expose exact Chat and Work settings
   routes with isolation tests.
3. Replace inline conversation capability checks in SessionLoop and the
   Chat-specific SessionWake profile input.
4. Make Mission caller experience server-owned and reject Work-to-Work wake.
5. Preserve the shared Work Ledger conversation row and add server-owned
   Mission caller experience through transport and Overlay.
6. Update the existing capability Settings surface without adding another
   resource store or UI test.
7. Regenerate API/SDK/docs and complete focused and broad verification.

Each stage replaces its old source in the same change. No compatibility alias,
dual route, dual schema, or dual policy source remains after a stage.

## Verification

### Non-UI contracts

- Primary registry resolves `work` from Work harness policy and keeps its prompt
  non-editable.
- Work-only Office tools are absent from Chat/Coding/Mission/projected workers
  and final delivery is absent from delegated Work children.
- Chat/Work capability reads and writes are isolated, validate missing Skill
  and MCP references, and resolve exact runtime surfaces.
- SessionLoop uses one conversation capability resolver for both identities.
- Chat can wake Work; Work cannot wake Work; Chat and Work can wake Mission.
- Mission handoff carries exact persisted caller experience through Bus,
  transport, and Overlay service validation.
- Mission receipt participant identity remains exact for Chat and Work callers.
- Conversation Work Ledger rows retain exact experience, pagination, archive,
  and status semantics.
- Existing Work Office author/validate/deliver, process supervision, attachment,
  and Interactive Artifact tests remain green.

### UI acceptance

No UI automated test is added, modified, updated, or run. On an isolated real
page:

1. inspect Chat and Work capability assignments and confirm they are distinct;
2. mutate a Work assignment and confirm Chat remains unchanged;
3. create and reopen a Work conversation;
4. exercise Chat-to-Work and Work-to-Mission confirmation/hydration/archive;
5. inspect the terminal Mission receipt in the Work conversation;
6. inspect Chat and Work rows in the Work Ledger; and
7. produce and inspect a Work PPTX attachment and presentation artifact.

Capture and personally inspect screenshots bound to the changed settings,
conversation, and Work Ledger regions.

### Repository checks

- Focused non-UI suites for agent, capability, session, panel, Mission,
  Work Ledger, transport, and Work Office.
- OpenCorvus and Overlay typechecks.
- `bun run api:routes-check`.
- generated OpenAPI/SDK checks and API docs regeneration.
- `bun run overlay:i18n-check`.
- historical-document, document-health, and product-doc single-source checks.
- `bun run docs:check`.
- `git diff --check`.
- normal commit and push hooks.

## Risks

- Capability route/schema replacement changes generated SDK names and must land
  atomically with Overlay service updates.
- Mission caller experience spans backend event, transport, and Overlay
  selection checks and must land atomically.
- The original worktree contains concurrent changes to Overlay settings,
  Work Ledger, SDK/OpenAPI, API docs, and spec indexes. The isolated branch must
  be merged back by composing with those current bytes, never by replacing or
  restoring them.
- Removing redundant Office authorization checks is deferred unless tool-pool
  tests prove exact visibility and delegated-child exclusion. The implementation
  must not weaken irreversible resource ownership validation.

## Scope judgment

The runtime concept is small: no new execution engine or persistence model is
required. The contract surface is medium-sized because the current Work harness
policy is distributed and the capability/transport names are public. The work
is therefore a focused ownership refactor with API and projection consequences,
not a one-file patch and not a platform rewrite.
