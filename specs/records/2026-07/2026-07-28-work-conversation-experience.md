# 2026-07-28 Work Conversation Experience

## Recall

### User requirement

- Reuse the existing Chat route as a distinct Work experience.
- Keep the implementation difference limited to the runtime prompt.
- Make Work use Interactive Artifacts more often.
- Give Work its own icon and complete visible identity system.
- Investigate the current OpenAI Work product and borrow its proven interaction
  and deliverable model deeply instead of inventing a parallel workflow.

### Acceptance criteria

1. Chat and Work use one project-bound streaming conversation implementation
   for create, list, claim, rename, archive, restore, abort, task selection,
   prompting, transcript hydration, child-agent activity, and Interactive
   Artifact replay.
2. A persisted conversation experience selects exactly one native primary
   assistant identity: `chat` or `work`. The identity cannot be inferred from a
   title, route label, or client-local state.
3. Work differs from Chat only through its code-owned runtime prompt. Tool
   assignment, project Skill assignment, Model Context Protocol (MCP) server
   assignment, permissions, session kind, message protocol, attachment
   protocol, child-agent protocol, and artifact protocol remain shared.
4. Work's prompt reflects the current official product model: longer
   multi-step work; outcome-first planning; project, file, connected-source and
   web context; visible progress; user questions and steering; review-ready
   documents, spreadsheets, presentations, dashboards, reports, Sites and
   other finished deliverables.
5. Work prefers `publish_interactive_artifact` whenever a native renderer
   materially improves inspection or follow-up. It still uses ordinary text
   for short explanations and never fabricates an artifact, app, browser
   target, external source, or completed deliverable.
6. The Overlay presents Chat and Work as two modes of the same conversation
   surface, records the chosen mode durably, opens either kind from the shared
   Work Ledger, and keeps the selected mode after hydration and replay.
7. Work has one dedicated icon identity reused consistently by the Composer
   selector, conversation title, Work Ledger row, empty/new state, and archived
   conversation surface. Chat retains its existing icon. Neither identity is
   inferred from display text.
8. Focused backend and Overlay tests cover both experiences, prompt isolation,
   route ownership, list separation or filtering, abort/archive/delete safety,
   task selection, canonical message flow, and durable Interactive Artifact
   replay.
9. A Node-launched Playwright run against an isolated real Vite page exercises
   the Work selector, new Work submission, Work replay, and an Interactive
   Artifact in the conversation, then produces a goal/region-bound screenshot
   that is personally inspected and corrected.
10. Generated OpenAPI and Software Development Kit (SDK) artifacts, relevant
    typechecks, route checks, internationalization checks, document-health
    checks, `git diff --check`, normal hooks, and a second code/visual review
    pass.
11. Only task-owned files and exact task-owned hunks are committed. The commit
    subject starts with `dsw-33987` and the result is pushed to
    `legacy-remote/v0.0.21beta`.

### Hard constraints

- Preserve all unrelated staged, unstaged and untracked work. Do not stash,
  reset, restore, broadly stage, delete, or create a new worktree.
- Do not restart, refresh, close, kill, or otherwise interfere with the user's
  running OpenCorvus or Overlay process. Use isolated server/Vite processes.
- Playwright runs through Node.js, never Bun.
- Do not create a Work task engine, state machine, workflow gate, synthetic
  message, client-only session mode, duplicate transcript store, duplicate
  Interactive Artifact payload source, or fallback identity inference.
- Chat and Work remain project-bound assistant conversations. Mission remains
  the durable task/goal orchestration authority.
- The Session/Message-owned `interactive_artifact` row and session-scoped
  artifact route remain the only payload and replay source.
- Work may encourage complete artifact deliverables, but the prompt must still
  choose text when an artifact would not materially help.
- Every abbreviation introduced by this change is expanded in a nearby comment
  or prose definition.

### Sources read

