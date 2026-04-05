# Unified Implementation Plan — candidate-clean alignment

**Base commit**: `1be31dddd` (2026-04-05 16:14 — confirmed correct behavior)
**Design reference**: `specs/new-arch.svg`
**Branch**: `candidate-clean`

## Architecture Audit Result

candidate-clean **is fully aligned** with `new-arch.svg` design:

| Layer | Component | File | Status |
|-------|-----------|------|--------|
| Coordinator | Task Agent (sole decision-maker) | `task-agent/agent.ts` | ✓ |
| Sub-agents | Requirements (decompose) | `decompose/agent.ts`, `decompose/output-tools.ts`, `decompose/fidelity.ts` | ✓ |
| Sub-agents | Architect | `architect/agent.ts`, `architect/output-tools.ts` | ✓ |
| Sub-agents | Planner (per-goal) | `planner/per-goal.ts` | ✓ |
| Sub-agents | Evaluator (per-goal) | `evaluator/per-goal.ts` | ✓ |
| Infrastructure | Task Control Loop | `orchestrator/task-loop.ts` | ✓ |
| Infrastructure | GoalPool (queue-based) | `orchestrator/goal-pool.ts` | ✓ |
| Infrastructure | Goal pipeline | `pipeline/executor.ts` | ✓ |
| Infrastructure | Merge serialization | `goal/merge.ts` | ✓ |
| Infrastructure | Scheduler (DAG) | `goal/scheduler.ts` | ✓ |
| Infrastructure | PID Guard | `shell/pid-guard.ts` | ✓ |
| Infrastructure | Decision Log | `decision-log/` | ✓ |
| Overlay bridge | overlayMeta + enrichProperties | `server/routes/task-message-protocol-bridge.ts` | ✓ |
| Overlay bridge | GlobalBus cross-Instance subscription | same file | ✓ |
| Overlay bridge | Task event registry (role + goalID) | `server/routes/task-event.ts` | ✓ |
| Hygiene | .gitignore excludes benchmark artifacts | `packages/opencorvus/.gitignore` | ✓ |

## Gaps to Close (Two Targeted Fixes)

### Fix 1 — Lazy `Global.Path` Resolution (CRITICAL)

**Problem**: `Global.Path.data/cache/state` are computed **at module load time** from `process.env.OPENCORVUS_HOME`. The benchmark script sets `OPENCORVUS_HOME` AFTER static imports have already resolved the paths to the default xdg location. Result: benchmark DB writes leak into the user's real `~/.local/share/opencorvus/opencorvus.db`.

**Root cause chain**:
```
script/benchmark/overlay-web-benchmark.ts
  → import ./quality-gates         (static)
  → import src/orchestrator/model   (static)
  → import @/snapshot               (static)
  → import @/global                 (loads Global.Path w/ empty OPENCORVUS_HOME)
```

**Fix**: Convert `Global.Path.data/cache/state/bin/log/config/home` to **getters** that re-read `process.env.OPENCORVUS_HOME` on each access. Convert `Database.Path` from constant to function. Add `mkdirSync` to ensure data dir exists before opening DB.

**Files**:
- `packages/opencorvus/src/global/index.ts` — getters instead of module-level constants
- `packages/opencorvus/src/storage/db.ts` — `Path()` function, `mkdirSync` before open
- `packages/opencorvus/src/cli/cmd/db.ts` — call sites use `Database.Path()`
- `packages/opencorvus/test/fixture/db.ts` — call sites use `Database.Path()`

**Acceptance**: Benchmark log shows DB path `{OPENCORVUS_HOME}/data/opencorvus.db` (not `~/.local/share/opencorvus/opencorvus.db`).

### Fix 2 — Vcs.Info Init State + Commit Display

**Problem**: Overlay's "init git" button perpetually shows even after git init; never displays commit state. Contract mismatch: frontend reads `vcs.initialized` which backend never sends.

**Fix**: Add `initialized: boolean` and `commit: string` to `Vcs.Info` Zod schema. Read `.git` directory presence directly (bypass Instance cache). Detect unborn HEAD by checking `git rev-parse --short HEAD` returns empty. Suppress default branch name when no commits exist. Call `Instance.refresh()` after `Project.initGit` via dynamic import (circular dep avoidance). Display `@commit` suffix in overlay git label.

**Files**:
- `packages/opencorvus/src/project/vcs.ts` — schema + parse + info()
- `packages/opencorvus/src/project/project.ts` — refresh after initGit
- `packages/overlay/src/services/meta.ts` — git label + title formatting
- `packages/overlay/src/i18n/en-US.json`, `zh-CN.json` — `git.commit` key

**Acceptance**: After `git init`, overlay git button shows branch name + commit hash, not stuck at "init git".

## Verification Protocol

1. **Baseline verified** (2026-04-05 22:37): candidate-clean runs benchmark, bridge stamps `resolvedRole` correctly, but DB path = `~/.local/share/opencorvus/opencorvus.db` (confirming Fix 1 needed).

2. **After Fix 1**: rerun benchmark, verify log shows `{OPENCORVUS_HOME}/data/opencorvus.db`.

3. **After Fix 2**: manually init git in overlay workspace, verify button transitions to branch display.

4. **Full benchmark success criteria** (per CLAUDE.md):
   - `qualityVerdict: "accepted"`
   - `localVerify exitCode: 0`
   - Bridge stamps work (`resolvedRole` / `channel` in logs)
   - Executor cards group per goal in overlay

## Critical Invariants (Must Not Break)

1. Bridge must keep:
   - `overlayMeta()`, `enrichProperties()`, `GlobalBus.on("event", ...)` subscription
   - `Instance.provide({ directory: hostDirectory, fn: ... })` for cross-Instance events

2. task-event.ts registry must be `Map<string, { taskID, role, goalID? }>` with `sessionRole()` + `sessionGoalID()` exports.

3. `.gitignore` must exclude `overlay-web-benchmark*`.

4. All timeouts must be inactivity-based (per design principle). No absolute/hard timeouts.

5. No fire-and-forget (per design principle). All agent calls awaited within Task Control Loop.

## Benchmark Command

```bash
cd packages/opencorvus
OPENCORVUS_DISABLE_DEFAULT_PLUGINS=1 \
CODING_DASHSCOPE_API_KEY=sk-sp-40eeacbb1d2848a4829dca771f2ed51a \
ALIBABA_CODING_PLAN_API_KEY=sk-sp-40eeacbb1d2848a4829dca771f2ed51a \
DASHSCOPE_API_URL=https://coding.dashscope.aliyuncs.com/v1 \
OPENCORVUS_MAX_EXECUTOR_GROUPS=2 \
bun run script/benchmark/overlay-web-benchmark.ts \
  "--request-file=D:\myhexin-local\argus-opencode\specs\prd-overlay-web-request-v2.txt" \
  "--stall-timeout-ms=1200000" \
  "--planning-stall-timeout-ms=7200000" \
  --headed
```

## Branch Topology

- `candidate` — broken (bridge removed, mis-labeled squash)
- `candidate-rescue` — first rescue attempt (based on f2a666616)
- `candidate-clean` — **WORKING BRANCH** (based on 1be31dddd)
- `dev` — main dev branch (untouched)
