# Startup Anonymous Project Allocation Repair

## Recall

### 用户原始要求

- 初始化时出现两个默认项目：启动仓库 `opencorvus` 与一个带短后缀的匿名项目。
- 用户已经删除数据库，因此初始化不应凭空新增匿名 Project。
- 2026-08-07 续跑要求：直接修复该问题，并确保不会只修冷启动而让重连、Close Project 或其他空白工作台入口继续制造空 Project。

### 验收指标

- 有持久化用户目录时，冷启动只恢复该目录，不调用项目发现或匿名项目分配路由。
- 没有持久化用户目录但服务端提供显式 `defaultDirectory` 时，冷启动使用该启动目录，只发送一次只读的 `GET /global/projects/discover`。
- 没有持久化目录且没有显式启动目录时，冷启动保持 directory-free，不创建 Project，不调用 `POST /global/projects/anonymous`。
- 断线重连保留当前运行中的精确目录身份，不重新发现、切换或分配 Project。
- Close Project 清除活动与持久化目录后进入 directory-free 工作台，不创建替代匿名 Project。
- 首次真实 Chat、Work 或 Mission 提交继续由既有全局提交边界分配唯一匿名 Project；本修复不改变显式用户提交语义。
- 后端项目发现继续把数据库注册项目与启动根/直属子目录中的 `.opencorvus` 标记作为可见目录事实，但发现本身不写数据库或文件系统。
- 聚焦非 UI 服务契约、类型检查、文档健康检查、真实隔离页面截图与二次代码复核通过。

### 硬约束

- 不过滤 Work Ledger 项目，不自动清理磁盘目录，不恢复数据库 migration，不增加 fallback、gate、第二目录来源或兼容路径。
- 不重启、刷新或操作用户正在运行的 OpenCorvus / Overlay；视觉验收只能使用隔离服务。
- 不新增、修改或运行 UI 自动化测试；仅修改和运行纯 workspace 服务/API 请求契约测试。
- 保留所有并行改动；不创建 worktree，不执行 reset/clean/checkout 回退。

### 已读取资料

