# Mission Squad Authority And Orchestrator Prompt

Date: 2026-08-02
Status: Complete
Owner: Codex

## Recall

### User request

- “mission要从持有的专家团（也就是输入框勾选的专家团，未勾选默认全部已安装可用）中选择专家团发布任务，不可窃取没有指定的专家团。”
- “@等于选择了专家团其中的一个，@mission等全部可用。”
- “mission要以（可视化最好）的artificat展示结束。”
- “再继续检查调度器的prompt”

### Acceptance criteria

- Treat the Composer-selected Expert Squads as Mission's complete dispatch authority.
- One or more visible `@squad("<id>")` references restrict Mission to those exact IDs.
- A Mission launched without any `@squad` reference, including one launched through `@mission("<name>")` alone, holds an exact snapshot of every Expert Squad installed at launch.
- A Mission Skill is an orchestration contract and cannot expand the held Expert Squad set.
- Mission never discovers, generates, installs, selects, or dispatches an Expert Squad outside that set.
- Every Mission-created Task carries one exact held `promptProfile`, fixed for its lifetime.
- Mission finishes with one message-owned interactive Artifact; prefer a diagram, dashboard, timeline, tree, or other visual renderer when it materially clarifies the Mission result.
- Replace the Orchestrator's warning-heavy scheduler prompt with an executable acceptance-to-owner closure method, ready-frontier derivation, self-contained worker brief, evidence reconciliation, and explicit terminal decision.
- A Mission-owned Task's exact `promptProfile` remains authoritative; its Orchestrator cannot scan inactive Squads or call `select_expert_squad` to steal another Squad.
- Preserve existing Task lifecycle, immutable workflow occurrence, Delivery Slice, Artifact discovery/selection, cross-Task import, operator-message, coordination, and runtime-repair boundaries.
- Do not add a Host route gate, classifier, workflow engine, fallback profile, hidden state, or User Interface automated test.

### Hard constraints

- `prompt_profile.active` remains the single Task-local Expert Squad identity.
- Mission itself has no active Expert Squad.
- The current Composer and Mission route remain the selection source; no second active-set field is introduced.
- The current `panel.expert_squad_catalog` filtering remains authoritative.
- Mission's terminal interactive Artifact is presentation, not a replacement for Task evidence or canonical deliverable Artifacts.
- The Orchestrator remains a scheduler and lifecycle decision-maker, not the deliverable producer.
- Preserve concurrent changes in Mirror Prism, Conversation scrolling, and unrelated specs.

### Sources read

