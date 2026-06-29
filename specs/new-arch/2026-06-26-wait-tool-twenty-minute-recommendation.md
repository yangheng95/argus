# Wait Tool Twenty Minute Recommendation - 2026-06-26

## Objective

Change the `wait` tool's recommended one-shot pause to 20 minutes
(`1_200_000ms`) and make the tool description explicitly say that, when
executing a goal and `wait` is the responsible action, the default wait is that
single 20-minute pause. This prevents unattended runs from burning turns on
repeated one-minute waits.

## Recall

- `specs/orchestrator-no-decision-stop-2026-06-18.md` classifies `wait` as an
  observation/pause tool. It must not become a decision effect and must not be
  used as polling progress.
- `specs/new-arch/2026-06-24-read-context-drilldown-only.md` removed
  `read_context` as the normal post-wait refresh path. The current task
  snapshot is already injected on each orchestrator wake.
- The tool schema in `packages/opencorvus/src/tool/wait.ts` is the single
  source for the executable `duration_ms` bounds used by agent and
  orchestrator surfaces.

## Call-Point Sweep

Command basis:

```powershell
rg -n "ORCHESTRATOR_WAIT|WAIT_MAX|WAIT_MIN|duration_ms|wait\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.txt"
rg -n "duration_ms\s*[:=][^\n]*(60_000|60000|1_200|30_000|1200)|60_000|60000|one minute|1 minute|一分钟|1分钟|recommended|推荐" packages/opencorvus/src/tool packages/opencorvus/src/orchestrator packages/opencorvus/src/prompt packages/opencorvus/test/orchestrator packages/opencorvus/test/agent -g "*.ts" -g "*.txt"
```

| Surface                                                   | Decision                                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/tool/wait.ts`                    | Add `WAIT_RECOMMENDED_MS = 20 * 60 * 1000`; set `WAIT_MAX_MS` to the same value; update schema and description to recommend one 20-minute pause for real external waits, explicitly default goal-execution waits to that duration, and forbid repeated 60-second waits. |
| `packages/opencorvus/src/orchestrator/tools.ts`           | Keep deriving orchestrator wait bounds from `wait.ts`; expose the recommended value only if tests need an orchestrator-level contract. Do not add a second independent duration.                                                                                        |
| `packages/opencorvus/test/orchestrator/wait-tool.test.ts` | Update the bound test to 20 minutes and assert the description carries the 20-minute recommendation and anti-60-second chaining instruction.                                                                                                                            |
| Other `duration_ms` hits                                  | Unrelated capture metrics, test fixture waits, and browser timeout strings. Do not change.                                                                                                                                                                              |

## Acceptance

- `duration_ms=1_200_000` is inside the wait tool schema.
- `duration_ms>1_200_000` is rejected by the wait tool schema.
- The wait tool description tells the model that, during goal execution, the
  default deliberate pause is 20 minutes and not a repeated 60-second cadence.
- Orchestrator wait metadata remains `observation`.
- Focused wait tool tests pass.
