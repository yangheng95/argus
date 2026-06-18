# new-arch — 架构文档（拆分版）

> 替代原 1336 行单 SVG。现在按「4 主题 MD + 3 瘦身 SVG」维护。
> 旧 SVG 已归档为 `_archive-old-arch.svg`。
>
> **Last sync 2026-06-15**：当前 orchestrator 工具面以 `packages/opencorvus/src/agent/agent.ts`
> 的 include 列表和 `packages/opencorvus/src/orchestrator/tools.ts` 为准；`deliver` /
> `publish_acceptance` 已删除，`integrity` 是最终 workflow acceptance，`visual_qa` 是
> terminal frontend goal batch 后的同级视觉/产品审查证据，`workload_analysis` 是 architect 后的只读 goal 定型复核层。

## 目录

### 总览（SVG 框图）

| 文件                             | 展示内容                                                          |
| -------------------------------- | ----------------------------------------------------------------- |
| [01-agents.svg](01-agents.svg)   | 图 1 — Agent 家族调用链（Gateway → Loop → sub-agents → Executor） |
| [02-data.svg](02-data.svg)       | 图 2 — 数据面（orchestrator 18 表 + Trace/Bus 横切）              |
| [03-control.svg](03-control.svg) | 图 3 — 控制面与扩展入口                                           |

### 详细文档（MD）

| 文件                                                                               | 主题                                                                                            | 对应旧 SVG Section |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------ |
| [01-agents.md](01-agents.md)                                                       | Agent 家族、Task Control Loop、MiniWorkflow（direct/pipeline）、task kind                       | A · C · H · I      |
| [02-data.md](02-data.md)                                                           | `engine_*` 18 表、session 域、Trace/Bus 横切、Decision Log                                      | C · D · K          |
| [03-control.md](03-control.md)                                                     | ChannelIngress · ControlMessage · Panel Capability 路由                                         | L + 新             |
| [04-extensions.md](04-extensions.md)                                               | Executor / Plugin / MCP / ACP 四条扩展入口                                                      | G（扩展）          |
| [05-config.md](05-config.md)                                                       | Unified Config 三层分离 + PATCH 流程                                                            | F                  |
| [06-provider.md](06-provider.md)                                                   | LLM Provider 六层适配                                                                           | G                  |
| [07-panel.md](07-panel.md)                                                         | Workbench / Panel 重设计 + SSE 事件                                                             | J                  |
| [08-agent-tool-adapter.md](08-agent-tool-adapter.md)                               | Agent ↔ Tool include/exclude 适配协议                                                          | 新                 |
| [09-verification-evidence.md](09-verification-evidence.md)                         | Verification Evidence（已迁移至 `engine_artifact` kind="verification-evidence"）                | 新                 |
| [10-worktree-lifecycle.md](10-worktree-lifecycle.md)                               | Goal worktree 生命周期与 ff-only merge-back                                                     | 新                 |
| [11-agent-oop-protocol.md](11-agent-oop-protocol.md)                               | Agent OOP 协议：BaseAgent / CapabilityContract / Mailbox / Registry / Whitelist（草稿，未实施） | 新                 |
| [12-overlay-card-system.md](12-overlay-card-system.md)                             | Overlay 统一卡片系统：Shell / Payload / Policy / Writer（目标设计，未完全实施）                 | 新                 |
| [13-agent-communication-matrix.md](13-agent-communication-matrix.md)               | Agent 通信矩阵：预期 whitelist vs 当前实现的 direct/indirect 路径                               | 新                 |
| [14-agent-runtime-mode.md](14-agent-runtime-mode.md)                               | Agent 抽象修正：AgentSpec / RuntimeMode / ContextStrategy / BudgetPolicy                        | 新                 |
| [15-no-fsm.md](15-no-fsm.md)                                                       | 状态机全砍计划（DEPRECATED，并入 16）                                                           | 新                 |
| [16-unified-teardown.md](16-unified-teardown.md)                                   | 统一拆除：向 Claude Code / Codex 极简模型看齐                                                   | 新                 |
| [2026-04-27-task-rewind-code-resource.md](2026-04-27-task-rewind-code-resource.md) | Task rewind 与代码 worktree 资源协同                                                            | 新                 |
| [spec-vscode-extension.md](spec-vscode-extension.md)                               | VSCode 扩展规格                                                                                 | 新                 |
| [99-principles.md](99-principles.md)                                               | 核心原则、anti-patterns、非协商约束                                                             | B · E              |

