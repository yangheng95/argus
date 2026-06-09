# LLM activity first-byte and zombie revive loop fix

## Evidence

- Task `tsk_ddce114530016Cd8DvYqoxvn2t` produced no plan versions, goals, milestones, workflow steps, runs, or goal runs.
- It produced repeated `engine_artifact.kind = "orchestrator-stream-error"` rows about every 0.5 seconds.
- Each payload carried the same immediate processor error:
  `LLMActivityPolicy: firstByteMs (60000ms) must be >= idleMs (180000ms)`.
- The task sessions tree showed repeated orchestrator child sessions with only the original user text part. The model call never reached upstream streaming.

## Root Cause

There are two coupled defects.

1. `withLLMActivity` rejects the production defaults before any provider call. The invariant is wrong: `firstByteMs` and `idleMs` gate different phases. The first-byte gate runs before the first upstream event; the idle gate starts only after the first upstream event. Therefore `firstByteMs < idleMs` is valid and desirable.
2. `reviveZombieTasks` resumes every active task with no in-flight loop. That is correct only when the loop vanished without a recorded terminal fact. When the latest wake already wrote an `orchestrator-stream-error`, automatic revive contradicts `recordOrchestratorStreamError`'s contract and creates a restart loop.

## Grep Coverage

| Target                      | Existing call sites / siblings                                                                                                                                                                   | Change                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `firstByteMs`               | `src/llm/activity.ts`, `src/session/processor.ts`, `src/frontend-design/tools/webpage-vision-judge.ts`, `test/llm/activity.test.ts`, `specs/new-arch/2026-04-30-llm-activity-redesign.md`        | Remove the false ordering invariant; add tests that production defaults and `firstByteMs < idleMs` are accepted.                     |
| `orchestrator-stream-error` | `src/orchestrator/agent.ts`, `src/engine/persist.ts`, `src/engine/runtime.ts`, `src/engine/engine.sql.ts`, `src/engine/store.ts`, `src/storage/ddl.ts`, `test/engine/zombie-task-revive.test.ts` | Keep artifact as the single explicit stream-error fact; make zombie revive skip tasks with a stream-error recorded after task start. |
| `reviveZombieTasks`         | `src/engine/runtime.ts`, `test/engine/zombie-task-revive.test.ts`                                                                                                                                | Preserve crash/no-fact zombie recovery; stop automatic replay once an explicit stream-error exists.                                  |

## Implementation

- `src/llm/activity.ts`: keep positive finite validation only; document phase separation.
- `test/llm/activity.test.ts`: replace the invalid-policy test with two accepted-policy tests.
- `specs/new-arch/2026-04-30-llm-activity-redesign.md`: correct the policy contract.
- `src/engine/runtime.ts`: add a structured artifact check before zombie revive.
- `test/engine/zombie-task-revive.test.ts`: pin the explicit stream-error guard.
