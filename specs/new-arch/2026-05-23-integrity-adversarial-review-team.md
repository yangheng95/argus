# Integrity Adversarial Review Team - 2026-05-23

Status: implemented history as of 2026-06-17. Current runtime sources are
`packages/opencorvus/src/integrity/team-agent.ts`,
`packages/opencorvus/src/prompt/core/integrity-team-core.txt`,
`packages/opencorvus/src/integrity/team-schema.ts`, and the integrity tests
under `packages/opencorvus/test/integrity/`. This file is retained as
historical design evidence, not as a pending implementation checklist.

Independent review inputs:

- Agent A reviewed runtime architecture, orchestrator integration,
  persistence, and event coupling.
- Agent B reviewed the actual agent communication model and free
  exploration/testing boundary.
- Agent C reviewed event schema, overlay rendering, SDK/OpenAPI, and tests.

Their common conclusion is binding for this design: the new integrity review
must be a host-runtime supervised review team with independent reviewer
sessions. It must not pretend the current runtime has peer-to-peer full-duplex
agent chat or a mailbox protocol.

## User Requirement

The current integrity review is too weak because it is a single fixed review
engine disguised as a multidimensional audit. The formal reports, including
`hallucination`, must be removed. Integrity must become an independent
adversarial review supervisor that forms a review team from the original user
request, current repository state, generated code, and available execution
evidence.

The review team must freely explore and test. It must not follow a fixed
rule-based workflow, fixed dimension list, or fixed checklist. If the user
request emphasizes new API availability, component reuse, code style
consistency, or dependency restraint, the review team must be able to find
those issues through code reading, targeted testing, and cross-examination.

The final output is for the orchestrator: a repair-oriented team report with
evidence, consensus, unresolved disputes, and required next actions.

## Abbreviations

| Term | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| API  | Application Programming Interface: callable contract exposed by code or services.    |
| DB   | Database: persistent storage for OpenCorvus runtime rows and artifacts.              |
| JSON | JavaScript Object Notation: structured event and artifact payload format.            |
| LLM  | Large Language Model: the model-backed agent runtime.                                |
| P2P  | Peer to peer: direct agent-to-agent communication without a supervisor relay.        |
| REQ  | Requirement row: generated requirement identifier and description in the task graph. |
| SDK  | Software Development Kit: generated client type surface.                             |
| UI   | User Interface: operator-facing overlay or task deliverable surface.                 |

## Current State

Integrity is currently a single LLM session with fixed tool submission:

- `integrity/dimensions.ts` defines four fixed dimension ids and issue enums:
  `requirement_fidelity`, `technical_feasibility`, `hallucination`,
  `solution_quality`.
- `integrity/agent.ts` builds one tool per dimension:
  `submit_<dimension>_verdict`.
- `integrity-core.txt` requires each dimension tool exactly once.
- `submit_integrity_review` finalizes only after all four dimension tools and
  `submit_acceptance_verdict`.
- `aggregateIntegrityVerdict` derives the gate from dimension verdicts,
  repair payloads, and acceptance.

The old contract is not isolated. It is hard-coded through:

- `orchestrator/tools.ts`: integrity tool description, `perDimension`
  labels, decision-log text, completion/blocked summaries, read_context output.
- Acceptance-triggered review dispatch has been removed; post-build semantic
  review enters through the orchestrator `integrity` tool.
- `engine/persist.ts`: `recordIntegrityAttempt` stores `per_dimension`,
  counts, corrections, graph corrections, missing goals, acceptance, and
  markdown.
- `engine/model.ts`: `IntegrityReviewCompleted` validates the four dimension
  ids.
- `overlay/store/card-tree.ts`, `overlay/services/tree-writer.ts`,
  `overlay/components/IntegrityCard.tsx`, and overlay i18n: dimension card
  model and rendering.
- `packages/sdk/js/src/gen/types.gen.ts` and `packages/sdk/openapi.json`:
  generated old event schema.
- Tests under `test/integrity`, `test/orchestrator`, `test/engine`,
  `test/server`, and overlay tests.

## Runtime Constraint

The current runtime supports independent sub-sessions and parent-mediated
communication, not direct reviewer-to-reviewer P2P.

Supported:

- `runAgentSession` can create child sessions with a parent id, injected
  toolKit, stream hooks, collector, and structured output.
- `task` can create or resume a sub-agent session and returns a single result
  plus session id.
- `SubAgentProtocol` defines one bounded conclusion plus pointers, not
  transcript sharing.
- `review.stream.*` can show live progress and reasoning chunks.

Not supported:

- reviewer-to-reviewer direct chat;
- a mailbox/registry P2P protocol;
- supervisor access to full child transcripts as prompt context;
- hard enforcement of the `SubAgentProtocol` token budget;
- using disabled legacy `deliver` as the workflow gate.