### 归档与工作笔记

| 文件                                            | 说明                                    |
| ----------------------------------------------- | --------------------------------------- |
| [\_archive-old-arch.svg](_archive-old-arch.svg) | 原 `specs/new-arch.svg`（1336 行）归档  |
| [HISTORY.md](HISTORY.md)                        | 按日期索引 `specs/new-arch/**` 历史方案 |

## 三张总览框图（SVG 瘦身目标）

拆分完成后 `new-arch.svg` 只保留三张图：

1. **Agent 家族调用链**（图 1）—— ChannelIngress / ControlMessage → EngineService → Orchestrator → sub-agents
2. **数据面**（图 2）—— `engine_*` 18 表 + 横切 Trace/Bus
3. **控制面 + 扩展入口**（图 3）—— channel/control/panel-capability + executor/plugin/mcp/acp

> SVG 框图（01/02/03-\*.svg）尚未根据本轮重构更新；以 MD 为准。

详细文字全部迁到上表的 MD。SVG 不再承载大段描述。

## 阅读顺序建议

- 想了解「任务是怎么执行起来的」→ 01 → 03 → 02
- 想接入新 channel 或工具 → 03 → 04
- 想改配置系统 → 05
- 想加新 LLM 提供商 → 06
- 想改面板 UI → 07

## 维护规则

1. **代码改了必须同步 MD**。MD 过时会导致后续读者误判，比 SVG 更糟（MD 权威性更强）。
2. **每个 MD 顶部必须写「对应代码位置」**，做到一键跳转。
3. **新概念先加 MD，再改 SVG**。SVG 只是图形化概要。
4. **禁止把 MD 长文字塞进 SVG `<text>`**。SVG 只留标题和关键词。
5. **产品文档只写 `packages/web/src/content/docs/**`**。`docs/product/\*\*` 已在 2026-06-15 删除，历史 spec 只能引用它作为已退休路径，不能把新内容写回旧树。

## 历史文档整并状态

- 2026-06-15：`docs/product/**` 遗留产品文档树已删除；网站文档唯一源为 `packages/web/src/content/docs/**`。
- 2026-06-15：新增 `2026-06-15-historical-docs-consolidation.md`，记录本轮全仓文档扫描、断链修复和验收命令。
- 历史实现笔记继续保留在 `specs/**`；缺失的外部旧笔记用 `Retired external note` 标注，不再补建空文件。

## 迁移进度

- [x] 目录 + README + 骨架
- [x] 01-agents.md 填充
- [x] 02-data.md 填充
- [x] 03-control.md 填充
- [x] 04-extensions.md 填充
- [x] 新 SVG 三张总览图（01/02/03-\*.svg）
- [x] 旧 new-arch.svg 归档为 `_archive-old-arch.svg`
- [x] 工作笔记已归档（原 `00-sync-notes.md` 已移除）
- [x] 05-config.md · 06-provider.md · 07-panel.md · 99-principles.md 全部填充
- [x] `src/calculator/` 已删除（零消费者，git rm）
- [x] 2026-04-17 同步：`orchestrator/` → `engine/` · `task-agent/` → `orchestrator/` ·
      `orchestrator/service.ts` → `task-api/index.ts` · `evaluator/` → `acceptance/checks/` ·
      `control-plane/` 拆并入 `workspace/` + `util/sse.ts` ·
      `session.channel_key` + `session_gateway_singleton_idx` 移除 ·
      `panel/api.ts` + `panel/settings.ts` 移除
