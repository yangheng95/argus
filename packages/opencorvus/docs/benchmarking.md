# OpenCorvus Benchmarking

## Layout

All runnable benchmark scripts live under [script/benchmark](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark):

- [agent-quality-benchmark.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/agent-quality-benchmark.ts)
- [channel-v1-benchmark.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/channel-v1-benchmark.ts)
- [overlay-stream-benchmark.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/overlay-stream-benchmark.ts)
- [overlay-web-benchmark.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/overlay-web-benchmark.ts)
- [env.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/env.ts)

## Env Loading

Benchmark scripts and benchmark-style live tests auto-load `.env` before resolving models or credentials.
Live benchmarks first honor `OPENCORVUS_BENCHMARK_MODEL`, and otherwise default to `alibaba-coding-plan-cn/kimi-k2.5` when that model is available.

Load order:

1. repo root `.env`
2. `packages/opencorvus/.env`
3. current working directory `.env`

Shell env still wins over file-loaded values. The helper also normalizes DashScope aliases into `DASHSCOPE_API_KEY` and `ALIBABA_CODING_PLAN_API_KEY`.

## Commands

Run from [packages/opencorvus](/D:/myhexin-local/argus-opencode/packages/opencorvus):

```bash
bun run benchmark:agent-quality
bun run benchmark:channel-v1
bun run benchmark:overlay-stream
bun run benchmark:overlay-web
```

Direct script entrypoints:

```bash
bun run script/benchmark/agent-quality-benchmark.ts
bun run script/benchmark/channel-v1-benchmark.ts --report=channel-v1-benchmark-report.json
bun run script/benchmark/overlay-stream-benchmark.ts --report=overlay-stream-benchmark-report.json
bun run script/benchmark/overlay-web-benchmark.ts --report=overlay-web-benchmark-report.json
```

Benchmark-related tests:

```bash
bun test test/benchmark/agent-quality.test.ts --timeout 300000
bun test test/e2e/full-pipeline.test.ts --timeout 120000
```

## Common Flags

`channel-v1-benchmark.ts`

- `--report=<file>`: write JSON report to a fixed path
- `--keep`: keep temp config and temp project

`overlay-web-benchmark.ts`

- `--report=<file>`: write JSON report to a fixed path
- `--timeout-ms=<ms>`: override end-to-end timeout, default 480000
- `--mode=full|materialize`: `full` requires final delivery acceptance; `materialize` only requires pending visibility, streamed output, and task/board materialization
- `--executor=opencode|codex|claude-code`
- `--request-file=<file>`: load the task request from a file
- `--title=<text>`: override the benchmark title in reports
- `--planning-timeout-ms=<ms>`: override the pending-task/stream visibility timeout
- `--task-create-timeout-ms=<ms>`: override the task materialization timeout
- `--verify-cmd=<cmd>`: run a custom local verification command in the temp project
- `--skip-local-verify`: skip local verification and rely on task evaluation only
- `--headed`: run browser visibly
- `--keep`: keep temp home and temp project

`overlay-stream-benchmark.ts`

- `--report=<file>`: write JSON report to a fixed path
- `--timeout-ms=<ms>`: override end-to-end timeout, default 480000
- `--headed`: run browser visibly
- `--keep`: keep temp home and temp project

## Output

- `channel-v1-benchmark.ts` writes a JSON step report.
- `overlay-stream-benchmark.ts` writes a JSON end-to-end report for real overlay parallel task execution, including parallel dispatch, streaming growth, reload recovery, and final delivery acceptance.
- `overlay-web-benchmark.ts` writes a JSON report and a browser screenshot.
- Both default to writing artifacts into the current working directory unless `--report` is provided.

## Notes

- Live scripts mutate temp projects only; they do not run inside the current workspace.
- `overlay-stream-benchmark.ts` is deterministic and local: it uses a benchmark coding executor plus a plugin-supplied evaluator analysis hook, so it does not rely on external LLM services.
- `overlay-web-benchmark.ts` validates the actual overlay web UI, not just HTTP routes.
- `full-pipeline.test.ts` and `agent-quality.test.ts` now consume the same env bootstrap as the scripts, so model selection is consistent between tests and benchmarks.
