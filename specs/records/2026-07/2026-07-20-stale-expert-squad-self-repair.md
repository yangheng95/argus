# Stale Expert Squad Self-Repair

## Recall

- 用户原始要求：修复截图中为 `C:\Users\王昱凯\Desktop\futures-opentest-existing-evidence` 设置工作目录时的失败。可观察错误包含专家团 manifest 缺少 `selector`、`capability_projection.scheduler.inherit_base_tools` 及各类引用数组，以及后续请求的 `Instance cache entry changed while acquiring its lifecycle lease`。
- 验收指标：旧 manifest 继续被当前严格 schema 拒绝；即使完整项目 bootstrap 已被旧包阻断，Expert Squad Market 和显式更新仍可进入；Market 必须显示已安装 scope 并允许用户用当前 bundled payload 显式替换对应旧包；替换后真实 catalog/bootstrap 成功；前后端契约、测试、桌面截图和二次 review 均通过。
- 硬约束：不增加旧字段兼容、fallback、自动覆盖、route gate 或第二套 package 实现；不删除用户项目数据；不创建 worktree；不重启、刷新或关闭正在运行的 OpenCorvus/Overlay；Playwright 只用 Node 启动。
- 已读取落盘资料：`specs/current/architecture/04-extensions.md`、`specs/current/architecture/07-panel.md`、`specs/records/2026-07/2026-07-11-stale-project-expert-squad-repair.md`、`specs/records/2026-07/2026-07-12-project-delete-bootstrap-independence.md`、`specs/records/2026-07/2026-07-18-expert-squad-explicit-install-scope-actions.md`、`specs/records/2026-07/2026-07-18-squad-skill-update-sources.md`。
- 已读取代码：`project/instance.ts`、`server/server.ts`、`server/routes/expert-squad.ts`、`expert-squad/registry.ts`、`expert-squad/manager.ts`、transport route policy、Overlay expert-squad service/panel/browser fixtures及相关测试。
- 全仓 grep：`rg -n "PROJECT_DIRECTORY_PATH_PREFIXES|routeRequiresProjectDirectory|provideProjectIdentity|Instance\\.provide\\(|expert-squad/(market|catalog|update|install-payload|release-payload|import-folder|import-file|validate-folder)|payloadMarket|PayloadMarketItem|installed_scope|installed:" packages specs/current specs/records/2026-07`；另核对 `releaseExistingPackageMap`、`discoverInstalledPackageIdentities`、`findInstalledPackageIdentitiesForProjects`、Market/Update 浏览器与 route 测试。结果证明 directory 注入契约与 runtime bootstrap 是两层职责，package manager 已有唯一的严格显式 replace 实现，Market 的 identity discovery 可读取旧包身份而不解析其完整 manifest。
- 独立 agent 反馈：用户未要求子 Agent 或并行审计，本任务未委托。

## Causal chain

1. 目标目录中的已安装 Expert Squad package 仍使用退役 manifest 形态；当前 `ExpertSquadRegistry.discover()` 严格解析并正确拒绝它。
2. 所有 directory-scoped routes 在 handler 前统一进入 `Instance.provide({ init: InstanceBootstrap })`，因此连本应修复 package 的 `/expert-squad/market` 与 `/expert-squad/update` 也在 handler 前失败。
3. 首个 bootstrap 失败会回滚并移除实例 cache entry；同批并发 Provider/Market/Catalog 请求在获取 lifecycle lease 时观察到 entry 已变化，于是报告第二个 cache-entry 错误。它是并发下游现象，不是 schema 根因。
4. 现有 Details 更新按钮依赖成功 catalog；旧包恰好使 catalog 不可达。Market 虽可用 embedded payload 构造条目，却既被完整 bootstrap 阻断，也只显示 Installed badge，没有显式修复动作。

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `routeRequiresProjectDirectory` and Overlay `api-state` | 保留；修复路由仍属于用户所选 directory，继续注入同一个 directory source。 |
| Server project-directory middleware | 在服务端内部抽象精确的 project-identity route ownership；`DELETE /project/current` 与显式 package provisioning/repair routes 使用 `provideProjectIdentity`，其余路由继续完整 bootstrap。 |
| `/expert-squad/catalog`, config, provider, channel and task routes | 保留完整 `InstanceBootstrap`；旧 package 继续使这些运行时表面失败，直至用户显式修复。 |
| `/expert-squad/market` | 使用 project identity 进入；只读取严格 embedded payload declaration 与已安装 identity/location，不解析旧 manifest 内容。 |
| `/expert-squad/update` | 使用 project identity 进入；继续调用唯一 `ExpertSquadPackageManager.updatePackage`，builtin source 仍通过严格 payload 校验及原子 `replace: true`。 |
| install/import/validate/release provisioning routes | 使用同一个 project-identity ownership，因为它们是 package 修复入口且 manager 自己拥有严格输入校验。 |
| export/uninstall/activation/catalog/runtime routes | 保留完整 bootstrap；它们读取有效 catalog、活动引用或会话运行态，不是损坏 package 的自修复入口。 |
| `releaseExistingPackageMap` / Market response | 由 boolean `installed` 改为单一 `installation_scope` 来源，避免 UI 猜 scope；重复 manifest ID 继续严格报错。 |
| Market row UI | 未安装项保留 global/project Install；已安装 bundled item显示其 scope与显式 Update action，复用现有 Button primitive和 update service。 |
| Details update UI | 保留；有效 catalog 下仍是已安装 package 的详情级更新入口。 |