- [x] 2026-04-27 同步：
  - `engine_*` 表从 18 张缩到 13 张（Phase 6 把 `engine_run` / `engine_goal_run` /
    `engine_acceptance` / `engine_evaluation` / `engine_goal_snapshot` 合并为 `engine_artifact` + `kind` 区分）
  - `engine/goal-pool.ts` 与 `pipeline/executor.ts` 已删除，调度逻辑并入 build tool + `goal/runner.ts`
  - `executor/` 新增 `codex.ts` / `bootstrap.ts` / `discovery.ts` / `external-process.ts` / `managed.ts` / `runtime-env.ts`
  - `provider/` 拆出 `vendor-headers.ts` / `vendor-messages.ts`；新增 `policy.ts` / `hexin-discovery.ts` / `hexin-profiles.ts`；删除 `codex-live.ts`
  - `mcp/` 新增 `stdio.ts`
  - 修正：`gateway/` **未整删**，保留 3 个文件（SDK gateway 客户端会话辅助）
  - 09-verification-evidence.md / 12-overlay-card-system.md / 11-agent-oop-protocol.md
    在头部补"实施状态"标注，区分"目标设计"与"代码现状"
  - 15/16 文档头部补 follow-up TODO（runtime.ts status 分支 / goal-status mapRunStatus / teardown 多源）
- [x] 2026-05-11 同步（本轮）：
  - **`src/decompose/` 完全删除**（不再以"`requirements/` 是 re-export"形式存在）；
    `src/requirements/` 是独立包：`agent.ts` / `index.ts` / `output-tools.ts` / `types.ts`
  - **the removed planning package 整目录删除**：planner 不再是独立 sub-agent。session 级的
    `src/tool/planner.ts` 是 working-memory + scratchpad 工具（task tree / scratchpad），
    与旧的 per-goal "planGoal()" 完全不同
  - **`src/pipeline/` 只剩 `goal-contract.schema.ts` + `types.ts`** 两个 schema 文件，
    所有运行时代码（`executor.ts` / `runner.ts` 等）均已迁走
  - 新增独立包：`src/intent/`（`bundle.ts` 单文件）、`src/intent-analysis/`、`src/integrity/`、
    `src/acceptance/`（`contract-audit.ts` + `types.ts`）、`src/browser/webpage/`、`src/frontend-design/tools/`、
    `src/preview/`、`src/build/`（build 独立成包仅 4 个文件：`agent.ts` / `index.ts` /
    `report.ts` / `types.ts`；**worktree+executor 执行体仍在 `src/goal/runner.ts`**，共享
    sub-agent 协议在 `src/agent/sub-agent-protocol.ts`，build/ 下没有 `runner.ts` /
    `sub-agent-protocol.ts` / `prompt/`）
  - 2026-06-15 修正：该段的 `deliver` / `publish_acceptance` 事实已过期。当前
    orchestrator 工具面包含 `requirements`、`frontend_design`、`frontend_research`、
    `deep_research`、`architect`、`workload_analysis`、`build`、`visual_qa`、
    `integrity`、`fact_check`、`analyze_intent`、`explore`、`read_context`、
    `browser_preview`、`wait`、`bash`、`add_goal` / `modify_goal` 等 goal 控制、
    task 控制与 `propose_task`；最终验收由
    `integrity` pass 完成。
  - 2026-06-15 修正：`prosecutor` / `prosecute` 不再是当前注册 agent/tool；对抗性复核职责归入
    `integrity` reviewer team。
  - `panel/capability.ts` 当前注册 **20 个 action**（详见 03-control.md）
  - **SessionKind 实际是 15 种**（02-data.md 写"16 种"且把 `planner` 列入是错的）：
    `root` · `orchestrator` · `assistant` · `gateway` · `intent-analysis` ·
    `requirements` · `frontend-design` · `goal` · `architect` · `integrity` ·
    `acceptance` · `executor` · `build` · `evaluator` · `system`
  - SSE 端点真源是 `src/server/routes/orchestrator.ts`（task / task event 双 SSE 主线）+
    `routes/panel.ts` / `routes/global.ts` / `routes/app.ts` / `routes/coding.ts` 5 个文件；
    `src/server/event.ts` 只是 7 行的 `BusEvent` 类型声明（`server.connected` / `global.disposed`），
    历史 `routes/task-event.ts` 路径不存在
  - `acceptance/` 当前文件包括 `arbiter.ts` / `contract-audit.ts` / `lkg-isolated-eval.ts` /
    `manifest.ts` / `review-verdict.ts` / `specialist-review.ts` / `surface-detector.ts` /
    `types.ts` / `verdict.ts` / `visual-evidence.ts` / `visual-metric.ts`；checks 包括
    `content-fingerprint.ts` / `contract-audit-review.ts` / `discovery.ts` /
    `project-gate.ts` / `runtime-readiness.ts` / `walkthrough/`；specialists 包括
    `backend-client.ts` / `security-data.ts` / `test-integration.ts`
  - `architect/` 新增 `contract-ir.ts` / `fidelity.ts` / `linker.ts` / `output-tools.ts`
  - `intent-analysis` **已接线**：orchestrator `analyze_intent` tool → `IntentAnalysisAgent.analyze`
    （旧 13 号文档"not wired yet"的判断已过期）
