# Mission Benchmark Plan - 2026-06-01

## Objective

Add a benchmark focused on OpenCorvus Mission mode. The benchmark must exercise the Mission agent as a coordinator, not as a direct coding executor:

1. Wake a mission through `POST /mission/wake`.
2. Require the mission to perform a simple investigation, then dispatch project implementation work, then verify the resulting project.
3. Re-wake the same mission after dispatched work reaches a terminal state so Mission reconciles `tasks.md` through `panel.query_task`.
4. Report whether Mission state, Mission -> Squad task provenance, dispatched task completion, and local verification all passed.

## Grep Evidence

| Surface | Evidence | Decision |
| --- | --- | --- |
| Mission route | `packages/opencorvus/src/server/routes/mission.ts` defines `POST /mission/wake` and returns `{ missionID, sessionID, created }`. | Use the existing route. Do not add a second wake route. |
| Mission session | `packages/opencorvus/src/mission/session.ts` stores `metadata.mission.{id, channelKey, cwd}` and keys one session per `(project, missionID)`. | Read mission state from `.opencorvus/runtime/mission/<missionID>/`. |
| Mission durable memory | `packages/opencorvus/src/tool/mission-state.ts` exposes exactly `frontier.md`, `tasks.md`, `handoff.md`, `notes.md`. | Benchmark checks those files instead of inventing a second state store. |
| Dispatch surface | `packages/opencorvus/src/tool/panel.ts` permits Mission `create_task` and `query_task`, and stamps `source: "mission"` plus `metadata.actor` / `metadata.mission`. | Benchmark validates provenance from `/tasks`, not from free-text transcript guesses. |
| Existing benchmark infra | `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` already starts `Server`, prepares config, uses `/task`, and writes JSON reports. | Add a separate `mission-benchmark.ts` because mission has a different root entity and completion loop. Reuse env/model helper module. |
| Existing tests | `packages/opencorvus/test/mission/*`, `test/tool/mission-state.test.ts`, `test/panel/*` pin route/session/tool/provenance units. | Add benchmark contract tests only for the new benchmark scenario and script wiring. |

## Files

| File | Change |
| --- | --- |
| `packages/opencorvus/script/benchmark/mission-scenario.ts` | Export the default mission benchmark prompt, expected stages, helper predicates, and report evaluation. |
| `packages/opencorvus/script/benchmark/mission-benchmark.ts` | New executable benchmark. Starts an isolated server/project, wakes Mission, waits for Mission-dispatched tasks, re-wakes for reconciliation, runs local verification, writes report. |
| `packages/opencorvus/test/benchmark/mission-benchmark.test.ts` | Static/contract tests for the benchmark scenario and route wiring. |
| `docs/product/zh-CN/operations/benchmark.md` and `docs/product/en/operations/benchmark.md` | Document the new mission benchmark entry point and its pass criteria. |

## Acceptance

- Default benchmark request explicitly contains the three required stages: simple investigation, project implementation, and project test.
- The executable script calls `/mission/wake`, not `/gateway/master/wake`.
- The script rejects a run with no Mission-dispatched task carrying `source: "mission"` and `metadata.mission.id`.
- The script wakes the same mission ID a second time for reconciliation.
- Targeted tests pass with `bun test test/benchmark/mission-benchmark.test.ts`.
