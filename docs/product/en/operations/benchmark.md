# Benchmark

The benchmark harness provides **end-to-end quality regression**. It simulates a real request from creation to acceptance and emits `qualityVerdict` (accepted / rejected) as the pass signal.

## Main script

`packages/opencorvus/script/benchmark/overlay-web-benchmark.ts`

Mission mode has a separate benchmark because the root entity is a Mission
session rather than a direct task:

`packages/opencorvus/script/benchmark/mission-benchmark.ts`

## Minimal run

```bash
cd packages/opencorvus

CODING_DASHSCOPE_API_KEY=sk-sp-... \
ALIBABA_CODING_PLAN_API_KEY=sk-sp-... \
DASHSCOPE_API_URL=https://coding.dashscope.aliyuncs.com/v1 \
bun run script/benchmark/overlay-web-benchmark.ts \
  "--request-file=/path/to/prd.txt" \
  "--report=.scratch/benchmark-runs/report.json"
```

**Note**: flags support either `--name=value` or `--name value`. Unknown flags exit with code 2.

## Mission Mode

The Mission benchmark wakes `POST /mission/wake`, waits for Mission to dispatch
Squad work through `panel.create_task`, waits for the dispatched task to reach a
terminal state, then wakes the same mission ID again so Mission reconciles with
`panel.query_task`.

Default flow:

1. Simple investigation of the scratch project.
2. Write a minimal TypeScript utility project.
3. Run project tests with `bun test`.

```bash
cd packages/opencorvus

CODING_DASHSCOPE_API_KEY=sk-sp-... \
ALIBABA_CODING_PLAN_API_KEY=sk-sp-... \
DASHSCOPE_API_URL=https://coding.dashscope.aliyuncs.com/v1 \
bun run script/benchmark/mission-benchmark.ts \
  "--report=.scratch/benchmark-runs/mission-report.json"
```

Pass criteria: populated mission state files, at least one task with
`source=mission` and `metadata.mission.id`, terminal completed task status,
accepted evaluation when present, and a passing local verification command.

## Key flags

| flag                                                                       | purpose                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `--request-file=PATH`                                                      | task description file (template)                                                |
| `--request-attachment=PATH`                                                | attach a file instead of using `--request-file`; the two are mutually exclusive |
| `--reference-images=PATH`                                                  | visual comparison reference image                                               |
| `--figma-url=URL`                                                          | Figma design URL                                                                |
| `--model`                                                                  | **not accepted**; use environment/config model selection instead                |
| `--executor=opencorvus\|codex\|claude-code`                                | executor: OpenCorvus / Codex / Claude Code                                      |
| `--title=TITLE`                                                            | task title                                                                      |
| `--report=PATH`                                                            | output JSON report                                                              |
| `--max-runs=N`                                                             | maximum runs                                                                    |
| `--max-fix-runs=N`                                                         | maximum repair runs                                                             |
| `--max-executor-groups=N`                                                  | maximum parallel executor groups                                                |
| `--max-auto-resumes=N`                                                     | automatic resume attempts after failed/cancelled terminal status                |
| `--acceptance-verify-cmd=CMD`                                              | custom acceptance verification command                                          |
| `--resume-task-id=TID` / `--resume-home-dir=DIR` / `--resume-message=TEXT` | resume mode                                                                     |
| `--no-keep`                                                                | delete tmp directory on finish                                                  |
| `--skip-local-verify`                                                      | skip local re-verification                                                      |
| `--no-browser`                                                             | **do not use** for visual benchmark runs; it bypasses overlay UI rendering      |

> ~~`--stall-timeout-ms`~~ / ~~`--planning-stall-timeout-ms`~~ / ~~`--tool-timeout-ms`~~ are no longer accepted. The engine stream-activity watchdog owns inactivity aborts.

## Env injection upfront

`Env.state()` snapshots `process.env` on instance creation; late-loaded `.env` values are missed. That's why benchmark commands inject env explicitly.

## Pass criteria

Report JSON:

```json
{
  "qualityVerdict": "accepted",
  "localVerify": { "exitCode": 0 },
  "required_check_pass_rate": 1.0
}
```

Source: `packages/opencorvus/script/benchmark/quality-gates.ts`.

## Timeout semantics

All timeouts are **inactivity timeouts**. As long as stdout/stderr/SSE is flowing, the stall timer resets. Long build/test runs are fine; truly hung tasks surface quickly. **Do not** read them as wall-clock timeouts.

## Baseline reference

Historical baseline:

- glm-5 (2026-03-09): 90% avg, 5/5 pass, 174-254s per task
- E1:254s, E2:215s, E3:174s, E4:173s, E5:193s

## Report structure

`--report` JSON contains:

- Task metadata (title, model, executor)
- Per-stage duration (spec / goals / plan / execute / evaluate / deliver)
- Per-goal check results
- `qualityVerdict` and `localVerify`
- Failure samples: stdout/stderr tails + artifact paths

## CI usage

```yaml
- name: Benchmark
  env:
    CODING_DASHSCOPE_API_KEY: ${{ secrets.DASHSCOPE_KEY }}
  run: |
    cd packages/opencorvus
    bun run script/benchmark/overlay-web-benchmark.ts \
      "--request-file=benchmarks/smoke.txt" \
      "--report=.scratch/benchmark-runs/report.json"
```

## E2E eval suite

`packages/opencorvus/script/eval-e2e.ts` is a finer-grained eval suite for daily regression. Start the server first:

```bash
cd packages/opencorvus
DASHSCOPE_API_KEY=sk-... OPENCORVUS_CHANNEL=local \
  bun run --preload @opentui/solid/preload --conditions=browser \
  src/index.ts serve --port 7878
```

Then `bun run script/eval-e2e.ts`.

The server **must** have `DASHSCOPE_API_KEY`; without it, executor returns empty responses and every task fails in <10s.