- [x] 2026-05-12 同步（围绕代码与文档对齐再扫一遍）：
  - **04-extensions.md** — 修正 build tool 调用链：`ExecutorRegistry.require()` 实际调用点在
    `build/agent.ts` + `engine/runtime.ts` + `task-api/index.ts`（不在 `goal/runner.ts`）；
    补全 `plugin/isolate.ts`（`runHookIsolated`）与 `mcp/materialize.ts`
  - **05-config.md** — 删除已不存在的 `assistant.spec / goal / planner / evaluator / adaptive`
    字段；删除 `experimental.unattended / auto_permission`（仅余 `auto_question`）；
    补齐当前 `assistant` 子项（`architect / acceptance / acceptance_visual / frontend_design /
intent_analysis / build / activity / debug / default_workflow / workflows`）
  - **06-provider.md** — 数量改为 **20 bundled provider**（`provider/bundled.ts:27-48`）；
    Agent ↔ Model 示例替换 `planner / evaluator` 为 `orchestrator / requirements /
architect / build / acceptance`
  - **07-panel.md** — Config Panel agent 列删除 `Planner / Evaluator`，补 `Frontend Design /
Intent-Analysis / Build`；Behavior 区只保留 `auto_question`；SSE 事件改为实际注册的
    `workflow.selected / workflow.step.updated / goal.workflow.progress`
  - **07-panel-reactivity.md** — 顶部加 **P0-P2 已落地、P3 清理未完成** 状态条；列出
    `store/messages.ts` (923 行) 仍存活的 `FLUSH_INTERVAL / enqueueEvent / coalesceDeltas /
flushEvents / messagesBySession`，与 `partitionInteractions` / `goal-group:<gid>` 残留
  - **08-agent-tool-adapter.md** — 顶部加 **8 条关键修正**：`tools` schema 是
    `{ include?, exclude? }` 同对象而非 union；`spec_enter / spec_exit / plan_enter /
plan_exit` 这些 tool **从未存在**；build / general / explore / acceptance 真实工具集已对齐
    `agent.ts:125/140/157/233`；`requirements / architect / frontend-design / intent-analysis`
    实际走 ToolRegistry（之前列为"不走"是错的）；`src/session/tool-resolver.ts` 不存在，
    `resolveTools` 在 `session/loop.ts:1732`
  - **09-verification-evidence.md** — 头部状态条更新：arbiter 真源是 `acceptance/arbiter.ts`，
    `metrics/arbiter.ts` 不存在；`computeSignature` 从未在 `src/` 中落地；`goal-pool.ts` /
    `engine_evaluation` / `buildRetryFeedbackSection@goal/runner.ts:467` /
    `prefetchAcceptanceContext` 等具体符号已失效；`verification/persist.ts` 实际导出 5 个查询
    helper（含 `findGoalRunEvidence` / `findPreviousAcceptanceEvidence`）
  - **10-worktree-lifecycle.md** — Status: Draft → **Implemented (2026-05-05)**；数据模型
    **以 §3.2 注脚的"per-attempt artifact payload"方案落地，不是 §3.1 在 `engine_goal` 加列**。
    `engine.sql.ts:383-391` 注释明确 Phase B (2026-05-05) 把 workspace 列从 `engine_goal`
    回退，改写到 `engine_artifact[goal_run_attempt].payload`
  - **11-agent-oop-protocol.md** — `ORCHESTRATOR_INSTRUCTIONS` 与 `ACCEPTANCE_AGENT_SYSTEM`
    inline → `.txt` 迁移**已完成**；§七迁移表 `planGoal()` 行整删；新增 `IntegrityAgent` /
    删除后续退役的 `ProsecutorAgent` 当前行；§4.1 待迁移段改为"全部已完成"
  - **13-agent-communication-matrix.md** — 修正"真源文件索引"：build 包没有 `runner.ts` /
    `sub-agent-protocol.ts`，runner 在 `goal/runner.ts`，sub-agent-protocol 在
    `agent/sub-agent-protocol.ts`
  - **14-agent-runtime-mode.md** — 头部对应代码改为 `src/agent/runner.ts`（旧
    `src/agent/runtime/runtime.ts` 已删，`ProviderLLM.stream` 已从 `provider/llm.ts` 移除）；
    §5.2 移除 `planner` 行；2026-06-15 再同步为当前 `intent-analysis / integrity / visual-qa / fact-check / deep-research / frontend-research / goal-workload-analyst`，`prosecutor` 已并入 integrity
  - **16-unified-teardown.md** — `writer.ts:224` → `:234`；`session/revert.ts` 已不存在，
    边界注释目标改指 `engine/rewind.ts`；明确 `engine/runtime.ts:123,182,193` 与
    `goal-status.ts:40-62` 两处 FSM-shaped residue 仍未收口
  - **99-principles.md** — Principle 2 sub-agent 列表删除 `Planner`，补
    `Frontend Design / Intent-Analysis / Integrity`
  - **README + 01 + 13** — 修正 build 包描述：`build/` 实际只有 `agent.ts / index.ts /
report.ts / types.ts` 4 个文件，没有 `runner.ts` / `sub-agent-protocol.ts` / `prompt/`；
    runner 在 `goal/runner.ts`，sub-agent 协议在 `agent/sub-agent-protocol.ts`
  - **README + 03 + 13** — 修正 SSE 端点真源：分散在 5 个 route 文件（主线
    `routes/orchestrator.ts`），`src/server/event.ts` 只是 7 行 BusEvent 声明，不是 SSE 端点
  - **02-data.md** — `goal_id` 描述去掉 `planner` 字眼，改为 `executor / build / evaluator`
