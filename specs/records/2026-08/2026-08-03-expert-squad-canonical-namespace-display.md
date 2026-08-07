# Expert Squad canonical namespace display

Date: 2026-08-03
Status: Implemented

## Recall

| Item                           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement               | 统一 Expert Squad 名称：`builtin` namespace 省略前缀，第三方 package 使用 canonical `namespace/label` 形式，不再出现 `Builtin/`、任意 `OpenCorvus/` 或无 namespace 的混合展示。                                                                                                                                                                                                                                                                                               |
| Acceptance criteria            | Base、Advanced、Research Studio、Frontend Innovate、Frontend Replica 与 Review & Debug 等 `builtin` namespace package 只显示 manifest label；Mirror Prism、MirrorWatch 与 MirrorTest 分别显示 `mirror/Mirror Prism`、`tanzeqi/MirrorWatch` 与 `wujiang/MirrorTest`；Composer picker、Settings catalog、detail header、active trigger 和推荐 catalog 复用同一个 backend `display_label`；真实桌面页面完成选择器交互、截图和人工视觉复核。                                      |
| Hard constraints               | Manifest `id` 继续是唯一逻辑选择身份；namespace 继续是来源与安装分区；不从目录名、产品名、README、自定义 display metadata 或 Overlay source kind 猜测；删除旧 `expert_squad_display_prefix` 契约，不保留 fallback/alias/双源；不新增、修改、更新或运行 UI 自动化测试；保留并行工作区改动；提交使用 `dsw-33987` 前缀并推送 `myhexin/v0.0.29beta`。                                                                                                                             |
| Sources read                   | 用户截图；仓库 `AGENTS.md`；Browser control skill；`specs/current/architecture/04-extensions.md`；2026-07 README display-prefix 历史记录；2026-08 Research Studio built-in 记录；`catalog-profile.ts`、`catalog.ts`、`registry.ts`、built-in loader、Composer selector、Expert Squad settings panel、built-in and repository package manifests/READMEs。                                                                                                                      |
| Whole-repository grep evidence | `catalogSummaryFromPackage()` 是所有 catalog summary 的 `display_label` owner；Overlay 的 Composer 与 Settings 均直接消费该字段。当前 owner 读取 Registry 从 README front matter 投影的可选 `displayPrefix`，因此 Base/Advanced 声明 `Builtin`、Review & Debug 声明 `OpenCorvus`、Research Studio 与 Mirror Prism 不声明，产生截图中的三种互相矛盾形式。所有 manifest 都已经拥有严格 canonical `namespace`；embedded 与 installed package 均通过同一个 catalog input 暴露它。 |
| Independent agent feedback     | None. The user did not request sub-agents, and current collaboration policy forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                   |

## Cause chain

1. Package README 可以声明任意 `expert_squad_display_prefix`.
2. Registry 把这个非身份字段提升为 package metadata，catalog 再优先用它拼接 `display_label`.
3. `builtin` 状态、manifest namespace 与 README prefix 因而成为三个互不约束的展示来源。
4. Overlay 正确消费统一 `display_label`，但 backend 给出的 label 已经不一致；在 UI 内增加判断只会制造第四个来源。
5. 根治点是 catalog projection：由 canonical manifest namespace 唯一生成 display label，并删除 README prefix 协议。

## Implementation plan

1. 删除 Registry 的 README display-prefix schema、字段与 package projection；README 只保留正文职责。
2. 删除 catalog/API 的 `display_prefix`，让 declaration hash 与 summary 使用 canonical namespace；`builtin` 返回 manifest label，其他 namespace 返回 `namespace/label`.
3. 删除 built-in/repository package README 中的旧 front matter，重新生成唯一 payload artifact 与 OpenAPI/SDK contracts。
4. 把旧 server contract tests 改成正向 namespace-display contract，并覆盖 embedded/installed `builtin` 与第三方 namespace 代表。
5. 更新 current architecture 和历史 supersession 说明。
6. 运行聚焦非 UI tests、typecheck、routes/docs/i18n/build；使用真实页面交互和截图人工验收，不运行 UI tests。

## Progress

- [x] Trace the catalog-to-Overlay display chain and enumerate affected package classes.
- [x] Commit and push the pre-implementation plan.
- [x] Replace README prefix metadata with canonical namespace display.
- [x] Regenerate contracts and complete non-UI verification.
- [x] Complete real-page interaction, screenshots, and manual visual review.
- [x] Complete final review, commit, and git-cc push.

## Validation record

- Registry, Resolver, namespace-display, payload-generation and server-route contracts passed. The final focused route/payload/namespace run passed 13/13; the broader Registry/Resolver run passed 89/89.
- Full repository typecheck, SDK import/runtime checks, API route inventory, generated documentation check, Overlay typecheck, i18n check and production Vite build passed. Vite emitted only existing third-party module-directive and large-chunk warnings.
- Historical links, Document Health and product-document single-source checks passed 70/70.
- No UI automated test was added, modified, updated or run. UI acceptance used one-off browser interaction against the real production Overlay build and canonical backend routes.
- The isolated real catalog returned `Base`, `Advanced`, `Research Studio`, `Review & Debug` and `mirror/Mirror Prism`; the installed Review & Debug package retained namespace `builtin`, while Mirror Prism retained namespace `mirror`.
- The real project Composer picker showed `Review & Debug` for the installed `builtin` package and `mirror/Mirror Prism` for the third-party package. Browser diagnostics contained no warnings or errors.
- `.scratch/expert-squad-canonical-namespace-builtin-desktop.png` and `.scratch/expert-squad-canonical-namespace-third-party-desktop.png` were manually reviewed. Both names fit the existing row without clipping, collision or duplicate prefix text.
- The isolated server recovered zero started Tasks, was stopped by its exact process, released port 53330, and its temporary Project/portable database directory was moved to Trash. No production database or running OpenCorvus process was modified.
