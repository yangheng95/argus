# Agent Specific Compaction Schema

## Trigger

The current compact handoff uses one generic `CompactionHandoff` object for every
agent. It preserves broad continuation facts, but it does not force the compact
agent to preserve the role-owned products that make each agent resumable. This is
the "big shared pot" failure mode: build, architect, frontend-design,
orchestrator, research, and review sessions can all pass the same schema while
dropping their actual contract surface.

## Recall

Read before implementation:

- `AGENTS.md`
- `specs/artifacts/tv2ainvest.md`
- `deleted pre-June record 2026-05-13-compaction-handoff-hardening`
- `specs/records/2026-06/2026-06-02-compact-agent-fidelity-review.md`
- `specs/records/2026-06/2026-06-24-scheduler-compact-read-context.md`
- `specs/records/2026-06/2026-06-25-scheduler-orchestrator-auto-compaction.md`
- `packages/opencorvus/src/session/compaction-handoff.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/session/session.sql.ts`

## Call-Point Audit

`rg -n "CompactionHandoff|SessionCompaction|compaction|assistant.summary|structured handoff|handoff schema" packages/opencorvus/src packages/opencorvus/test specs -S`

Relevant implementation surfaces:

| Surface                                                    | Decision                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `CompactionHandoff.Schema`                                 | Keep one accepted compact boundary type, but extend it with `agentHandoff`, a discriminated agent-specific payload. |
| `SessionCompaction.handoffOutputFormat`                    | Select the output schema from the source user message agent. The compactor does not choose its own payload kind.    |
| `SessionCompaction.validateHandoffPayload`                 | Validate both the common envelope and the source-agent payload. Reject mismatched payload kind.                     |
| `selectedHeadEvidenceRequirements`                         | Carry `sourceAgent` and previous agent-specific facts into the validation contract.                                 |
| `renderRequiredEvidence`                                   | Render previous agent-specific facts as exact retention requirements for repeated compaction.                       |
| `CompactionHandoff.renderMarkdown` / `renderMemoryEpisode` | Render the agent payload from the structured object so display and memory stay derived from one source.             |
| `Message.filterCompacted` / `MemoryFlush.flush` / prune    | No new boundary path. They continue to rely on `CompactionHandoff.isValidSummaryMessage`.                           |

## Design

The compact contract has two layers:

1. Common continuation envelope: objective, acceptance criteria, instruction
   sources, current state, decisions, files, tests, blockers, user messages,
   todos, next actions, and risks.
2. Agent-specific payload: the role-owned work product that must survive for
   that agent to resume without hallucinating or redoing work.

The source of truth for payload selection is `currentState.sourceUserMessage.agent`
from the compacted session. Known built-in agents get exact payload kinds:

- `orchestrator`: workflow decisions, delegated sessions, goal graph, pending decisions.
- `mission`: mission contract, roadmap, delegated tasks, user commitments, external events.
- `requirements`: requirement inventory, constraints, clarifications, rejected non-requirements.
- `architect`: goals, graph contracts, ownership boundaries, verification plan.
- `frontend-design`: reference surfaces, visual system, component contracts, implementation template, fidelity risks.
- `frontend-research`: source pages, region evidence, interaction evidence, data contracts, handoff artifacts.
- `build`: deliverables, code changes, verification, runtime state, handoff artifacts.
- `visual-qa`: screenshots, findings, interaction checks, repair state, acceptance verdict.
- `integrity`: acceptance findings, requirement coverage, runtime evidence, verdict, rejection details.
- `fact-check`: claims, source evidence, unresolved claims.
- `deep-research`: research questions, sources, findings, uncertainties, handoff artifacts.
- `goal-workload-analyst`: goal inventories, decomposition concerns, execution risks, recommended splits.
- `intent-analysis`: detected intents, slots, clarifications, routing advice.
- `explore`: files read, symbols, findings, open questions.
- `coding` / `coding-assistant`: edit scope, code changes, commands, next edits.
- `general`: findings, work products, tool evidence, next actions.
- `control`: panel actions, visible state, pending user follow-up.
- internal helper agents: maintenance actions, generated outputs, source requests.
- custom agents: declared agent name, role contract, work products, tool evidence, continuation state.

Custom agents are not routed through a generic built-in payload. They use the
explicit `custom-agent` schema, which forces the compactor to preserve that
custom agent's declared role, tool surface, products, evidence, and continuation
state.

## Non-Goals

- Do not add a second compaction engine.
- Do not add prompt-only quality advice as the primary mechanism.
- Do not add a host-side gate that decides workflow behavior.
- Do not preserve legacy generic summaries as accepted boundaries.

## Tests

- Schema exposes `agentHandoff` and build output format requires build payload
  fields.
- Build payload is accepted for build source agent.
- Orchestrator payload is rejected for build source agent.
- Rich compact history rejects an empty role payload.
- Previous agent-specific facts are rendered and retained across repeated
  compaction.
- Markdown and memory rendering include the agent-specific payload from
  `assistant.structured`.

## Independent Review Feedback

Three read-only reviewer agents audited the first implementation. They found no
P0 issue, but they agreed on several P1 gaps that must be fixed before this
design can be considered a real agent-specific compact contract:

| Finding                                                                                                        | Fix                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isValidSummaryMessage` accepted any `agentHandoff` union member after replay, filter, prune, or memory flush. | Make summary validation parse the common envelope and then enforce `currentState.sourceUserMessage.agent -> agentHandoff.kind`, including exact `custom-agent.agentName`. |
| `replay-compaction-errors-validator.ts` still called `selectedHeadEvidenceRequirements` without `sourceAgent`. | Read the parent user message agent from persisted message data and pass it into the evidence requirements.                                                                |
| Runtime `activeBuildContracts` were prompt-visible but not validation-required.                                | Carry active build contracts through `EvidenceRequirements` and reject a handoff that omits or mutates the exact contract rows.                                           |
| `sourceArtifactIDs` were omitted from the rendered replay line for active build contracts.                     | Render every active build contract field, including `sourceArtifactIDs`, in both Markdown replay and memory episode output.                                               |
| Repeated compaction flattened `agentHandoff` retention into unscoped strings.                                  | Retain agent handoff facts as field-path-bound entries, so moving a command/fact into another field fails validation.                                                     |
| The schema registry duplicated the built-in agent list without a compile-time relation to `AgentRoleID`.       | Type the registry with `satisfies Record<AgentRoleID, ...>` and add tests against the runtime role list.                                                                  |
| Prompt-facing schema snippets were a hand-written second schema.                                               | Derive the agent-specific prompt schema text from the same Zod schema used by StructuredOutput.                                                                           |

Additional test coverage required by this review:

- Persisted summary payload mismatch is rejected by `isValidSummaryMessage`.
- `Message.filterCompacted` cannot compact around a mismatched persisted summary.
- Agent output schema / validator coverage is table-driven for every built-in
  agent, plus the explicit `custom-agent` path.
- Previous `agentHandoff` retention fails when a value is moved to another
  field.
- Active build contract validation fails when `artifactID` or
  `sourceArtifactIDs` are omitted or changed.