- [x] 2026-05-12 同步（follow-up：4 个并行 agent 复核 13 个 numbered spec vs 当前代码）：
  - **01-agents.md** — line 56 build-dispatch 描述：`goal/runner.ts` 只剩 `cleanupGoalWorkspace`
    （121 行），build 派发实际由 `orchestrator/agent.ts:161` + `orchestrator/tools.ts:5075` +
    `build/agent.ts` + `engine/workflow.ts` 协同；line 139 acceptance checks 文件清单换成实际盘上
    `visual.ts` / `runtime-evidence.ts` / `runtime-readiness.ts` / `walkthrough/` /
    `content-fingerprint.ts` / `contract-audit-review.ts` / `project-gate.ts`；line 181-184
    EngineService 暴露 API 改为 `handleTaskMessage` / `injectMessage` / `getBoard` / `getBrief` /
    `getProjectBoard` / `getGlobalTaskBoard`（`taskMessage` / `compileBoard` / `compileBrief` 都不存在）
  - **02-data.md** — `engine_goal` 行补充"无 `status` 列（Phase E 2026-05-05 退役）+ 无
    `workspace_*` / `retry_count` / `cascade_state`（Phase B+E 2026-05-05，单源迁到 `engine_artifact`
    payload via `findGoalLatestWorkspace` / `getGoalRetryCount`）"；Trace 段把
    `Trace.event()` / `agent/runtime/stream-failures.ts` 替换为实际命名空间
    `AgentTrace.recordLLMRequest / recordHelperLLMCall / recordAgentReport` 与四个挂点
    （`session/llm.ts` / `agent/agent.ts` / `agent/runner.ts` / `orchestrator/agent.ts`）
  - **03-control.md** — `createTask` → `handleTaskMessage` 流；Trace 一行同 02；
    `routes/orchestrator.ts` describeRoute 数 41 → 42
  - **04-extensions.md** — 调用链描述更正：worktree 创建是 `Worktree.create`，
    实际从 `build/agent.ts` + `orchestrator/tools.ts` 调用；`goal/runner.ts` 只承担清理
  - **05-config.md** — 顶层字段补 `disabled_providers / small_model / default_agent /
preview / terminal / locale`；移除"每个 agent 都有 `max_steps · timeout_ms · quality_threshold
· max_attempts · skills[]`"的谬误（`config.ts:1259-1365` 实际每个 agent 字段集
    不一样：build = max_steps+skills，acceptance = +max_retries，acceptance_visual = numeric
    thresholds，activity = idle/timeout ms gates）；标注 2026-05-11 新增 `locale` 与
    Overlay UI locale 的区分
  - **06-provider.md** — Layer 6 溢出 regex 数 12 → 19（`provider/error.ts:8-28`）；
    Layer 4 删除不存在的 "Copilot chat/responses"，补 Azure responses API / Anthropic
    beta header / OpenCorvus free-tier filter / DashScope dynamic key（实际 loader 在
    `vendor.ts:20-91`）
  - **07-panel.md** — Appearance > Locale 区分 Layer 1 vs Layer 2；Workflow 区移除
    speculative `Auto-select Workflow` toggle，补真实 builtin IDs（`direct` / `pipeline`，
    `engine/workflow.ts:262-265`）；Agent Config 区移除虚构 `max_steps:30 timeout:5min
