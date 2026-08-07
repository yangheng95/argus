# Terminal Tool Scoping Retirement (2026-07-17)

## Recall

- User requirement: terminal/tool scoping was explicitly ordered deleted because hiding repair tools is an ostrich-style host gate; remove it instead of refining its predicate.
- Triggering evidence: Task `tsk_f701a2c86001mSRfcwOeS0urEy` persisted eight Architect goals, then the next model turn received only `submit_architect`; the required assembly owner, seven graph contracts, and twelve dependency contracts could no longer be registered. Structural re-entry inherited the eight goals and was terminal-only from its first turn.
- Acceptance: no runtime contract may remove work tools or hard-pin one terminal tool from a readiness predicate; terminal collectors still detect completion and missing-finalizer recovery still uses the same session; Architect and Research retain their complete projected tool surfaces until the terminal tool actually succeeds.
- Hard constraints: do not add a graph-count gate, a Mirror Watch-specific host rule, fallback, compatibility alias, state machine, or synthetic message. Build artifacts must not be committed or uploaded.
- Read sources: `AGENTS.md`; `specs/records/2026-06/2026-06-26-architect-explicit-goal-count-contract.md`; commits `883aef76f`/`c46303b0e` (2026-05-14 removal) and `0b02088dd` (2026-06-23 reintroduction); current Task/session evidence for `tsk_f701a2c86001mSRfcwOeS0urEy`.
- Whole-repository search: `shouldExposeOnlyTerminalTool` occurs in the generic runtime contract/loop/runner, Architect, Research, Goal Workload Analyst, all terminal-agent adapters (mostly constant `false`), and their tests. `applyTerminalToolExposure` is owned only by `session/loop.ts` and its recovery tests. `terminalToolChoice` is the second effective scoping path because it selects one named terminal tool when the same predicate flips true.
- Independent-agent feedback: none; the user did not request sub-agents and the active execution policy forbids unsolicited delegation.

## Root Cause and History

The user-directed removal landed on 2026-05-14 as `Remove terminal tool scoping`. On 2026-06-23, `Fix research finalizer continuation recovery` restored in-place tool deletion for Research readiness and made it generic. Later Architect and Goal Workload Analyst reused the same predicate. The regression therefore did not survive because the original request was ambiguous; a later recovery change reintroduced the deleted mechanism and its tests explicitly blessed terminal-only exposure.

The current implementation has two host gates:

1. `applyTerminalToolExposure` deletes every tool except the finalizer.
2. `terminalToolChoice` selects the named finalizer when readiness is true, making the other visible tools unusable for non-reasoning providers.

Both must be retired. A collector's `isSatisfied` fact remains a data-completion signal. It may stop a completed session, but a pre-completion readiness heuristic may not mutate or constrain the model's tool surface.

## Callpoint Disposition

| Surface | Disposition |
| --- | --- |
| `session/runtime-contract.ts` | Delete `shouldExposeOnlyTerminalTool` from `TerminalToolContract`. |
| `agent/runner.ts` | Delete the readiness callback from the public runner input and runtime projection. Preserve `isSatisfied`. |
| `session/loop.ts` | Delete terminal-only tool deletion, readiness-only prompt injection, and named-finalizer tool choice. Keep terminal success stopping and missing-finalizer evidence/recovery. |
| Architect / Research / Goal Workload Analyst agents | Delete readiness callbacks; do not replace them with host validation gates. |
| Other terminal-agent adapters | Delete the constant-false compatibility field. |
| Output-tool comments | Remove claims that readiness exists to drive terminal scoping; retain validators used by explicit submit tools where independently useful. |
| Tests and fixtures | Replace scoping assertions with assertions that all work tools stay visible and that non-reasoning providers request any tool rather than one named finalizer. Remove obsolete callback fixtures and add Architect/Research runner-contract coverage. |
| Historical June spec | Preserve as history; this record supersedes its instruction to keep terminal scoping unchanged. |

## Verification

- `rg -n "shouldExposeOnlyTerminalTool|applyTerminalToolExposure" packages/opencorvus/src packages/opencorvus/test` returns no matches.
- Targeted Session, Architect, Research, Requirements, runner, provider, and runtime-contract tests pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passes after index updates.
- Typecheck and relevant repository checks pass before commit/push.

## Validation Results

- Whole-source scan: no `shouldExposeOnlyTerminalTool`, `applyTerminalToolExposure`, or `terminalToolSystemPrompt` reference remains in production or test TypeScript.
- Targeted runtime suite: 128 passed, 0 failed across Session loop/recovery, runner, runtime contracts, Architect, Research, Requirements, provider request-body, and Frontend Research coverage.
- `packages/opencorvus` TypeScript check: passed.
- Historical documentation health: 21 passed, 0 failed.
- Production dead-code check: passed after deleting the now-unreferenced terminal reminder fragment.
- `git diff --check`: passed.