- `AGENTS.md`、`CLAUDE.md`。
- `specs/current/architecture/07-panel.md`。
- `specs/records/2026-06/2026-06-28-directory-source-convergence-plan.md`。
- `specs/records/2026-07/2026-07-10-default-generated-workspace-startup.md`。
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md` 的显式启动目录修复记录。
- `specs/records/2026-07/2026-07-29-global-new-chat-lazy-project-persistence.md`。
- `packages/overlay/src/services/{init,workspace}.ts`。
- `packages/overlay/src/store/settings.ts`。
- `packages/opencorvus/src/project/project.ts`。
- `packages/opencorvus/src/server/routes/global.ts`。
- `packages/overlay/src/services/project-directory.ts`。
- `packages/overlay/src/services/meta.ts`。
- `packages/opencorvus/src/chat/global-chat-service.ts`。
- `packages/opencorvus/src/task-api/global-task-service.ts`。
- 相关纯服务/路由契约测试。

### 全仓调用点与同名来源

| 定义或调用点                             | 当前事实                                                                                                        | 决策                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `services/init.ts::loadInitialData()`    | 冷启动与断线重连共用；空目录会跳过 project-scoped 初始化。                                                      | 每个 `initApp` lifecycle 共享一次成功目录解析；当前 runtime directory 优先，失败允许下一次真实重连重试。    |
| `workspace.ts::ensureDefaultDirectory()` | 有 saved directory 时恢复；否则现行代码立即调用匿名分配路由。                                                   | 恢复 saved directory 优先；无 saved directory时读取一次只读 discovery，仅采用非空显式 `defaultDirectory`。 |
| `workspace.ts::loadDiscoveredProjects()` | `GET /global/projects/discover` 的唯一 Overlay 解析器；另一个生产调用只服务 Scheduled Automations 设置页。      | 复用，不新增目录发现客户端。                                                                               |
| `workspace.ts::createAnonymousProject()` | `ensureDefaultDirectory`、显式 Close Project、首次 Mission/附件提交等生命周期共用的唯一匿名分配客户端。        | 从冷启动与 Close Project 移除调用；只保留真实写操作。                                                      |
| `workspace.ts::closeProject()`           | 清空持久化选择后立即分配一个替代匿名 Project。                                                                  | 与删除活动 Project 后的现有路径收敛为 directory-free；关闭不是持久化工作边界。                             |
| `services/meta.ts::loadMeta()`           | 仍可在目录为空时用 project-scoped `/path` 响应反向设置目录。                                                    | 删除该不可达第二 bootstrap 来源；目录只能由显式选择、启动 discovery 或真实创建结果拥有。                   |
| `Project.discoverFromLaunchDirectory()`  | 合并数据库注册目录与启动根/直属子目录 `.opencorvus` 标记；仅 `OPENCORVUS_PROJECT_DIR` 产生 `defaultDirectory`。 | 保留；它解释了数据库清空后 `opencorvus` 仍可被发现，但不是匿名 Project 的创建者。                          |
| `GET /global/projects/discover`          | 只读控制面路由。                                                                                                | 保留现有 API。                                                                                             |
| `POST /global/projects/anonymous`        | 显式匿名 Project 分配写路由。                                                                                   | 冷启动不得调用；实际提交/显式生命周期继续调用。                                                            |
| `workspace-discovery-service.test.ts`    | 现有纯服务测试把冷启动匿名分配当成正确行为。                                                                    | 改为正向验证 saved、explicit launch、directory-free 三种当前契约；不检查渲染字符串或 DOM。                 |
| `global-project-discovery.test.ts`       | 正向验证显式启动目录和注册项目发现。                                                                            | 保留；现有后端契约无需修改。                                                                               |

### 独立反馈

- 已启动只读独立 Agent 审计完整调用链、重连身份与正向测试边界；不得修改文件或继续委托。实施后将反馈写入验证记录。

## 因果链

数据库被删除 → 启动仓库的 `.opencorvus` 目录仍在磁盘 →
`GET /global/projects/discover` 正确发现 `opencorvus` → Overlay 没有 saved
directory → `ensureDefaultDirectory()` 又主动调用
`POST /global/projects/anonymous` → 后端创建并注册新的日期 UUID Project → Work
Ledger 同时投影启动仓库和匿名 Project。

直接触发点是冷启动匿名分配。深层原因是 7 月 25 日的匿名 Project 统一改动覆盖了
此前已经建立的“启动读取不产生空 Project”边界；后续 New Chat 懒持久化修复只处理了
点击入口，没有收敛冷启动路径。删除数据库只删除注册事实，不会删除磁盘项目标记，
因此它会让这条双来源表现稳定复现。

## 实施方案

1. 将 `ensureDefaultDirectory()` 收敛为四种有序正向来源：当前运行目录、saved directory、显式服务端 `defaultDirectory`、directory-free。
   `initApp()` 为每个 lifecycle 共享一次成功解析：首次离线时延迟到第一次连通，后续重连复用结果，解析失败则允许下一次真实重连重试。
2. 删除冷启动与 Close Project 对匿名分配写路由的调用；保留真实提交和真实附件输入调用。
3. 删除 `loadMeta()` 反向建立目录身份的第二 bootstrap 来源。
4. 更新纯服务测试，证明 saved、explicit launch、directory-free、reconnect 与 Close Project 的正向结果。
5. 更新当前 Panel 架构，明确冷启动、Close Project 与全局空 Composer 都保持写空闲，只有首次真实提交分配 Project。
6. 运行聚焦非 UI 测试、Overlay 类型检查与文档检查；启动隔离真实页面并人工查看截图；完成只读二次审查。

## 验证记录

- 纯服务正向契约：`bun test packages/overlay/test/workspace-discovery-service.test.ts packages/overlay/test/initial-workspace-restore.test.ts` 通过，8 tests / 16 assertions。覆盖显式 launch directory、directory-free、saved directory、当前 runtime directory 与同一 `initApp` lifecycle 的并发/重连共享解析结果。触及范围内两个以“不选择”为核心的旧负向测试已删除。
- Overlay TypeScript：`bun run typecheck`（`packages/overlay`）通过。
- Overlay production Vite build：通过，7,083 modules transformed。第三方 React bundle 的既有 `use client` 与 chunk-size warning 不影响成功结果。
- `bun run docs:check` 通过，315 operations / 24 groups。仓库当前已不存在 AGENTS.md 历史路径点名的 `historical-docs-links.test.ts`、`document-health.test.ts` 与 `product-docs-single-source.test.ts`，没有重建已删除测试或兼容路径。
- 真实隔离页面：source backend 使用独立 `OPENCORVUS_HOME` 与端口 `17903`，当前 production Overlay 首次打开和一次完整 reload 都显示 directory-free `What should we build?` 与 `No work yet`；只读 SQLite 查询确认两次启动后 `project` 表精确为空。
- Close Project：验收期间通过显式 `POST /global/projects/anonymous` 创建唯一测试 Project，真实页面进入该 Project 后执行 `File → Close`。页面回到 directory-free heading，左侧只保留原 Project；只读 SQLite 查询确认仍恰好一个 Project、零 Session，没有替代匿名 Project。人工复核截图：[`2026-08-07-startup-project-boundary-close.png`](../../artifacts/2026-08-07-startup-project-boundary-close.png)。
- 独立只读审计指出“重连可能重新挂回显式启动目录”的初版遗漏；实现已增加每个 `initApp` lifecycle 共享一次成功解析，失败不缓存、首次离线延迟到第一次连通，后续重连不重复 discovery。Chat/Work 仍保留后端原子 Project+Session 分配，Mission/真实附件继续复用现有并发分配边界。
- 隔离 Browser tab 与 backend process 已停止，端口 `17903` 已释放；用户运行中的 OpenCorvus 未被重启或修改。