Therefore the design uses star topology:

- the integrity tool host runtime creates the supervisor and reviewer sessions;
- reviewers report to the supervisor;
- the supervisor relays selected findings as challenges to other reviewers;
- cross-examination is implemented as additional reviewer prompts with prior
  reviewer claims included as challenge material;
- the final report is one supervisor consensus artifact.

## Non-Goals

- Do not replace the four dimensions with another static role list.
- Do not create a coded review state machine.
- Do not add a new mailbox/P2P protocol in this change.
- Do not let reviewers edit source files or goals.
- Do not use legacy `deliver` as the task completion authority.
- Do not preserve `INTEGRITY_DIMENSIONS` as compatibility API.
- Do not keep old `dimensions`, `per_dimension`, or dimension i18n as fallback.

## Architecture

`reviewIntegrity()` becomes a host-runtime team review coordinator.

It still creates one top-level `integrity` session under the orchestrator
parent. That session represents the supervisor. The host runtime then asks the
supervisor for an initial review plan and dynamically launches reviewer
sessions through `runAgentSession`.

The plan is not a checklist. It is a short, task-specific statement of which
risks need independent review now and why. The supervisor can choose reviewer
scopes such as API contract, component reuse, dependency discipline, runtime
behavior, visual fidelity, data flow, regression risk, or any other task-
specific concern. These are data values in the report, not enums.

Reviewers receive:

- original user request and task title;
- bounded request excerpt plus full request pointer;
- REQ rows and source mappings;
- goals and acceptance specs;
- architect contract graph and decision log;
- requirement status snapshot when present;
- changed files and representative diffs;
- acceptance or goal-run evidence;
- attachments and visual artifacts;
- prior integrity attempts;
- the concrete review question assigned by the supervisor.

Reviewers can freely choose what to inspect or test. They must return
evidence-backed findings and explain why their exploration was sufficient for
their assigned question.

The supervisor then cross-examines:

- confirmed findings can be accepted into the final report;
- risky or surprising findings are sent to another reviewer as challenge
  material;
- disagreements are either resolved by more evidence or preserved as explicit
  unresolved disputes;
- the supervisor must not suppress a disputed blocking issue without explaining
  the evidence basis.

## Tool Boundary

Reviewer sessions should reuse the evidence-oriented subset from
`createIntegrityAcceptanceTools`, with stricter runtime boundaries:

- allowed reading: `read_file`, `find_files`, `search_code`, `list_directory`,
  `inspect_integrity_evidence`;
- allowed testing: `run_command` plus build-owned screenshot evidence already
  present in the integrity evidence bundle;
- denied mutation: `edit_file`, `write_file`, `memory_write`, recursive
  review dispatch, `task`, goal mutation, task lifecycle tools.

`run_command` is the main remaining risk because shell commands can modify the
workspace. Implementation must add one of these protections before reviewers
can use it:

- run reviewer commands in a read-only worktree or disposable copy; or
- snapshot/diff-guard the worktree before and after each command and fail the
  review command if project files changed; or
- expose a narrower verification command tool instead of arbitrary shell.

Prompt-only "do not modify" is not enough for the reviewer boundary.

## Structured Report

The completed event is the UI/API single source. The persisted artifact must
derive from the same team report schema and may add storage-only metadata such
as `spec_snapshot_id`, `phase`, and `time_completed`. The overlay must not read
artifact payloads or parse markdown to reconstruct fields that were omitted
from the event.

The final event and artifact should carry a team report, not dimensions.

Recommended completed event payload:

```ts
type IntegrityVerdict = "pass" | "concerns" | "needs_correction"

type IntegrityReviewCompletedPayload = {
  taskID: string
  sessionID: string
  verdict: IntegrityVerdict
  summary: string
  teamReportMarkdown: string
  reviewers: Array<{
    id: string
    role: string
    scope: string
    sessionID?: string
    findingCount: number
  }>
  findings: Array<{
    id: string
    severity: "blocking" | "advisory"
    claim: string
    evidence: Array<{
      kind: "file" | "diff" | "command" | "runtime" | "artifact" | "request" | "memory"
      ref: string
      summary: string
    }>
    affectedGoals?: string[]
    affectedRequirements?: string[]
    affectedFiles?: string[]
    repair: string
    consensus: "confirmed" | "disputed" | "needs_more_evidence"
    reviewers: string[]
  }>
  rounds: Array<{
    id: string
    reviewer: string
    promptSummary: string
    reportSummary: string
    testedCommands: string[]
    findingIDs: string[]
  }>
  requiredRepairs: Array<{
    action: "modify_goal" | "build" | "architect" | "fail_task" | "question"
    reason: string
    target?: string
  }>
  unresolvedDisagreements: Array<{
    claim: string
    positions: string[]
    nextEvidence: string
  }>
  attempts: number
}
```