quality:0.5` 默认值（真实默认 `max_steps: 1000`，无 timeout / quality 字段，
    见 `engine/config.ts:170-212`）
  - **07-panel-reactivity.md** — `pipeline.build` workflow 修正为 1 个 phase
    `{id:"build", sessionKind:"build"}`（`engine/workflow.ts:232-234`），不是
    `[plan, build, evaluate]` 3 个；`goalStagePhaseID`
    （`overlay/src/utils/workflow-step.ts:25-35`）只映射 `planner → {build, plan}` 和
    `build → {build, build}`，其他全部返回 null
  - **08-agent-tool-adapter.md** — 头注修正 #7 扩展：stage agent 走 ToolRegistry；
    2026-06-15 再同步：`prosecutor` / `deliver` / `publish_acceptance` 已退役，
    orchestrator workflow/control tools 由 `createOrchestratorTools()` 自建，
    `agent.ts` include 列表负责暴露全部自建工具。
  - **09-verification-evidence.md** — 头部加 `engine_evaluation` 表已删除（`engine.sql.ts:552-556`）
    的注释；保留 `EngineEvaluation*` 类型仍存活（`engine.sql.ts:120-160`）；补 2026-05-10
    后的事实：`AcceptanceSpec.scenario`（`acceptance/types.ts:24,119`）、
    `engine_artifact.kind="orchestrator-stream-error"`、integrity post-build + freshness
    gate、ContractIR/Linker/contract_audit 链接、arbiter 真源导出列表
    （`arbitrateAcceptanceGate` / `arbitrateAcceptanceVerdict` / `appendManifestEvidence`）
  - **11-agent-oop-protocol.md** — §三 inheritance hierarchy 删除 `RetiredPlanningRole`；
    BuildAgent 双路径注（SessionAgent vs PipelineAgent）；§4.1 prompt 目录表对齐实际盘上文件；
    2026-06-15 再同步：`acceptance` / `prosecutor` 不再是当前 native agent，
    current whitelist 改指 `frontend-research` / `workload-analysis` / `visual-qa` /
    `integrity` / `fact-check` / `deep-research` 与 orchestrator tool include 真源。
  - **13-agent-communication-matrix.md** — 真源文件索引删重复条目（`src/goal/runner.ts`
    出现两次，第二条还自带"已在上一条单独列出"自承认）
  - **14-agent-runtime-mode.md** — §6.3 `ProviderLLM.stream` 描述改写为说明 Phase E
    已移除（`provider/llm.ts:6-14`）；明确该约束跨删除依然有效
- [ ] 新 SVG 三张总览图按最新 MD 重绘（暂未做）
