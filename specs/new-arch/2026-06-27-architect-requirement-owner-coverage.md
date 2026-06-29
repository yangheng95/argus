# Architect Requirement Owner Coverage Repair (2026-06-27)

## Incident Evidence

Task `tsk_f087fe38f001HZ7p6uaXabjlpM` requested a replica of
`https://www.tradingview.com/markets/world-economy/`.

The durable database evidence showed:

- Requirements contained `REQ-1` through `REQ-13`, including the Global
  Industrial map, News, Economic Calendar, and Footer surfaces.
- Frontend research and the research bundle listed the page sections beyond
  the top dashboard.
- The first Architect session registered only two goals: data models and page
  scaffold.
- `submit_architect` returned `PASS` even when the submitted
  `decomposition_analysis` said remaining section-level goals still needed to
  be registered.
- Goal Workload Analysis flagged that `REQ-2` through `REQ-9` had no owning
  goal.
- The follow-up goal graph only added goals for `REQ-2` through `REQ-5` plus a
  top-dashboard verification goal.
- The active goal graph had no owner for `REQ-6`, `REQ-7`, `REQ-8`, or
  `REQ-9`, so Build produced a page ending after the comparison table.

The root defect is not evidence capture and not PRD extraction. It is that the
Architect terminal contract accepts a graph that has not consumed every known
requirement. A second Integrity defect hid the late `REQ-9` footer row because
the initial integrity prompt rendered only the first eight requirements and
requirement-status rows.

## Existing Constraints Recalled

- `AGENTS.md` forbids fallback, compatibility paths, hard gates, and prompt-only
  patches for structural defects.
- `2026-06-25-visual-evidence-no-hard-gate-root-repair.md` keeps visual
  evidence gaps advisory; this repair must not reintroduce a visual parity host
  gate.
- `2026-06-26-architect-explicit-goal-count-contract.md` already made explicit
  goal-count contracts part of the Architect validation input. This repair must
  reuse the same single validation path rather than creating a parallel source.
- `2026-06-25-architect-contract-graph-persist-integrity.md` keeps dependency
  contracts and executable `depends_on` facts aligned. This repair must not
  disturb dependency graph semantics.

## Callpoint Inventory

Command:

```powershell
rg -n "knownRequirementIDs|requirements\\?\\.map|architectValidationFindings|createArchitectOutputTools\\(" packages/opencorvus/src packages/opencorvus/test -g"*.ts"
```

| Surface | Current role | Repair |
| --- | --- | --- |
| `architect/agent.ts` | Passes `requirements?.map((requirement) => requirement.id)` as `knownRequirementIDs` into output tools. | Keep as the single source for known requirement IDs. No new requirement source. |
| `architect/output-tools.ts` | Validates unknown requirement IDs and acceptance specs that cite a requirement not claimed by the same goal. | Add blockers when any known requirement ID is absent from owning goals, absent from goal-local acceptance specs, or missing consistent traceability. |
| `architect/output-tools.ts#validate` | Shared readiness and submit validation closure. | Reuse it so terminal-tool exposure and `submit_architect` agree. |
| `architect/output-tools.ts#submit_architect` | Finalizes when blocker count is zero and reports concerns downstream. | Known REQ consumption findings must be blockers; fidelity/reference coverage remains advisory. |
| `architect-core.txt` | Already tells the model every `REQ-N` must be claimed by a capable goal. | Align text with the data-contract fix so prompt and terminal validation do not conflict. |
| `goal-workload-analyst` / `orchestrator` | Can flag decomposition concerns and re-dispatch Architect, but does not own the requirement coverage invariant. | Keep advisory. The root invariant belongs in Architect output validation. |
| `integrity` | Final audit catches rendered scope gaps after Build. | Keep as final audit. It must not be the first place missing REQ ownership is discovered. |
| Tests | Existing Architect tests cover unknown requirements and acceptance/claim mismatch. | Add regression tests for known requirements with no owning goal, including readiness and submit output. |
| `integrity/team-agent.ts` | Renders requirements/status into Integrity prompt and records schema-valid consensus reports. | Render every active REQ/status row and require each active REQ to be structurally touched by reviewer coverage, findings, or required repairs. |