- Root `AGENTS.md`.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-19-inline-interactive-artifact-protocol.md`.
- `specs/records/2026-07/2026-07-25-interactive-artifact-comprehensive-catalog.md`.
- Current OpenAI Codex manual, especially Execution Model and Workflows,
  prompting, sub-agent visibility, steering and queuing.
- OpenAI Help, **ChatGPT Work and Codex**, updated 2026-07-26:
  <https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex>.
- OpenAI ChatGPT release notes, **Introducing ChatGPT Work**, 2026-07-09:
  <https://help.openai.com/en/articles/6825453-chatgpt-release-notes>.
- OpenAI Academy, **How to use ChatGPT Work for everyday tasks**, 2026-04-23:
  <https://openai.com/academy/how-to-use-chatgpt-work-for-everyday-tasks/>.
- `packages/opencorvus/src/chat/{session,capability,global-chat-service}.ts`.
- `packages/opencorvus/src/server/routes/{coding,chat,global,session,work-ledger}.ts`.
- `packages/opencorvus/src/agent/{role-contract,primary-assistant-registry,tool-pool-data,persisted-session-identity}.ts`.
- `packages/opencorvus/src/prompt/fragments/interactive-artifact-guidance.ts`.
- `packages/opencorvus/src/interactive-artifact/**`.
- `packages/overlay/src/services/{coding-assistant,chat,conversation,interactive-artifact,work-ledger}.ts`.
- `packages/overlay/src/store/{board,coding-assistant}.ts`.
- `packages/overlay/src/components/{App,ChatComposer,Conversation,WorkLedger}.tsx`.
- `packages/overlay/src/main.tsx`.

### Whole-repository search evidence

The plan was written after these repository-wide inventories:

```text
rg -n "createRightSidebarChatSession|listRightSidebarChatSessions|assertRightSidebarChatSession|applyRightSidebarChatPromptOverlay|rightSidebarChatAgentID|isRightSidebarChatSession" packages
rg -n "RIGHT_SIDEBAR_CHAT|right-sidebar|coding-assistant|ComposerMode|launcherMode" packages specs/current
rg -n "PrimaryAssistantID|AgentRoleID|controlSurface|roleAssignments|primary_assistant_capabilities" packages
rg -n "/coding/session|/coding/sessions|/global/chat|/chat/capability" packages
rg -n "interactive_artifact|interactive-artifact|publish_interactive_artifact" packages specs/current
rg -n "WorkLedgerChatRow|kind: \"chat\"|selectedSource|sessionKind" packages
```

Findings and disposition:

| Owner / caller                                               | Current responsibility                                              | Work disposition                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat/session.ts`                                            | Chat metadata identity, create/list, selected task, prompt overlay  | Replace the Chat-specific internal duplication with one strict conversation-experience abstraction; keep named Chat wrappers only where they remain the public Chat contract and add exact Work wrappers. |
| `server/routes/coding.ts`                                    | Project Chat lifecycle routes                                       | Extract one lifecycle route builder and mount exact Chat and Work route families; no duplicate handler bodies.                                                                                            |
| `server/routes/global.ts` / `global-chat-service.ts`         | Anonymous-project Chat creation                                     | Share one anonymous-project conversation creator and add an exact Work entry point.                                                                                                                       |
| `server/routes/session.ts`                                   | Canonical prompt and transcript routes                              | Select Chat or Work from persisted metadata, apply the exact prompt overlay, and keep all canonical message/history routes unchanged.                                                                     |
| `persisted-session-identity.ts` and protocol bridge          | Durable root-agent attribution                                      | Resolve the exact persisted conversation experience; no title or route inference.                                                                                                                         |
| Mission caller receipt/participant, `panel.ts`, task creator | Chat-owned Mission handoff and task provenance                      | Preserve current Chat semantics. Work reuses the same right-sidebar conversation actor contract where the operation is genuinely shared; rename internal predicates to represent that broader contract.   |
| `role-contract.ts`, primary registry, tool pool              | Native agent identity, prompt, tools and permission materialization | Add `work`; derive its definition, tool pool and permission from Chat, changing only the prompt. Work consumes the same Chat capability assignment.                                                       |
| `chat/capability.ts` and `/chat/capability`                  | Project Skill and MCP assignment for Chat                           | Remain the single shared assignment source. Do not add `/work/capability` or a second config object.                                                                                                      |
| `work-ledger/projection.ts` and transport schema             | Shared recent conversation row                                      | Keep one conversation row family and persist an explicit `experience` discriminator so Chat and Work appear together without losing identity.                                                             |
| Overlay coding-assistant service/store                       | Chat create/list/select/archive lifecycle                           | Generalize names and request paths around conversation experience; do not introduce a second store or transcript.                                                                                         |
| Overlay board source                                         | Session surface identity                                            | Replace the coding-assistant-only tag with an exact Chat/Work conversation experience.                                                                                                                    |
| Composer and `main.tsx`                                      | Chat/Mission mode selection and new-session submission              | Add Work beside Chat through the existing mature selector primitives; route a new Work through the same composer and conversation surface.                                                                |
| `InteractiveArtifactPart` and artifact service               | Session-scoped renderer loading and replay                          | No production change expected. Add Work route/replay coverage proving reuse.                                                                                                                              |
| Generated OpenAPI/SDK                                        | Repeats route and schema contracts                                  | Regenerate from the route/schema source; never hand edit.                                                                                                                                                 |

### Official Work behavior translated into OpenCorvus

| Official behavior                                                                            | OpenCorvus implementation                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work is for longer multi-step work and finished deliverables.                                | A Work-only prompt frames the desired outcome, context, output format, boundaries, review criteria and follow-up refinement.                                                                  |
| Work can research and analyze across files, projects, apps and the web.                      | Reuse Chat attachments, project directory, Skill, MCP, browser/web and file tools. The prompt names these sources but does not invent availability.                                           |
| Work creates documents, spreadsheets, presentations, reports and Sites.                      | Prefer the existing native Interactive Artifact catalog for inspectable deliverables and use MCP Apps or Browser Preview only through their real canonical contracts.                         |
| Users can follow progress, answer questions, change direction and approve important actions. | Reuse streaming messages, todos, child-agent cards, `question`, permissions, steering-compatible session prompts and exact cancellation ownership.                                            |
| Chat and Work appear together in Recents with their experience retained.                     | Keep one Work Ledger conversation family with an explicit persisted experience and mode-aware label/filter hooks.                                                                             |
| Work may use sub-agents for independent work.                                                | Reuse Chat's `delegate_agent` contract. The prompt delegates only when parallel work materially helps, keeps the main thread focused on decisions and deliverables, and consolidates results. |

### Independent agent feedback

None. The user did not request delegated or parallel agents, and the active
collaboration rule prohibits unsolicited delegation.

### Git and shared-worktree baseline

- Branch: `v0.0.21beta`.
- Baseline `HEAD`: `4ca7e81b2f44b8455d6410b5daf2e8068ab2948b`.
- Baseline was equal to `legacy-remote/v0.0.21beta` (`0 0`).
- Existing unrelated edits:
  `specs/README.md`, `specs/records/2026-07/README.md`, and untracked
  `specs/records/2026-07/2026-07-28-conversational-expert-squad-runtime-authoring-repair.md`.
  This task appends only its own index entries and will preserve the concurrent
  content.

## Design

### One conversation route family

Introduce one internal `ConversationExperience` contract with the literal
identities `chat` and `work`. It owns:

- durable metadata parsing;
- root-agent identity;
- lifecycle route construction;
- new-session creation and list filtering;
- task selection;
- prompt overlay metadata;
- Work Ledger projection.

Public Chat and Work route names remain explicit because they are user-facing
contracts. Their handlers call the same implementation with one literal
experience value. Session prompt and transcript routes remain canonical and are
not copied.

### Prompt-only specialization

The `work` primary assistant is materialized from the exact same base definition,
permission profile, tool-pool assignment, configured model/options and Chat
capability assignment as `chat`. The only replaced property is `prompt`.

The Work prompt:

1. starts from the requested outcome;
2. gathers only relevant project, file, attachment, web, Skill and MCP context;
3. states a compact plan in visible progress for longer work;
4. asks focused questions only when the missing choice would materially change
   the deliverable;
5. uses sub-agents for independent research or production when useful;
6. produces a first usable, review-ready deliverable;
7. publishes a native Interactive Artifact when the deliverable maps to the
   strict catalog and interaction materially aids review;
8. checks evidence, completeness, unresolved assumptions and requested
   boundaries before finishing;
9. supports follow-up refinement without restarting or duplicating the
   artifact source.

### Overlay

The existing Composer intent selector gains Work as a peer of Chat. It uses the
same Button/Menu primitives, composer, attachments, model selection, transcript,
child-agent rail, Work Ledger and Right Dock. One Icon-registry-owned `work`
glyph and one experience-to-identity projection provide its label, glyph and
accessible name across every surface; components do not duplicate their own
Work SVG or string heuristics.

Selecting or hydrating a persisted Work session sets the visible mode to Work.
The Work Ledger shows the exact experience label while retaining one
conversation row structure. No additional titlebar, pane, iframe or client-only
state is introduced.

## Execution plan

1. Add the strict conversation-experience metadata and refactor backend Chat
   session lifecycle callers onto it.
2. Add the `work` prompt identity while deriving every non-prompt runtime
   property from Chat.
3. Mount explicit project and global Work creation/lifecycle routes and keep
   canonical session message/history routes shared.
4. Extend the Work Ledger transport projection with the exact experience.
5. Generalize the Overlay conversation service/store/source identity, add Work
   selection and submission, and localize the labels.
6. Add backend, Overlay and prompt tests for identity, route parity, prompt-only
   difference and artifact replay.
7. Run an isolated Node/Vite/Playwright visual flow and inspect the screenshot.
8. Regenerate API/SDK artifacts, run focused and repository checks, perform a
   second review, commit exact task-owned paths and push through normal hooks.

## Validation

- Backend conversation, prompt, Work Ledger, caller provenance, and session
  regression suites pass, including strict Chat/Work identity separation.
- Overlay Work identity, shared conversation service, command routing, and
  Chat-to-Work handoff suites pass.
- The Node-launched Playwright acceptance opens the real Vite UI, selects Work,
  verifies the enabled Work composer and left-Dock `New Work` entry, and records
  `.scratch/work-conversation-identity/composer-and-left-dock.png`.
- Root TypeScript typecheck, API route inventory, Overlay localization, release
  version alignment, generated SDK/OpenAPI contract checks, and API
  documentation checks pass. Work's tracked record and indexes pass the
  historical-document checks.
- The full Overlay unit runner currently reaches an unrelated concurrent
  workspace failure in `left-work-ledger-shell.test.ts`: the test still expects
  the former rounded workspace corner while the uncommitted parallel visual
  system changes set that corner to zero. Work-owned suites pass independently;
  this task does not rewrite the concurrent visual contract.
- The workspace-wide document-health runner is likewise blocked only because a
  concurrent, untracked `empty-home-platform-task-examples` record is already
  linked from the shared monthly index. This Work record is tracked and resolves
  correctly; this task does not stage that other record.

## 2026-07-28 Chat handoff convergence

### Recall

#### Added user requirement

- Chat can route a request to a newly created Work conversation so Work can
  produce the artifact deliverable.
- Whenever Coding/Chat routes to either a new Mission or a new Work
  conversation, the Overlay must first activate and hydrate that exact target,
  then archive the source Chat.

#### Added acceptance criteria

1. `panel.wake_work` is a real right-sidebar conversation action, not a
   client-only mode switch. It asks for operator confirmation, creates one
   persisted Work session, carries the complete user request and canonical
   attachments into its first normal message, and starts the native Work agent.
2. Mission and Work creation publish typed handoff events only after the target
   wake message is durable. Each event identifies the exact caller session,
   caller message, target session, target directory, and target kind.
3. The Overlay acts only when the currently selected conversation is the exact
   caller. It hydrates the exact new Mission or Work target before requesting
   archival of the caller.
4. A declined recommendation or failed target wake neither publishes a
   handoff nor archives the caller. A target hydration failure also leaves the
   caller unarchived.
5. Tests cover creation, failure/decline, event projection, exact-caller
   selection, target-before-archive ordering, and a Node-launched Playwright
   view of the visible transition.

#### Added hard constraints

- The handoff is one backend lineage event and one frontend activation path;
  no hidden message, synthetic transcript row, local signal, fallback route,
  workflow gate, or state machine is introduced.
- Archival is never used to conceal an incomplete stop. The canonical archive
  route must settle the source prompt before it records `time.archived`.
- Target creation and wake remain backend-owned; the Overlay cannot fabricate
  a Work or Mission identity from a title.

#### Added whole-repository search evidence

The implementation was preceded by:

```text
rg -n "wake_mission|attachMissionCaller|publishMissionHandoff|mission.handoff|work-ledger.mission-handoff" packages
rg -n "createRightSidebarConversationSession|SessionWake|prompt_async|rightSidebarConversationExperience" packages
rg -n "activeMissionHandoff|openMissionSession|selectConversationSession|setConversationSessionArchived" packages/overlay
rg -n "WorkLedgerMissionHandoffEvent|WorkLedgerEvent" packages
```

| Call site                                  | Disposition                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `panel/capability.ts`                      | Keep `wake_mission`; add the peer `wake_work` mutation on the same right-sidebar surface.                                         |
| `tool/panel.ts`                            | Reuse caller-message and canonical attachment materialization; create and wake the exact target before publishing either handoff. |
| `mission/caller-receipt.ts`                | Keep Mission caller/receipt ownership and its post-wake handoff event.                                                            |
| `chat/session.ts`                          | Reuse the canonical persisted Work session constructor and strict experience identity.                                            |
| `chat/handoff.ts`                          | Own the typed Chat/Work caller-to-target event; do not duplicate transcript or session storage.                                   |
| `server/routes/work-ledger.ts`             | Project both backend handoff events into the one Work Ledger event stream.                                                        |
| `transport-protocol`                       | Keep actionable handoff branches in the canonical discriminated union.                                                            |
| `overlay/services/mission.ts`              | Resolve Mission handoffs only for the exact selected caller and retain its persisted experience for archival.                     |
| `overlay/services/conversation-session.ts` | Resolve Work handoffs only for the exact selected caller and target experience.                                                   |
| `overlay/main.tsx`                         | Hydrate the target first, then call the canonical source archive route and refresh the ledger.                                    |

### Design revision

`wake_mission` and `wake_work` remain distinct product choices because Mission
owns durable orchestration while Work owns one longer deliverable conversation.
They converge at the UI boundary on one ordered handoff invariant:

```text
confirmed target creation
  -> target wake message persisted
  -> typed handoff event
  -> exact target hydrate succeeds
  -> canonical source archive succeeds
```

The source is intentionally not archived by the creating tool: doing so would
make “target visible first” impossible to prove and could strand the user if
the Overlay cannot hydrate the target. The Overlay archives only after its
selection promise resolves.

### Handoff validation

- Backend tests cover Work creation and first-message wake, confirmation
  decline, wake failure, strict caller identity, typed Work Ledger event
  projection, and prompt guidance.
- Overlay tests cover exact active-caller selection and preservation of the
  source archival identity.
- The Node-launched headed browser test
  `chat-work-inline-handoff-browser.test.ts` observes
  `hydrate:start -> hydrate:end -> archive`, verifies that the source Chat is
  still present while hydration is blocked, then confirms the selected Work
  header/composer and the archived Chat's removal from the Work Ledger. It also
  proves that no second window is opened.
- The shared Mission handler follows the same awaited activation-then-canonical
  archive boundary: a rejected `openMissionSession` promise cannot reach the
  archive call.

### Identity and artifact-delivery refinement

The operator additionally requires a dedicated `New Work` action in the left
Dock and asks Work to bias more strongly toward producing high-quality
artifacts. The shared `conversationExperience` identity source therefore owns
the Work briefcase icon and label across the Dock, Composer, conversation
header, Work Ledger, and Archive. The Work prompt treats artifact selection as
an up-front deliverable-planning decision: it favors one complete primary
artifact plus complementary artifacts only when they improve review through a
different evidence, comparison, sequence, structure, or presentation lens.
Artifact count is not itself a quality signal.