- `AGENTS.md`
- `packages/overlay/src/services/composer-submit-route.ts`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/main.tsx`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/mission/session.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/opencorvus/src/agent/tool-pool-data.ts`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/engine/describe.ts`
- `packages/opencorvus/src/tool/publish-interactive-artifact.ts`
- current Mission, Orchestrator, Prompt Profile Resolver, route, language, and interactive-Artifact contract tests
- `specs/current/architecture/01-agents.md`, `04-extensions.md`, and `07-panel.md`

### Whole-repository grep results

| Surface | Current fact | Disposition |
| --- | --- | --- |
| Composer routing | `resolveComposerSubmitRoute()` sends nonempty `expertSquadIDs` for visible Squad references; Mission Skill references start Mission without that restriction. | Preserve; this already represents selected subset versus all installed. |
| Mission persistence | `metadata.mission.visibleExpertSquadIDs` previously stored an empty sentinel for default-all, so later catalog reads could include Squads installed after launch. | Resolve default-all once at launch and persist the exact nonempty ID snapshot as the only authority source. |
| Mission catalog | `panel.expert_squad_catalog` calls `recommendationCatalog()` with the persisted visible IDs. | Treat the returned IDs as the complete held set; never expand it in Prompt. |
| Mission production | Current Prompt and tests authorize automatic project Squad production and later dispatch with the new ID. | Remove from Mission; it violates the held-set boundary. Explicit Squad authoring remains an ordinary separately authorized product capability, not automatic Mission escalation. |
| Mission final surface | Mission already receives `publish_interactive_artifact`, but its Prompt does not require a terminal Artifact. | Require one terminal interactive presentation after evidence acceptance. |
| Task source | `EngineTaskTable.source` records `mission`, but `TaskDesc` does not expose it in the Orchestrator's structured context. | Add the read-only source fact so Prompt can preserve Mission-owned Squad authority. |
| Scheduler selection | Current Orchestrator Prompt tells the scheduler to enumerate inactive selectors and call `select_expert_squad` when it judges ownership wrong. | For `source=mission`, prohibit both actions and preserve the fixed active profile. |
| Scheduler method | `orchestrator-core.txt` is 527 lines / 6734 words and repeats immutable occurrence, repair, waiting, and lifecycle warnings; it has no concise acceptance-closure record or worker brief. | Replace with one decision loop centered on acceptance claims, workflow ownership, dependencies, ready frontier, Artifact evidence, and terminal decision. |
| Scheduler prompt callers | `orchestrator/agent.ts` composes the core with the active package scheduler overlay and dynamic Task context; package overlays own domain workflow policy. | Keep core domain-neutral and let exact package overlays own workflow specifics. |
| Prompt tests | Existing scheduler tests mostly assert accumulated substrings; one touched test contains prohibited negative assertions. | Replace focused Prompt assertions with positive contracts for the new decision method and delete touched negative assertions. |

## Design

### 1. Mission held-set authority

At first intake, Mission records:

```text
## Expert Squad authority
Selection source: selected references | all installed
Held Squad IDs: <exact IDs returned by panel.expert_squad_catalog>
```

The launch path resolves an explicit selection or default-all into a persisted
nonempty ID snapshot before the first wake. The returned catalog is complete for
that Mission and later package installation cannot widen it. Mission may choose
different held Squads for different stages, but every stage owner must be one of
those IDs. A Mission Skill may require stages only within that set. Missing
ownership becomes an explicit blocker or operator choice; Mission cannot solve
it by loading an inactive selector, generating a package, or borrowing another
installed Squad.

### 2. Mission planning and terminal Artifact

Mission plans backward from numbered acceptance claims. Each stage records its acceptance coverage, held Squad owner, catalog evidence, dependencies, execution scope, owned resources, inputs, deliverables, acceptance criteria, observed evidence, Task ID, consumers, and parallel rationale.

After all claims are accepted, Mission calls `publish_interactive_artifact` in the final assistant turn. The Artifact contains the outcome, stage and dependency topology, exact Squad/Task ownership, accepted deliverables and locators, limitations, and blockers. A visual renderer is preferred for multi-stage topology or time/metric structure; `document@1` remains the structured minimum when a visual form would distort the result.

### 3. Orchestrator acceptance closure

The Task Orchestrator uses one repeated decision method:

1. Read current Task source, request, acceptance, active fixed Squad, selected workflow, Delivery Slices, current Sessions, and Artifact evidence.
2. Build a transient acceptance closure mapping each claim to its responsible workflow node or direct projected owner, required inputs, durable output, and observed evidence.
3. Derive the ready frontier from the selected workflow's declared predecessor evidence, active occurrences, capacity, and real workspace conflicts.
4. Dispatch every independent ready node in the same response with one self-contained target-specific brief.
5. Reconcile each returned terminal outcome through the Task Artifact Catalog; terminal success alone is not acceptance.
6. Dispatch the next ready frontier, ask only for operator-owned facts, repair command-side runtime blockers, or record the exact terminal Task decision.

The closure is reasoning over current facts, not a persisted workflow state machine.

### 4. Worker brief

Every dispatch communicates:

- outcome owned by this worker;
- exact work scope and owned surfaces;
- predecessor evidence roles to discover in the same-Task catalog;
- deliverables and durable Artifact expectation;
- positive acceptance criteria;
- operator and package constraints;
- reporting or coordination requirement.

The brief never transports Artifact bodies or locators and never invents adapter fields.

### 5. Recovery

A selected workflow node has one logical occurrence per Task. Before its first occurrence, repair local toolchain prerequisites or correct a still-unstarted local contract. After occurrence, evidence that requires the same node to run again makes the current Task terminally non-pass; preserve the exact evidence and require a new Mission Task. Cross-Task evidence travels only through Mission `artifact_imports`.

## Implementation plan

1. Replace Mission Prompt with the held-set, acceptance-backward, stage-ledger, evidence-handoff, and final-interactive-Artifact contract.
2. Remove automatic Mission Expert Squad production assertions and document the explicit-authoring boundary.
3. Expose Task `source` in the read-only Orchestrator Task description.
4. Replace the scheduler core with the acceptance-closure decision method while retaining platform lifecycle and evidence invariants.
5. Rewrite focused non-UI Prompt contracts around positive current behavior.
6. Update current architecture and spec indexes after concurrent edits settle.
7. Run focused Mission, Orchestrator, resolver, route, artifact, typecheck, and documentation-health verification.
8. Inspect the final diff, commit only task-owned paths, and push `v0.0.28beta` to `myhexin`.

## Independent agent review

Three read-only agents reviewed the Mission prompt independently from prompt
editing, stage-decomposition, and adversarial perspectives. Their useful
findings are incorporated in the final contract:

- every wake reloads `frontier.md`, `handoff.md`, and `tasks.md`;
- every stage records numbered acceptance coverage, execution scope, owned
  resources, exact terminal evidence, and immutable Artifact locators;
- a terminal-but-unaccepted result creates a fresh correction Task instead of
  ambiguously following up the completed Task;
- one-off unfamiliar work does not justify package production;
- automatic Expert Squad production was removed entirely because it cannot
  widen the Composer-authorized held set.
- the default-all launcher path now persists the exact launch-time IDs instead
  of retaining a live empty-set sentinel.
- concurrent first wakes now initialize the snapshot inside the Mission-session
  creation lock; identical requests converge and conflicting authority is
  rejected explicitly.

The reviewers' earlier production-flow and built-in-Squad routing suggestions
were rejected after the operator clarified the held-set authority. Mission
selects only from the returned catalog and does not carry a second hard-coded
recommendation source.

## Verification

- `bun test packages/opencorvus/test/mission/expert-squad-authority.test.ts packages/opencorvus/test/mission-prompt-work-ledger.test.ts packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts packages/opencorvus/test/agent/orchestrator-core-grain-ladder.test.ts packages/opencorvus/test/agent/orchestrator-stale-recovery-prompt.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/session/request-language-propagation.test.ts packages/opencorvus/test/skill/builtin-payload-generation.test.ts packages/opencorvus/test/expert-squad/conversation-authoring.test.ts`
  — 46 passed, including identical and conflicting concurrent first-wake
  authority contracts.
- `bun test packages/opencorvus/test/engine/describe-agent-message-refs.test.ts --test-name-pattern "large specialist history"`
  — 1 passed; the unrelated restart scenario remains excluded because its
  pre-existing fixture lacks the current package revision.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/conversation-launch-references.test.ts`
  — 27 passed.
- `bun test packages/opencorvus/test/tool/panel.test.ts` — 28 passed,
  including the Chat-to-Mission default-all launch snapshot.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/document-health.test.ts`
  — 70 passed.
- `bun run --cwd packages/opencorvus typecheck` — passed.
- `git diff --check` — passed.

No User Interface automation was added, modified, or run. This change affects
Prompt, resolver-facing context, architecture, and non-UI contracts; the
interactive Artifact renderer already exists in Mission's projected tool
surface.