Recommended persisted artifact payload:

```ts
type IntegrityTeamAttemptPayload = {
  spec_snapshot_id: string
  session_id: string
  verdict: IntegrityVerdict
  phase: "pre_build" | "post_build"
  report: IntegrityReviewCompletedPayload
  time_completed: number
}
```

Acceptance evidence should be folded into the team report as findings and
command/runtime evidence. Do not keep a separate mandatory `acceptance` object
in the completed event unless it remains a distinct reviewer report in the same
team schema. A second acceptance object would recreate the current split-source
problem.

The old acceptance split source must be removed from the active integrity
contract:

- delete or repurpose `submit_acceptance_verdict`;
- delete or repurpose `IntegrityAcceptanceCollector`;
- delete `acceptance` from `integrity.review.completed`;
- remove overlay `integrity.acceptance.*` rendering and i18n;
- remove acceptance-specific finalization gates from integrity.

All new integrity event and artifact schemas must be strict. A payload that
contains old `dimensions`, `per_dimension`, `perDimension`, `acceptance`, old
four dimension ids, or old submit tool names must fail schema tests instead of
being silently stripped by Zod.

## Verdict Semantics

Host aggregation should remain structural:

- `pass`: no blocking findings; no unresolved dispute that could invalidate a
  user-requested deliverable; required runtime evidence, when applicable, is
  present in the team report.
- `concerns`: only advisory findings remain, with evidence and no required
  pre-completion repair.
- `needs_correction`: any confirmed blocking finding, any disputed blocking
  finding without enough evidence to clear it, or any rejected/failed runtime
  acceptance evidence.

The host must not infer domain failures from keywords, file names, dependency
counts, or reviewer roles. It should enforce only shape and verdict
invariants.

## Impacted Files

Core runtime:

- `packages/opencorvus/src/integrity/agent.ts`
- `packages/opencorvus/src/integrity/dimensions.ts`
- `packages/opencorvus/src/integrity/render-markdown.ts`
- `packages/opencorvus/src/integrity/index.ts`
- `packages/opencorvus/src/integrity/submit-schema.ts`
- `packages/opencorvus/src/integrity/acceptance-tools.ts`
- `packages/opencorvus/src/integrity/acceptance-output-tools.ts`
- `packages/opencorvus/src/prompt/core/integrity-core.txt`
- `packages/opencorvus/src/prompt/core/acceptance-review-core.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/build/screenshot-tool.ts`
- `packages/opencorvus/src/runtime/page-capture.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/model.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/review/stream.ts`
- `packages/opencorvus/src/session/session.sql.ts`

Overlay and generated clients:

- `packages/overlay/src/store/card-tree.ts`
- `packages/overlay/src/services/tree-writer.ts`
- `packages/overlay/src/components/IntegrityCard.tsx`
- `packages/overlay/src/styles/surfaces/inspector.css`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- `packages/sdk/js/src/gen/types.gen.ts`
- `packages/sdk/openapi.json`

Tests:

