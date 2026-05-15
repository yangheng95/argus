# 2026-05-15 Global DB Single Source Plan

## Goal

收拢 SQLite 路径到单一全局位置：`<Global.Path.data>/opencorvus.db`。

删除当前 `Database.Path()` 中“未设置 `OPENCORVUS_HOME` 时退回 `<cwd>/.opencorvus/opencorvus.db`”这条分支，避免同一进程/同一产品同时存在“项目本地 DB”和“全局 DB”两套语义。

## Evidence

- 当前 DB 路径实现：
  - `packages/opencorvus/src/storage/db.ts`
    - `Database.Path()`：`OPENCORVUS_HOME` → `Global.Path.data/opencorvus.db`
    - else → `process.cwd()/.opencorvus/opencorvus.db`
- 当前 project-scoped HTTP 路由：
  - `packages/opencorvus/src/server/server.ts`
    - `?directory=` / `x-opencorvus-directory` 只负责选择 `Instance.directory`
    - 不应再暗示“directory 决定 DB 路径”
- 当前 health / reset 文案：
  - `packages/opencorvus/src/server/routes/global.ts`
  - `packages/sdk/openapi.json`
  - `packages/sdk/js/src/gen/sdk.gen.ts`
- 当前 overlay debug blob 仍展示两套候选 DB：
  - `packages/overlay/src/main.tsx`
  - `packages/overlay/test/task-debug-info.test.ts`

## Call Sites / Touch List

### Must change

1. `packages/opencorvus/src/storage/db.ts`
   - 保留：`Database.Path()` 作为唯一入口
   - 替换：删除 `process.cwd()` 分支，始终返回 `path.join(Global.Path.data, "opencorvus.db")`
   - 替换：`reset(projectDir)` 的注释与目标说明，改为“全局 DB + 指定 project scratch”

2. `packages/opencorvus/src/cli/cmd/db.ts`
   - 替换：`db reset` 描述，从“项目本地 DB + scratch”改为“全局 DB + 指定项目 scratch”

3. `packages/opencorvus/src/server/routes/global.ts`
   - 替换：`/global/health` 描述，不再提 project-local layout
   - 替换：`/global/db/reset` 描述与 `projectDir` 字段说明，不再声称“DB is project-local”

4. `packages/overlay/src/main.tsx`
   - 删除：`projectLocalDbCandidate(...)`
   - 替换：task debug blob 中的“双候选 DB 路径”提示，改为“唯一 runtime DB 路径来自 /global/health”

5. `packages/overlay/test/task-debug-info.test.ts`
   - 替换：旧断言（Project-local default / OPENCORVUS_HOME/global mode）
   - 新增：单一路径说明断言

6. Generated artifacts / docs
   - `packages/sdk/openapi.json`
   - `packages/sdk/js/src/gen/sdk.gen.ts`
   - `packages/sdk/js/src/gen/types.gen.ts`（若字段说明变动）
   - `packages/web/src/content/docs/reference/api.mdx`
   - `packages/web/src/content/docs/zh-cn/reference/api.mdx`

### Tests to add

1. `packages/opencorvus/test/storage/db-path.test.ts`
   - 断言 `Database.Path()` 不再依赖 `process.cwd()`
   - 断言无论 cwd 如何变化，结果都等于 `path.join(Global.Path.data, "opencorvus.db")`
   - 断言设置 `OPENCORVUS_HOME` 时仍落在该 home 的 `data/opencorvus.db`

## Non-Goals

- 不改 project-scoped `Instance.directory` 语义。
- 不把 worktree / ownership / attachments / project config 挪出 `.opencorvus/`。
- 不新增“兼容 project-local DB”的 fallback 或迁移脚本。

## Acceptance

1. 当前进程默认只会打开全局 DB。
2. overlay / docs / SDK 不再暗示存在 project-local DB 模式。
3. `Database.Path()` 相关单测通过。
4. `api:routes-check`、`docs:check`、`typecheck` 通过。
