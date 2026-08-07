# Project delete bootstrap independence

## Recall

- 用户原始要求：修复侧栏删除 `crypto`、`world-economy` 等项目时，`DELETE /project/current` 返回 HTTP 500 的问题。
- 可观察证据：错误响应来自项目内旧专家团 manifest；旧字段 `role_base` 无法通过当前严格 schema（`base_role`、`label`、`inherit_base_tools`）。
- 直接触发点：服务端项目目录中间件在进入 DELETE handler 前执行 `Instance.provide(..., init: InstanceBootstrap)`，因此损坏的可选运行时资源使项目无法删除。
- 根因：删除项目状态错误依赖完整运行时 bootstrap。删除只需要项目身份、数据库命名空间和实例 lease，不应加载专家团、skill、MCP（Model Context Protocol，模型上下文协议）或 scheduler。
- 已读取资料：`specs/current/architecture/04-extensions.md`、`specs/records/2026-07/2026-07-11-stale-project-expert-squad-repair.md`、`packages/opencorvus/src/project/instance.ts`、`packages/opencorvus/src/server/server.ts`、`packages/opencorvus/src/project/delete.ts`、专家团 creator checklist。
- 全仓 grep：核对了 `routeRequiresProjectDirectory`、`InstanceBootstrap`、`Instance.provide`、`deleteCurrentProject`、`deleteProjectState`、`ExpertSquadPackageManager.importDirectory` 的定义与调用点。路由目录契约保留；只替换 DELETE current 的实例进入方式。
- 独立 agent 反馈：本任务未请求并行 agent，未委托。
- 硬约束：不增加旧 manifest 兼容解析，不使用 fallback，不删除源文件，不操作当前运行中的 OpenCorvus 进程。

## Design

1. `Instance` 提供单一的 project-identity lease 入口：创建或复用 `Project.fromDirectory` 产生的实例上下文，但不执行 `prepareContext` / bootstrap。
2. 服务端仅对精确的 `DELETE /project/current` 使用该入口；其他 project-scoped 请求继续走完整 `InstanceBootstrap`。
3. 删除 handler 继续拥有停止、沉淀、数据库清理和 `.opencorvus` 清理语义；不新增第二套删除实现。
4. 已安装的旧专家团包只允许通过 `ExpertSquadPackageManager.importDirectory({ replace: true })` 显式替换，不放宽 registry。

## Acceptance benchmark

- 在临时真实 git 项目写入当前 schema 明确拒绝的旧 `role_base` manifest。
- `GET /project/current` 必须返回 500，证明严格启动没有被放宽。
- 同一目录的 `DELETE /project/current` 必须返回 200，并删除数据库项目记录和 `.opencorvus`，同时保留源文件。
- 现有正常项目删除、队列沉淀测试继续通过。
- 专家团 registry / manager 的既有测试和 TypeScript typecheck 通过。
- 超时按命令无活动判断；不以进程启动时刻机械截断。

## Final review checklist

- [x] 真实 DELETE 回归通过
- [x] 正常删除回归通过
- [x] 严格 GET 失败断言通过
- [x] 无兼容字段或 fallback
- [x] diff 二次复核

## Verification result

- `bun test packages/opencorvus/test/server/project-routes.test.ts --test-name-pattern "stale expert squad"`：1 pass。
- `bun test packages/opencorvus/test/server/project-routes.test.ts --test-name-pattern "deletes OpenCorvus project state"`：正常删除单测通过；与 stale 用例并跑时 Windows process supervisor 曾使 Git bootstrap 先失败，单独复测 stale 用例通过。
- `bun run --cwd packages/opencorvus typecheck`：通过。
- `bun run --cwd packages/opencorvus build`：通过，生成 Windows x64 构建。
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`：20 pass。
- 完整 `project-routes.test.ts`：13 pass、8 fail、1 unhandled error。失败证据包含 Windows process supervisor 未发布 Git readiness，以及既有 queue wake 持有 closed instance lease；后者在单独运行原有 queue 用例时仍可复现，未包装成本任务通过项。

## Overlay build follow-up

- 用户后续报告 `build:overlay` 在 Vite 成功后的 SDK rebuild 阶段读取旧 `payload.ts` 并报缺失专家团源码。
- 全仓调用点证明 OpenCorvus server build 会先调用 `generateOpencorvusGeneratedBuildArtifacts`，但 overlay pipeline 在 server build 之前先执行 SDK build；SDK build 又会 import live server 生成 OpenAPI，因此生成动作发生得太晚。
- 修复：overlay pipeline 在 SDK build 前调用同一个 `generateOpencorvusGeneratedBuildArtifacts` 单一来源，并用顺序测试锁定“Vite → server generated artifacts → SDK → server/Tauri”。没有增加缺失模块 fallback。

## Interrupted deletion follow-up

- `us-country` 与 `forex` 的项目目录仍存在、数据库 project row 仍存在，但 `.opencorvus` 已不存在；这是旧删除流程在移除项目运行目录后、删除数据库记录前失败留下的半删除证据。`futures` 仍同时拥有数据库 row 与 `.opencorvus`，属于尚未完成删除。
- 原 `removeProjectConfigRoot` 使用 `force: false`，导致用户重试半删除项目时稳定得到 `ENOENT`，数据库残留永远无法通过产品路径清除。
- 修复将“项目运行目录已不存在”建模为明确的幂等删除状态：继续清理数据库记录，但仍只允许删除经 `assertProjectConfigDeleteTarget` 验证的 `.opencorvus` 目标，不吞掉其他文件系统错误。
- 新增真实 DELETE 回归：源目录存在、project row 存在、`.opencorvus` 不存在时返回 200，清除数据库 row 并保留源文件。