- `packages/opencorvus/test/integrity/*`
- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/engine/workflow-integrity-step.test.ts`
- `packages/opencorvus/test/acceptance/project-gate.test.ts`
- `packages/opencorvus/test/server/task-conversation-routes.test.ts`
- overlay tree-writer/card tests
- prompt hygiene tests that mention old dimensions

## Implementation Batches

### Batch 1 - New Data Contract

- Add `IntegrityTeamReport` and related types.
- Change `IntegrityReviewCompleted` to team payload.
- Change `recordIntegrityAttempt` from `per_dimension` to team payload.
- Update read_context and workflow projections to read `team_report_markdown`.
- Regenerate OpenAPI and SDK types.
- Add strict schema tests that old dimension, `per_dimension`, `perDimension`,
  `acceptance`, and old submit-tool payloads are rejected rather than stripped.

### Batch 2 - Supervisor Runtime

- Rewrite `integrity-core.txt` for supervisor behavior.
- Remove `INTEGRITY_DIMENSIONS` from runtime.
- Replace fixed dimension tools with separate supervisor and reviewer report
  tools. These tools define the report boundary; they must not be documented as
  an exact-once fixed sequence.
- Implement host-created reviewer sessions with `runAgentSession`.
- Persist reviewer session ids and summaries.
- Keep `integrityReviewSingleflight` around one whole team review, not around
  individual reviewers.

### Batch 3 - Free Exploration and Test Safety

- Create a reviewer toolKit from the evidence tools.
- Remove all mutation tools, including `memory_write`, `edit_file`,
  `write_file`, recursive review dispatch, `task`, goal mutation, and lifecycle
  tools.
- Add runtime protection for `run_command` so reviewer commands cannot mutate
  project files silently.
- Add tests proving reviewer command evidence can be recorded.
- Add tests proving reviewer mutation tools are absent.

### Batch 4 - Review Stream, Orchestrator, and Acceptance Entrypoints

- Replace fixed `review.stream.currentStep` coupling for integrity with a
  dynamic activity model, such as `activity`, `scope`, `reviewerID`, and
  `roundID`, or make `currentStep` optional for integrity.
- Add tests proving integrity review progress does not depend on the old fixed
  step enum.

- Update `runIntegrityReviewOnce`, `renderIntegrityOutcome`, decision-log
  summaries, and post-build completion gating.
- Remove acceptance-triggered review paths; semantic review enters through
  orchestrator `integrity`.
- Remove old `perDimension` strings from orchestrator output.
- Update `orchestrator-core.txt` to remove mandatory separate final acceptance
  review language and fixed pre-integrity audit ritual language.

### Batch 5 - Overlay and Tests

- Replace `IntegrityCard` dimension sections with team report sections:
  reviewers, findings, required repairs, unresolved disagreements, and full
  markdown.
- Remove dimension i18n keys and old CSS rows.
- Update server event tests, overlay materialization tests, workflow tests, and
  orchestrator fixtures.
- Delete `tool-payload-budget.test.ts` and dimension registry tests.
- Add guard tests that old dimension tool names and i18n keys do not reappear.
- Add cross-examination tests: conflicting reviewer findings must trigger a
  supervisor challenge, and an unresolved disputed blocking finding must force
  `needs_correction`.

## Acceptance Criteria

- Runtime no longer exposes `submit_requirement_fidelity_verdict`,
  `submit_technical_feasibility_verdict`, `submit_hallucination_verdict`, or
  `submit_solution_quality_verdict`.
- No active integrity prompt or event schema treats `hallucination` as a report
  dimension.
- `integrity.review.completed` carries a team report, not fixed dimensions or a
  mandatory separate acceptance object.
- Overlay renders the team report without requiring dimensions or acceptance.
- `integrity_attempt` artifacts store team report data and no `per_dimension`.
- The orchestrator receives full markdown and structured findings for repair.
- Task completion requires `phase === "post_build"` and `verdict === "pass"`;
  a `pre_build` pass must not complete the workflow.
- A test covers a user request that mentions API availability, component reuse,
  style consistency, and dependency restraint, and the team report can carry all
  four concerns as findings without fixed dimension labels.
- A test covers targeted command/runtime evidence in a reviewer report.
- Reviewer sessions cannot write project files through review tools.
- Reviewer sessions cannot write project memory through `memory_write`.
- `read_context` displays team report markdown, findings, required repairs,
  phase, and current spec snapshot; it does not display per-dimension text.
- `review.stream.*` for integrity does not require fixed steps such as
  `manifest`, `runtime`, `visual`, `specialist`, `agent`, or `post_repair`.
- Guard tests fail if active prompt, event schema, overlay, SDK/OpenAPI, or
  integrity exports contain old `dimensions`, `per_dimension`, `perDimension`,
  mandatory separate `acceptance`, `INTEGRITY_DIMENSIONS`, or old dimension
  submit tool names.

## Independent Review Feedback Applied

Agent A findings applied:

- The old dimension model is coupled through prompt, tools, result ordering,
  persistence, events, overlay, SDK, and acceptance-triggered review.
- `integrityReviewSingleflight` must wrap one team review, not member reviews.
- Workflow/read_context must understand team completeness and phase.

Agent B findings applied:

- The runtime supports star topology, not P2P full-duplex review.
- Cross-examination is supervisor-mediated challenge prompts.
- Free testing requires runtime protection because `run_command` can mutate.
- `deliver` is disabled and must not be treated as workflow authority.

Agent C findings applied:

- Overlay currently filters unknown dimension ids and hard-fails on missing
  acceptance.
- The completed event should shrink to team report data and avoid old
  dimensions/acceptance split sources.
- SDK/OpenAPI and old tests must be migrated in the same change.

Second-pass review findings applied:

- Event payload is the complete UI/API single source and now includes rounds,
  evidence, repairs, and unresolved disagreements.
- Acceptance split source removal is explicit, including
  `submit_acceptance_verdict`, collector, event field, overlay rendering, and
  i18n.
- Strict schema guards are required because non-strict Zod objects can strip
  old fields silently.
- `review.stream.*` cannot reintroduce fixed integrity steps.
- Reviewer tool boundary now denies `memory_write`.
- Cross-examination has explicit acceptance tests.
- `orchestrator-core.txt`, `submit-schema.ts`, and `engine/store.ts` are in
  scope.
