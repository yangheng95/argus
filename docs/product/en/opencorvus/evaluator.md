# Acceptance Checks and Verdict

> **Important change (2026-05)**: The old `evaluator` agent and `src/acceptance/checks/` directory have been **removed entirely**. The "determine whether a deliverable is acceptable" responsibility they previously held is now fulfilled by the **Acceptance review** + `src/acceptance/checks/` modules; verdict artifacts are persisted as `engine_artifact[kind="evaluation" | "verdict" | "verification-evidence"]`. This page retains URL compatibility; content has been replaced with the new model.

## Two-stage verification

### Stage 1: deterministic checks

The Acceptance review resolves the current task's check family via `acceptance/checks/discovery.ts` and runs checks in the following order:

1. **Extract commands from `done_definition` / `check_selectors`** — parse commands declared on Goal / Requirement metadata (`bun run typecheck`, `bun test`, `pytest`, etc.); run them directly; trust exit codes. Commands must come from structured metadata — **never inferred from keywords** (see `check/policy.ts::inferSelectors`, which returns an empty array by design).
2. **Project discovery** — walk up from `owned_paths` to find the nearest `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`; auto-detect build / test / lint commands. Exact rules live in `acceptance/checks/project-gate.ts` and `acceptance/checks/runtime-readiness.ts`.
3. **Semantic criteria** — plain-text criteria that cannot be executed (e.g., "conforms to architecture spec") contribute only as evidence; they do not affect pass/fail.

### Stage 2: LLM judge

Engaged **only when deterministic checks cannot decide** (e.g., no executable tests, or a UI visual fidelity judgment). Visual rendering evidence uses `runtime/visual-page.ts`; content fingerprint helpers live under `acceptance/checks/content-fingerprint.ts`. Integrity review aggregates the final acceptance verdict.

## CheckSelector

Allowed selector list (`packages/opencorvus/src/check/policy.ts:3`, the single authoritative source):

```
build · test · lint · verify_cmd · ui_review · code_quality ·
code_review · dead_code_review · startup · spec_check
```

`CheckFamily` (`policy.ts:17`) is a subset of selectors: `build · test · lint · verify_cmd`, used for generic family matching.

> Selectors must be explicitly declared in a spec requirement's `check_selectors` field or in the architect's structured output — **inference from keywords is prohibited** (`policy.ts:24`).

## Configuration

Configure via `assistant.acceptance.*` / `assistant.acceptance_visual.*` in `opencorvus.jsonc`. The old `assistant.evaluator.tier` field no longer exists:

- `acceptance.max_retries` — maximum remediation attempts in the acceptance phase
- `acceptance_visual.*` — numeric hard-threshold values for visual judgment
- Full schema: [05-config.md](../../../specs/new-arch/05-config.md)

## `selectorsSatisfied` semantics

Key implementation at `check/policy.ts:45`:

```
1. Filter out checks where status === "skipped"
2. Every declared selector must have at least one matched and passed active check
3. Unexecuted selectors never count as passed
```

**Note**: not-run ≠ passed. This prevents "silently skip build and declare accepted".

## Verdict semantics

Verdicts are persisted as `engine_artifact[kind="verdict"]`:

| verdict        | Next action                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`     | `deliver` completes the task directly; if additional artifacts (patch / git preview) are needed, call `publish_acceptance` explicitly for post-acceptance artifact export |
| `rejected`     | Remediation via `acceptance-retry-feedback.ts`; once `acceptance.max_retries` is exceeded, the Orchestrator decides whether to retry / replan / fail                      |
| `inconclusive` | Treated as rejected, but prefers replan (an inability to decide usually means incomplete information or a doom-loop)                                                  |

The Acceptance review is responsible only for verdicts and evidence. Starting / stopping / retrying / cancelling / failing the current task, and publishing new follow-up tasks, are Orchestrator lifecycle authority. If Acceptance determines the work should be split into a new task, it can only recommend this in verdict evidence — it cannot create the task directly.

## Relationship to benchmarks

A benchmark `qualityVerdict === "accepted"` now means the acceptance review has written a verdict artifact of `accepted` and the `verification-evidence` satisfies `required_check_pass_rate > 0` (`script/benchmark/quality-gates.ts`).

## Prosecutor / Integrity review

`accepted` candidates may undergo a further independent review by two agents, but neither is an internal Acceptance step or an automatic acceptance gate:

- **Integrity Reviewer** (`integrity/agent.ts`): a multi-dimension review explicitly invoked by the Orchestrator (requirement_fidelity / technical_feasibility / hallucination / solution_quality); results land in `engine_artifact[kind="integrity_attempt"]`. Acceptance does not automatically run or consume it as an internal gate; evidence for fixing a Acceptance rejection should go directly into the next build round.
- **Prosecutor** (`prosecutor/agent.ts`): adversarial review; results land in `engine_artifact[kind="prosecutor_attempt"]`.

Both are invoked actively by the Orchestrator via tool calls — not part of an automatic pipeline.

## Known traps

1. **Empty output → `inconclusive`**: when the executor returns an empty string, it must be marked `inconclusive`, **not** accepted (historical bug: empty output was treated as "no problems → pass").
2. **Build check skipped**: if a worktree merge fails (`EEXIST`), the build cannot run — must not be passed over; mark it rejected.
3. **TypeScript errors undetected**: ensure the spec's `check_selectors` includes `lint` or an explicit `typecheck` family.

## What's next

- [Configuration](./configuration.md)
- [Benchmark](../operations/benchmark.md)
- [Troubleshooting](../operations/troubleshooting.md)
- Full agent family: [specs/new-arch/01-agents.md](../../../specs/new-arch/01-agents.md)
