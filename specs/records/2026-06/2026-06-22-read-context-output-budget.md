# Read Context Output Budget

Date: 2026-06-22

Superseded on 2026-06-24 by
[`2026-06-24-read-context-drilldown-only.md`](2026-06-24-read-context-drilldown-only.md):
`read_context` is no longer a scheduler state refresh tool and no longer owns
goal, research, delivery, or evaluation scopes. This note remains historical
evidence for the output-budget bug and integrity/decision drilldown caps.

## Acronyms

- DB: Database, the persisted task and artifact store.
- ID: Identifier, a stable task, session, goal, artifact, or evidence key.
- LLM: Large Language Model, the model receiving orchestrator prompt context.
- QA: Quality Assurance, the review stage that verifies delivery quality.

## Problem

`read_context` is an orchestrator state refresh tool, but the current renderer can
return tens or hundreds of thousands of characters in one call. The direct
trigger is not a single bad section. The tool has several local caps, while the
combined output has no task-level budget:

- goal rendering emits every described goal and every described attempt;
- integrity latest appends `teamReportMarkdown` verbatim;
- integrity history can consume the shared 48,000 character integrity prompt
  budget by itself;
- deep and frontend research sections are capped by row count but not by each
  row's long text fields;
- deliveries can list every current goal's acceptance summary and file list.

Because the orchestrator keeps the latest `read_context` result in the active
session, a single oversized call can overload the next dispatch prompt. This is
a source-rendering bug, not a scheduler routing problem.

## Existing Constraints Recalled

- `specs/records/2026-06/bug-hunt-repair-plan-2026-06-17.md` requires `read_context` goal output
  to reuse describe-layer facts. The fix must keep `NEEDS_REDISPATCH`, orphan
  facts, goal run IDs, and child session IDs visible.
- `specs/records/2026-06/orchestrator-no-decision-stop-2026-06-18.md` treats `read_context` as an
  observation tool. It must stay read-only and must not become a decision gate.
- `specs/records/2026-06/2026-06-21-frontend-research-context-digest.md` requires
  research context to expose compact pointers plus persisted bundle paths, not
  broad raw evidence bodies.
- `packages/opencorvus/src/agent/sub-agent-protocol.ts` documents that
  `SubAgentProtocol.report` is telemetry only. It is not a runtime cap and
  cannot be relied on to protect the dispatcher.
- `packages/opencorvus/src/tool/truncation.ts` is for regular tool output that
  has a re-read path. Orchestrator-native `read_context` must be bounded at its
  renderer, because its result is itself the current state snapshot.

## Call Point Inventory

| Surface                                                                              | Current role                                                   | Required change                                                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/orchestrator/tools.ts::read_context`                        | Builds all state sections and returns the joined string.       | Add a single source budget for the renderer and make every large section consume it explicitly.                  |
| `packages/opencorvus/src/engine/describe.ts::renderGoal`                             | Authoritative goal fact renderer.                              | Reuse it, then trim each rendered goal block with a pointer to `read_context scope=goals`.                       |
| `packages/opencorvus/src/integrity/root-history.ts::renderIntegrityRootHistoryBlock` | Shared integrity history renderer with a 48,000 character cap. | Keep it authoritative, but give `read_context` a smaller section budget when embedding it.                       |
| `packages/opencorvus/src/orchestrator/tools.ts::appendResearchBriefContext`          | Adds compact research metadata to `read_context scope=all`.    | Bound stale reasons, subpage refs, bundle path line, and summary text per artifact.                              |
| `packages/opencorvus/test/orchestrator/tools.test.ts`                                | Existing read_context fact coverage.                           | Add regressions proving large integrity/research inputs stay under budget while preserving pointers and key IDs. |
| `specs/records/2026-06/2026-06-29-spec-consolidation.md`                                                          | Indexes dated design records.                                  | Add this note.                                                                                                   |

## Decision

Introduce `READ_CONTEXT_OUTPUT_BUDGET` in `orchestrator/tools.ts` as the single
renderer budget for `read_context`. The budget is source-level: sections are
added through a small budgeted collector that either includes a complete block or
includes a clear omitted-count line pointing at the narrower scope or persisted
artifact that owns the full data.

This is not downstream emergency truncation. Each section must decide what facts
are essential:

- Goals keep every goal header and state facts where budget allows, with
  individual goal blocks capped rather than one giant goals section.
- Integrity latest keeps verdict/counts and a bounded report excerpt with the
  integrity artifact as the pointer.
- Integrity history keeps the shared rendered history as the fact source but
  embeds a smaller excerpt in `read_context scope=all`; callers can request
  `scope=integrity_history` for that section's own budgeted view.
- Research keeps artifact ID, session ID, source URL, bundle paths, counts, and a
  bounded summary.
- Deliveries keep current per-goal summary but cap file lists and summaries.

## Acceptance

- A seeded task with a very large integrity team report and large research
  summaries returns `read_context scope=all` under the declared budget.
- The same output still contains current goal IDs, artifact IDs, session IDs,
  bundle paths, stale state, and a visible omitted marker where content was
  shortened.
- Existing regressions for `NEEDS_REDISPATCH`, orphan facts, goal run IDs,
  terminal refill facts, and multiple research briefs still pass.
- No scheduler gate, state machine, synthetic message, or prompt-only workaround
  is added.
- Focused tests and `packages/opencorvus` typecheck pass before commit.