## Selected Algorithm

1. Build `claimedRequirementIDs` from every registered goal's
   `requirement_ids`.
2. Build `acceptedRequirementIDs` from every registered
   `acceptance_specs[].source_requirement_id`.
3. When `knownRequirementIDs` is non-empty, compute:

   ```text
   missingOwnerRequirementIDs = knownRequirementIDs - claimedRequirementIDs
   missingAcceptanceRequirementIDs = knownRequirementIDs - acceptedRequirementIDs
   ```

4. If either set is non-empty, add blockers:
   - code: `missing_requirement_owner`
   - message: list the missing requirement IDs and say Architect must register
     or modify goals so each known requirement has at least one owning goal.
   - repair tools: `register_goal`, `modify_goal`.
   - code: `missing_requirement_acceptance`
   - message: list the missing requirement IDs and say Architect must register
     or modify goals so each known requirement has at least one goal-local
     acceptance spec.
   - repair tools: `register_goal`, `modify_goal`.
5. For known requirements, make missing or inconsistent `register_traceability`
   rows blockers. When no known requirement set exists, retain the older
   advisory behavior.
6. Reject invalid `register_traceability` tool calls before collector mutation:
   unknown requirement IDs, unknown goal IDs, and goal IDs that do not claim the
   requirement.
7. Do not infer surfaces from text, URLs, screenshots, or specific TradingView
   tokens. The only source is the structured requirement IDs already passed to
   Architect.
8. In Integrity, render every active requirement and requirement-status row into
   the initial prompt, with per-field truncation only. At terminal submit, require
   every active REQ-N to appear in at least one reviewer coverage row, finding, or
   required repair. Do not count free-text `coverageAudit.promise` as structured
   coverage.

This is a data integrity validation for the Architect goal graph, not a
fallback, compatibility path, visual hard gate, or hidden routing rule.

## Acceptance

- A graph with `knownRequirementIDs=["REQ-1","REQ-2","REQ-3"]` and goals
  claiming only `REQ-1` and `REQ-2` keeps `isReadyToFinalize()` false.
- `submit_architect` for that graph returns `BLOCKERS` containing
  `missing_requirement_owner` and the missing `REQ-3`.
- A graph that claims every known requirement but omits a goal-local acceptance
  spec for one known requirement is not ready to finalize.
- A graph that claims every known requirement and has acceptance specs, but omits
  traceability rows, is not ready to finalize when `knownRequirementIDs` is
  present.
- `register_traceability` rejects unknown requirements, unknown goals, and
  non-owner goal mappings without mutating the collector.
- A graph that claims every known requirement, has goal-local acceptance specs,
  and has traceability rows can finalize while visual/reference coverage remains
  advisory.
- Integrity initial prompt renders `REQ-9` when there are nine requirements and
  renders the corresponding requirement-status row, including `- no claiming
  goal` when applicable.
- `submit_integrity_consensus` rejects a report that omits any active REQ-N from
  reviewer coverage, findings, and required repairs.
- Existing explicit goal-count contract tests still pass.
- Existing no-hard-visual-gate tests still pass.
- Targeted Architect tests pass.

## Benchmark

Targeted regression command:

```powershell
bun test packages/opencorvus/test/architect/output-tools.test.ts packages/opencorvus/test/architect/agent.test.ts
bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts
bun test packages/opencorvus/test/integrity/team-agent.test.ts
```

Secondary review:

- Inspect `architectValidationFindings` after the change to confirm every
  blocker is data-shape / execution-graph integrity, not visual parity.
- Inspect the TradingView task database facts again if the result is ambiguous.
