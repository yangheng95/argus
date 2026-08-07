# 2026-07-11 Stale Project Expert Squad Repair

## Recall

### User Request

- 修复项目无法创建或进入的问题。
- 截图中的失败项目目录为 `C:\Users\chuan\myhexin-local\demos\economy\futures`。

### Acceptance Criteria

1. `futures` 项目内所有已安装专家团 package 使用当前严格 manifest 契约：`base_role` 与 `inherit_base_tools`。
2. 项目内不再存在旧 `role_base` 字段，也不增加兼容解析或 fallback。
3. package 替换必须走 `ExpertSquadPackageManager.importDirectory({ replace: true })` 的显式更新路径。
4. 更新后的 package 必须通过当前 `ExpertSquadRegistry` 真实 discovery/validation。
5. 使用独立 API 进程验证该目录的项目配置与会话入口，不重启、刷新或关闭当前 OpenCorvus/Overlay。

### Hard Constraints

- 不覆盖或回退主仓库现有未提交修改。
- 不修改 `futures` 的产品源码；只替换其 `.opencorvus/expert-squads/<namespace>/<id>` package。
- 不保留旧 package、旧字段或双源目录。
- 不创建 worktree；不操作当前运行进程。
- 测试超时按 stdout/stderr 无活动时间计算。

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-09-external-expert-squad-schema-base-role.md`
- `specs/records/2026-07/2026-07-10-provider-settings-contract-repair.md`
- Current registry, package manager, payload, server route, source package, and target project package files.

### Whole-Repository Grep Evidence

- `rg -n "role_base|base_role|inherit_base_tools" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07`
  - Current registry requires `base_role` and `inherit_base_tools`; old `role_base` appears only in rejection tests and historical records.
- `rg -n "install|release|overwrite|existing|replace|update" packages/opencorvus/src/expert-squad/manager.ts packages/opencorvus/src/server/routes/expert-squad.ts`
  - Automatic payload release intentionally skips existing packages; explicit directory/archive import supports atomic `replace: true` with backup/restore.
- `rg -n --hidden "role_base|base_role|inherit_base_tools" C:\Users\chuan\myhexin-local\demos\economy\futures\.opencorvus`
  - Every installed non-general package is an old 2026-07-05 package using `role_base`; this directly matches the strict parser error returned by `/session/:id/config`.
- `rg -n "cache\.(set|delete)|assertEntryCurrent|acquireLock" packages/opencorvus/src/project/instance.ts`
  - Failed project discovery removes the rejected cache entry; a concurrent request then reports the observed lifecycle-lease error. This is a downstream effect, not the package-schema root cause.

### Independent Agent Feedback

- No sub-agent was used; the user did not request delegation or parallel agent work.

## Repair Plan

1. Validate every current repository source package with `ExpertSquadRegistry.loadSourcePackage`.
2. Explicitly replace each matching installed package in `futures` through `ExpertSquadPackageManager.importDirectory` with `replace: true`.
3. Discover and validate the installed project catalog; assert zero `role_base` occurrences and exact source/target package IDs.
4. Run focused package-manager, registry, payload, and documentation-health tests plus `git diff --check`.
5. Start an isolated API process for `futures`, exercise the failing routes, stop only that isolated process, and perform a final evidence review.

## Result

- Replaced `algorithm`, `backend`, `frontend-automation-debug`, `frontend-innovate`, `frontend-replica`, and `opentest` through `ExpertSquadPackageManager.importDirectory({ replace: true })`.
- Project discovery returns all six packages from their canonical namespace/ID roots; `role_base` occurrences under the installed project package tree are zero.
- Repaired the explicit replacement tool so canonical identity discovery does not require the package being replaced to pass the current full schema before replacement. Full staged/new-package validation and atomic backup/restore remain unchanged.
- Added a regression test proving an explicitly replaced canonical package can carry a retired invalid schema while the replacement must pass the current registry.
- Isolated server `127.0.0.1:4205` opened `futures`; a new root session returned `200` from both `/session/:sessionID/config` and `/session/:sessionID/conversation`. The isolated server was then stopped with no live task/session ownership.
- The original live session then exposed a second strict-data failure: all 49 persisted messages had no `info.author`, while every row had the explicit real participant `agent: "mission"`. `/session/status` showed no active handles. A 59,412,480-byte SQLite backup was written to `.scratch/stale-project-repair-opencorvus-20260711.db`, then one transaction set `author = agent` only for those 49 rows.
- Final verification against the user's existing `127.0.0.1:7878` process returned `200` for both the original session config and conversation endpoints; the hydrated transcript contains all 49 messages.

### Validation

- PASS: 53 registry and repository-package tests.
- PASS: focused package-manager suite, including the stale-schema replacement regression.
- PASS: 25 payload-generation/document-health assertions excluding the Git-index assertion.
- PASS: `bun run --cwd packages/opencorvus typecheck`.
- PASS: focused `git diff --check`.
- BLOCKED by preserved concurrent work: payload source Git-index assertion reports 67 current expert-squad source files are untracked. The files belong to the wider in-progress dynamic-agent package rewrite and were not staged or committed by this repair.
- Commit/push is not performed because `manager.ts`, `package-manager.test.ts`, and the July index already contain extensive overlapping concurrent modifications; staging those files would improperly include unrelated work.