## Implementation plan

1. 在 server lifecycle 层定义精确、method-aware 的 project-identity route predicate，并在 server middleware 复用；transport protocol 的 directory-required 契约不变。
2. Market contract 只输出 `installation_scope: "global" | "project" | null`，manager 从 identity location 直接投影。
3. Expert Squad Install page 对已安装 bundled package 提供 scope-bound Update。更新成功先刷新 Market；Catalog 用其既有错误表面独立刷新，确保仍有其他坏包时不会把一次成功替换谎报为失败。
4. 真实 server regression 写入旧 manifest，证明 catalog 500、Market 200、builtin update 200、随后 catalog 200；补 transport、manager、SDK/Overlay service和UI contract测试。
5. 用 Node Playwright 展示“catalog 被旧包阻断但 Market 可更新”的真实桌面 UI fixture，点击 Update 后验证状态和截图，并亲自检查布局。

## Acceptance status

- [x] 严格旧 manifest 拒绝保持不变
- [x] repair routes 在 bootstrap 失败时真实可达
- [x] Market scope 和显式 Update 契约单一来源
- [x] 更新后真实 catalog/bootstrap 恢复
- [x] focused tests、typecheck、API/docs/i18n checks 通过
- [x] Node Playwright 桌面截图已查看并校正
- [x] diff 二次 review 完成

## Verification

- 真实 server 路径：`OPENCORVUS_EXPERT_SQUAD_ROUTES_ISOLATED_CASES=1 bun test packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 0 --test-name-pattern "stale installed package can update itself"`，1 pass；测试依次证明 stale catalog 500、Market 200、builtin Update 200、repaired catalog 200。
- 完整 expert-squad route suite：`bun test packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 0`，17 个隔离 route case 全部通过。首次执行曾被并发中的 Skill unknown-frontmatter 修改阻断；该修改完成后原命令复跑通过，没有把外部失败包装成本任务成功。
- Manager：payload declaration-only Market、single install 和 retired-schema explicit replacement 共 3 pass。
- Contract/UI：project-route context、ApiError NamedError 解码、Expert Squad lifecycle/settings 共 24 focused tests 通过；OpenCorvus、Overlay、SDK TypeScript typecheck 通过。
- Generated/API/docs：SDK build、`api:routes-check`、`docs:check`、Overlay i18n check 与 historical docs links 通过。
- 视觉验收：Node runner 执行 `expert-squad-panel.test.ts`，4 pass；1902×1314 截图已人工查看。失败态截图显示 Market 仍可见、已安装 scope 与 Update action 清晰；点击后截图显示成功 notice、catalog error/recovery 消失且详情恢复。原始 JSON 命名错误已由统一 `ApiError` 解码为 `data.message`。
- 环境边界：本机无法访问截图中的 Windows `C:\Users\王昱凯\Desktop\futures-opentest-existing-evidence`，因此没有宣称该外部目录已被写盘修复；验收使用本地真实临时 Git 项目重现同一 retired manifest 契约。
