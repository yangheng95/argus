# VS Code Extension 100-Round Benchmark

> Created: 2026-04-29
> Scope: `packages/vscode-extension`, `packages/transport-protocol`, and snapshot regression checks.

## Task Definition

Run unattended breadth testing for the VS Code extension for exactly 100 rounds. Each round must keep running even if an earlier check fails, record the failure, and continue searching for additional failures. The final process exit code is non-zero if any round has any failed check.

## Inputs And Outputs

Input:
- Local repository checkout at `c:\Users\chuan\myhexin-local\argus-opencode`.
- Existing workspace dependencies from the repository.
- Optional environment variables:
  - `VSCODE_BENCH_ROUNDS`: default `100`.
  - `VSCODE_BENCH_IDLE_MS`: default `120000`.
  - `VSCODE_BENCH_FULL_SNAPSHOT_EVERY`: default `25`.
  - `VSCODE_BENCH_BUILD_EVERY`: default `25`.
  - `VSCODE_BENCH_E2E_EVERY`: default `25`.
  - `VSCODE_BENCH_REPORT`: default `tmp/vscode-extension-100-round-report.jsonl`.

Output:
- JSON Lines report at `tmp/vscode-extension-100-round-report.jsonl`.
- Console progress for every command and round.
- Exit code `0` only if all checks in all rounds pass.

## Timeout Strategy

All subprocess checks use inactivity timeout. The timer resets on each stdout or stderr chunk. A command only times out when there is no process output for `VSCODE_BENCH_IDLE_MS`; the runner does not measure timeout from process start.

## Round Checks

Every round:
- `bun run --cwd packages/vscode-extension typecheck`
- `bun run --cwd packages/vscode-extension test`
- `bun test` in `packages/transport-protocol`
- Source guard scan for high-risk VS Code extension drift
- Snapshot smoke check via `SNAPSHOT_BENCH_ONLY=gc.no-destructive-api`

Every `VSCODE_BENCH_FULL_SNAPSHOT_EVERY` rounds:
- `bun test --timeout 60000 test/snapshot/snapshot.test.ts` in `packages/opencorvus`

Every `VSCODE_BENCH_BUILD_EVERY` rounds:
- `node esbuild.mjs --production --skip-ui` in `packages/vscode-extension`
- `bun run script/audit-bundle.ts` in `packages/vscode-extension`

Every `VSCODE_BENCH_E2E_EVERY` rounds:
- `bun run --cwd packages/vscode-extension test:e2e:vscode`
- The E2E command runs `node esbuild.mjs` first so `media/ui` is freshly synchronized from the overlay UI build output before VS Code launches.
- This starts a real VS Code Extension Host through `@vscode/test-electron`, opens the `opencorvus.open` command, verifies the OpenCorvus webview tab is visible, verifies the fake sidecar has listened, verifies at least one non-shutdown HTTP request reached the sidecar through the webview bridge, and verifies shutdown/exit events after VS Code closes.

## Acceptance Criteria

The benchmark is accepted only when:
- All 100 rounds complete.
- No check fails.
- No check times out by inactivity.
- Snapshot smoke runs in every round.
- Full snapshot regression runs at the configured cadence.
- VS Code UI/E2E runs at the configured cadence and produces sidecar event evidence.
- A report file exists and contains one `round-summary` record for each round.
- The final benchmark result is reviewed after the runner exits.

## Known Current Risks To Track

- `tmp/plan-vscode-extension.md` and `specs/new-arch/spec-vscode-extension.md` currently describe conflicting extension architectures. The implementation log in `tmp/vscode-extension-progress.md` is the active implementation record for the current sidecar-based work.
- Snapshot full regression is slow on Windows: current observed runtime is about 113 seconds for `packages/opencorvus/test/snapshot/snapshot.test.ts`.
- Snapshot benchmark plan says long-running project should exercise 100 track cycles, while the implementation currently uses 50 cycles. This remains a benchmark gap until corrected.
