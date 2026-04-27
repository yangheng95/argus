# new-arch — 架构文档（拆分版）

> 替代原 1336 行单 SVG。现在按「4 主题 MD + 3 瘦身 SVG」维护。
> 旧 SVG 已归档为 `_archive-old-arch.svg`，阶段 1 工作笔记为 `00-sync-notes.md`。

## 目录

### 总览（SVG 框图）

| 文件 | 展示内容 |
| --- | --- |
| [01-agents.svg](01-agents.svg) | 图 1 — Agent 家族调用链（Gateway → Loop → sub-agents → Executor） |
| [02-data.svg](02-data.svg) | 图 2 — 数据面（orchestrator 18 表 + Trace/Bus 横切） |
| [03-control.svg](03-control.svg) | 图 3 — 控制面与扩展入口 |

### 详细文档（MD）

| 文件 | 主题 | 对应旧 SVG Section |
| --- | --- | --- |
| [01-agents.md](01-agents.md) | Agent 家族、Task Control Loop、MiniWorkflow（direct/pipeline）、task kind | A · C · H · I |
| [02-data.md](02-data.md) | `engine_*` 18 表、session 域、Trace/Bus 横切、Decision Log | C · D · K |
| [03-control.md](03-control.md) | ChannelIngress · ControlMessage · Panel Capability 路由 | L + 新 |
| [04-extensions.md](04-extensions.md) | Executor / Plugin / MCP / ACP 四条扩展入口 | G（扩展） |
| [05-config.md](05-config.md) | Unified Config 三层分离 + PATCH 流程 | F |
| [06-provider.md](06-provider.md) | LLM Provider 六层适配 | G |
| [07-panel.md](07-panel.md) | Workbench / Panel 重设计 + SSE 事件 | J |
| [08-agent-tool-adapter.md](08-agent-tool-adapter.md) | Agent ↔ Tool include/exclude 适配协议 | 新 |
| [09-verification-evidence.md](09-verification-evidence.md) | Verification Evidence（已迁移至 `engine_artifact` kind="verification-evidence"） | 新 |
| [10-worktree-lifecycle.md](10-worktree-lifecycle.md) | Goal worktree 生命周期与 ff-only merge-back | 新 |
| [11-agent-oop-protocol.md](11-agent-oop-protocol.md) | Agent OOP 协议：BaseAgent / CapabilityContract / Mailbox / Registry / Whitelist（草稿，未实施） | 新 |
| [12-overlay-card-system.md](12-overlay-card-system.md) | Overlay 统一卡片系统：Shell / Payload / Policy / Writer（目标设计，未完全实施） | 新 |
| [13-agent-communication-matrix.md](13-agent-communication-matrix.md) | Agent 通信矩阵：预期 whitelist vs 当前实现的 direct/indirect 路径 | 新 |
| [14-agent-runtime-mode.md](14-agent-runtime-mode.md) | Agent 抽象修正：AgentSpec / RuntimeMode / ContextStrategy / BudgetPolicy | 新 |
| [15-no-fsm.md](15-no-fsm.md) | 状态机全砍计划（DEPRECATED，并入 16） | 新 |
| [16-unified-teardown.md](16-unified-teardown.md) | 统一拆除：向 Claude Code / Codex 极简模型看齐 | 新 |
| [2026-04-27-task-rewind-code-resource.md](2026-04-27-task-rewind-code-resource.md) | Task rewind 与代码 worktree 资源协同 | 新 |
| [spec-vscode-extension.md](spec-vscode-extension.md) | VSCode 扩展规格 | 新 |
| [99-principles.md](99-principles.md) | 核心原则、anti-patterns、非协商约束 | B · E |

### 归档与工作笔记

| 文件 | 说明 |
| --- | --- |
| [00-sync-notes.md](00-sync-notes.md) | 阶段 1 概念对齐笔记（三张 mental model 初稿） |
| [_archive-old-arch.svg](_archive-old-arch.svg) | 原 `specs/new-arch.svg`（1336 行）归档 |

## 三张总览框图（SVG 瘦身目标）

拆分完成后 `new-arch.svg` 只保留三张图：

1. **Agent 家族调用链**（图 1）—— ChannelIngress / ControlMessage → EngineService → Orchestrator → sub-agents
2. **数据面**（图 2）—— `engine_*` 18 表 + 横切 Trace/Bus
3. **控制面 + 扩展入口**（图 3）—— channel/control/panel-capability + executor/plugin/mcp/acp

> SVG 框图（01/02/03-*.svg）尚未根据本轮重构更新；以 MD 为准。

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

## 迁移进度

- [x] 目录 + README + 骨架
- [x] 01-agents.md 填充
- [x] 02-data.md 填充
- [x] 03-control.md 填充
- [x] 04-extensions.md 填充
- [x] 新 SVG 三张总览图（01/02/03-*.svg）
- [x] 旧 new-arch.svg 归档为 `_archive-old-arch.svg`
- [x] 工作笔记归入 `00-sync-notes.md`
- [x] 05-config.md · 06-provider.md · 07-panel.md · 99-principles.md 全部填充
- [x] `src/calculator/` 已删除（零消费者，git rm）
- [x] 2026-04-17 同步：`orchestrator/` → `engine/` · `task-agent/` → `orchestrator/` ·
      `orchestrator/service.ts` → `task-api/index.ts` · `evaluator/` → `delivery/checks/` ·
      `control-plane/` 拆并入 `workspace/` + `util/sse.ts` ·
      `session.channel_key` + `session_gateway_singleton_idx` 移除 ·
      `panel/api.ts` + `panel/settings.ts` 移除
- [x] 2026-04-27 同步（本轮）：
  - `engine_*` 表从 18 张缩到 13 张（Phase 6 把 `engine_run` / `engine_goal_run` /
    `engine_delivery` / `engine_evaluation` / `engine_goal_snapshot` 合并为 `engine_artifact` + `kind` 区分）
  - `engine/goal-pool.ts` 与 `pipeline/executor.ts` 已删除，调度逻辑并入 build tool + `goal/runner.ts`
  - `orchestrator/tools.ts` 当前导出 19 个 tool（不止 `requirements / design_analysis / architect / build / deliver`）
  - `panel/capability.ts` 当前注册 19 个 action（详见 03-control.md）
  - `executor/` 新增 `codex.ts` / `bootstrap.ts` / `discovery.ts` / `external-process.ts` / `managed.ts` / `runtime-env.ts`
  - `provider/` 拆出 `vendor-headers.ts` / `vendor-messages.ts`；新增 `policy.ts` / `hexin-discovery.ts` / `hexin-profiles.ts`；删除 `codex-live.ts`
  - `mcp/` 新增 `stdio.ts`
  - 修正：`gateway/` **未整删**，保留 3 个文件（SDK gateway 客户端会话辅助）
  - SessionKind 枚举更新为 16 种（含 `orchestrator` / `intent-analysis` / `integrity` / 保留 `gateway`）
  - 09-verification-evidence.md / 12-overlay-card-system.md / 11-agent-oop-protocol.md
    在头部补"实施状态"标注，区分"目标设计"与"代码现状"
  - 15/16 文档头部补 follow-up TODO（runtime.ts status 分支 / goal-status mapRunStatus / teardown 多源）
- [ ] 新 SVG 三张总览图按最新 MD 重绘（暂未做）
