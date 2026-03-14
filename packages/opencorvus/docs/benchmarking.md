# OpenCorvus Benchmarking

## Layout

All runnable benchmark scripts live under [script/benchmark](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark):

- [agent-quality-benchmark.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/agent-quality-benchmark.ts)
- [channel-v1-benchmark.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/channel-v1-benchmark.ts)
- [overlay-web-benchmark.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/overlay-web-benchmark.ts)
- [env.ts](/D:/myhexin-local/argus-opencode/packages/opencorvus/script/benchmark/env.ts)

## Env Loading

Benchmark scripts and benchmark-style live tests auto-load `.env` before resolving models or credentials.

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
bun run benchmark:overlay-web
```

Direct script entrypoints:

```bash
bun run script/benchmark/agent-quality-benchmark.ts
bun run script/benchmark/channel-v1-benchmark.ts --report=channel-v1-benchmark-report.json
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
- `--timeout-ms=<ms>`: override end-to-end timeout
- `--executor=opencode|codex|claude-code`
- `--headed`: run browser visibly
- `--keep`: keep temp home and temp project

## Output

- `channel-v1-benchmark.ts` writes a JSON step report.
- `overlay-web-benchmark.ts` writes a JSON report and a browser screenshot.
- Both default to writing artifacts into the current working directory unless `--report` is provided.

## Notes

- Live scripts mutate temp projects only; they do not run inside the current workspace.
- `overlay-web-benchmark.ts` validates the actual overlay web UI, not just HTTP routes.
- `full-pipeline.test.ts` and `agent-quality.test.ts` now consume the same env bootstrap as the scripts, so model selection is consistent between tests and benchmarks.
