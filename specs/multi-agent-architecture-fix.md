# Multi-Agent 架构系统性修复方案

状态：草案 · 2026-04-24 · 作者：架构审视

本文档针对 OpenCorvus 当前 multi-agent 系统的 8 个结构性问题，给出**根治**方案。每个问题包含：现状证据、根因、修复设计、落地步骤、验收标准。

**合规约束**（CLAUDE.md 强制）：

- 规则 1 / 22：禁止 fallback、禁止双源。所有修复直接替换旧方案。
- 规则 2：删除旧代码，不保留兼容路径。
- 规则 18：拦截错误设计（包括作者自己的）。本 spec 审查的是架构，同样接受同等审查。
- **规则 23（核心约束）**：禁止任何形式的状态机实现（if-else / switch / 状态枚举）做流程控制。流程控制必须由 LLM 读证据做决策。本 spec 的 P3 / P5 / P7 早期草稿违反此规则（用代码路由/kind 枚举），已修正为"收缩 LLM 决策面 + 让 LLM 决策"。
- 规则 26：不过度抽象。本 spec 拒绝为未发生的场景铺设施。
- 规则 28：任何修复要考虑继承/多态的系统性影响。

---

## 0. 问题清单

| ID | 标题 | 严重度 | 类型 |
|---|---|---|---|
| P1 | 质量门 5 层叠加，信号重复 | 高 | 架构 |
| P2 | shared glue 单归属规则结构不成立 | 高 | 架构 |
| P3 | 8 档 rework 阶梯是隐式状态机 | 高 | 架构 |
| P4 | build agent 三模式共用同一 prompt | 中 | 契约 |
| P5 | delivery 验收 floor 过拟合 UI | 中 | 契约 |
| P6 | agent 间无探索结果共享 | 中 | 性能 |
| P7 | 模型路由按 stage 固定不看 task | 低 | 性能 |
| P8 | fidelity 原地改 architect 输出 | 中 | 边界 |

---

## P1. 质量门 5 层叠加 → 砍到 2 层

### 现状

同一份交付物被以下 agent 重复裁决：

1. 每个 goal 的 `acceptance_specs` — executor 自测，存 evidence
2. Architect 登记的 `metric ruler`（`functional_correctness` 等 4 个 blocking 指标） — Arbiter 评
3. `fidelity` agent — 对 architect 输出做 REQ 覆盖审
4. `delivery` agent — 重跑所有 acceptance_specs、视觉比对、启动验证（Phase 1-4）
5. `prosecutor` agent — 反方，对 delivery verdict 举反例

证据：
- `delivery/agent.ts:631` "Treat acceptance_specs as INFORMATION, not pre-computed"
- `delivery/prosecutor.ts:283` "Budget: 1/iter, 3/task max"
- `delivery/prosecutor.ts:295` "'nothing to file this iteration' outcome is legitimate"

### 根因

用"加 agent"解决质量问题。每一层单独看都合理，叠加后：
- 一次 N=6 的 pipeline iteration ≥ 2N+4 = **16 次 LLM 调用**
- 同一 acceptance_spec 被 executor 和 delivery 各跑一次
- prosecutor 存在即空转（大多数 task 3/3 预算用不完）

### 修复设计

**保留两层：**

```
Deterministic gate (Layer 1)            LLM gate (Layer 2)
─────────────────────────               ──────────────────
build/test/typecheck/lint       +       delivery (唯一 LLM 终审)
acceptance_specs[].scorers              - 跑 Layer 1 剩下无法确定性验证的 rubric/judge
(由 GoalPool 直接执行)                  - 启动验证 / 视觉对比 / 集成验证
                                        - 出 verdict
```

**删除：**

1. `delivery/prosecutor.ts` 整个模块 + Prosecutor agent registration + `register_challenge_seed` 工具
2. `architect/fidelity.ts` 的**独立 LLM 调用**；fidelity 检查作为 `finalize_architect` 的同步 validator（纯代码规则：REQ 覆盖率、孤立 goal 检测、blocking metric 齐全）
3. Architect 的 `register_goal_metric_spec` / `register_global_metric_spec` 工具及 metric_ruler 系统 —— 冗余。acceptance_specs 已经是合同。

**改动边界：**

- `goal_pool` 在 executor 完成后**代码直接跑** `acceptance_specs[].scorers`（shell 类的直接跑，llm_judge 类的标记为 pending），结果写 evidence。
- Delivery Phase 1 只跑 **pending 的 llm_judge + 全局集成验证**（项目级 build/test/lint），不再重跑 executor 已经跑过的 shell scorers。
- Delivery Phase 2.5（并行 subagent review）保留——这是 delivery 拆分注意力的内部工具，不是独立 agent。

### 落地步骤

1. 删除 `packages/opencorvus/src/delivery/prosecutor.ts`、prosecutor 相关 DB 迁移、orchestrator 中对 prosecutor 的调用点
2. 删除 `packages/opencorvus/src/architect/fidelity.ts` 的 LLM agent 路径，改为 `validateArchitectOutput(goals): ValidationResult` 纯函数
3. Architect prompt：删除 Phase 5 METRIC RULER 整段（`architect-core.txt` L212-275），删除 mandatory metric 表述
4. Delivery prompt：Phase 1 改为"only run scorers not already executed by goal_pool"；Phase 2 删除"重跑所有 heuristic-shell"的要求
5. `engine_iteration` 表：保留 metric trajectory schema，填充源从 goal_pool 的 scorer 执行结果 + delivery verdict 两处
6. 删除 `register_challenge_seed`, `propose_challenge_metric`, `mark_counterexample`, `resolve_counterexample` 所有相关代码和 DB 表

### 验收

- pipeline N=6 任务的 LLM 调用次数从 ≥16 降到 ≤10（intent+requirements+architect+6×build+delivery）
- 单次迭代总时长 -30%
- acceptance 通过率不下降（对比 20 个历史 task 的 fixture replay）

---

## P2. Shared Glue 单归属规则 → 显式 Glue Contract

### 现状

`architect-core.txt:85`："No shared glue files across goals. Root App.tsx, router entry, DI wiring, main.ts... Assign them to exactly ONE goal at a time."

证据这规则结构不成立：
- Delivery Phase 0 的存在本身（`delivery/agent.ts:716-735`）是规则破产的事后修复
- Prompt 自述 "Two goals may have independently created near-duplicate helpers"

### 根因

把 glue 当作**普通文件**管理。Glue 文件的本质是**多生产者 + 单消费者的注册表**，物理上是一个文件，语义上是多个独立片段的聚合。物理单归属 ≠ 语义单归属。

### 修复设计

引入 **GlueContract**：architect 显式把 glue 文件建模成一个有合约的聚合点。

```typescript
// packages/opencorvus/src/architect/types.ts (新增)
interface GlueContract {
  id: string                 // "glue-router", "glue-index"
  path: string               // "src/router.ts"
  kind: "registry" | "barrel" | "bootstrap"
  aggregator_goal_id: string // 唯一写入该文件的 goal（拼装 goal）
  contributors: Array<{
    goal_id: string
    contribution_type: "export" | "register_call" | "import"
    contribution_spec: string // e.g. "export { UserRoute } from './routes/user'"
  }>
}
```

**执行语义：**

1. Architect 识别每个 glue 文件，登记 `GlueContract`。contributor goal 只声明**它要贡献什么**，不直接写 glue 文件。
2. Contributor goal 在自己的 worktree 只写业务代码 + 写一个 `glue-manifest.json`：

   ```json
   { "glue_contracts": [{ "id": "glue-router", "contribution": "export { UserRoute } from './routes/user'" }] }
   ```

3. Aggregator goal（architect 指定的"拼装 goal"，一般是最后一个依赖所有 contributor 的 goal）读所有 worktree 的 `glue-manifest.json`，生成 glue 文件。**aggregator 不实现业务逻辑，只拼装**。
4. Delivery Phase 0 的 "reconcile dangling imports / duplicate implementations" 工作**消失**——merge 时根本不会有冲突。

### 落地步骤

1. `architect/types.ts` 加 `GlueContract` 类型，`register_glue_contract` 工具
2. GoalContract 加字段 `glue_contributions: Array<{ glue_id, contribution }>`
3. `goal_pool` 在 executor 启动前把 `glue_manifest.json` 模板塞进 worktree；executor 写业务代码时按模板写 manifest
4. 新 agent stage `aggregator`（或让 delivery Phase 0 读 manifest 生成 glue 文件，二选一——优先后者，不加 stage）
5. `delivery/agent.ts` Phase 0 重写：从"找冲突、修冲突"改为"读 manifest、生成 glue"。若读出的 manifest 有真冲突（两个 contributor 声明同 id 同 contribution），直接 reject + 指向 architect 重划 contract
6. Architect prompt L85 改为引用 GlueContract 机制，删除"assign to one goal"表述

### 验收

- 合并冲突率从当前 X% 降到 0%（glue 文件无冲突，因为没人直接写）
- Delivery Phase 0 的工具调用次数平均 -80%
- architect 产出的 goal 图里，glue 文件不再出现在任何 contributor 的 owned_paths

---

## P3. 8 档 rework 阶梯 → 2 档（LLM 决策，非代码路由）

### 现状

`orchestrator/agent.ts:566-577` 的"escalation ladder"有 8 档：

1. Transient → no-op
2. Contract gap → modify_goal
3. Missing functionality → architect re-run
4. Default → build 作为 rework hammer
5. Single-goal internal bug → retry_goal
6. 两连拒同 goal → architect full regen
7. Requirements 错 → restart_from_stage
8. Shared-state obstacle → build 修环境

LLM 每次迭代都在这 8 档里做一次分类，选错浪费一整轮。

### 根因

不是"LLM 决策不好"，是**决策空间设计太大**。8 档里 6 档是少数场景的特例（如 rung 6 "两连拒"、rung 8 "shared-state obstacle"），塞进主流程只会加噪。

**不能**通过代码 `if-else` 来收敛决策（违反规则 23）。必须通过**缩小 prompt 决策面**来让 LLM 稳定选对。

### 修复设计

Orchestrator prompt 的 rework 段只暴露**两个工具**给 LLM：

```
rework tools:
- `build`     — 在合并树上改任意文件，修集成/跨 goal 问题/通用缺陷（默认选项）
- `architect` — 改 goal 图本身（加/删/改 goal、调整 owned_paths / contracts）

Pick `architect` ONLY when the rejection_details show that the current goal graph
cannot express the fix — e.g. a whole requirement has no goal owning it, or the
same goal's contract is unsatisfiable. Everything else picks `build`.
```

LLM 看 rejection_details 做判断——这正是规则 23 要求的"依赖 LLM 智能管理流程"。

**工具层收缩（代码改动，不是状态机）：**

- 从 orchestrator 的工具注册表中下架 `retry_goal`、`modify_goal`、`dispatch_goal`、`restart_from_stage` 这些低层工具——它们不是"状态机节点"，它们是"LLM 面前的选项"。**下架 = 减少 LLM 的选择，不是 = 让代码替 LLM 选**。
- `restart_from_stage` 保留为 operator 命令（用户显式发），不进 orchestrator 自主决策循环。
- 底层 goal 调度机制（`modify_goal` 的 DB 操作、worktree 分发）保留在 architect agent 的工具集里——architect 被调用时自己用这些工具去动 goal 图。

### 落地步骤

1. Orchestrator prompt：删除 "escalation ladder" 整段（L566-577），改为上面两行 `build` / `architect` 的 rework 段
2. 从 orchestrator 工具列表中移除 `retry_goal`、`modify_goal`、`dispatch_goal`（保留在 architect 的工具集里）
3. Orchestrator prompt 的"rework 指引"段只保留：rejection_details 的语义描述 + 两个工具的适用条件 + 一句"prefer build, pick architect only when goal graph is unsalvageable"
4. 删除所有"escalation"、"rung"、"ladder"措辞——单一原则：LLM 读 rejection_details 挑 build 或 architect
5. 监控：trigger 到 tool-dispatch 间**没有**任何新增的 if-else 路由代码

### 验收

- Orchestrator prompt 从 ~180 行降到 ~100 行
- Rework trigger 到 tool call 之间的代码路径是**纯 LLM 决策**（不含新增 if-else）
- rework 选错档位的误选率（当前因 8 档复杂）通过"缩小决策面"降低——通过 fixture replay 对比测得

---

## P4. build agent 三模式 → 显式 Mode 字段

### 现状

同一份 `agent/prompt/build.txt` 被三种场景调用：

| 模式 | 权限 | 期望 |
|---|---|---|
| Direct | 整棵树读写 | 端到端完成任务 |
| Per-goal | worktree + 仅 owned_paths 可写 | 严按 contract，不越界 |
| Rework hammer | 合并树读写 | 跨 goal 修 glue，越界是本职 |

Prompt 不区分，agent 只能从 user prompt 格式猜。

### 根因

"一个 build 干所有事"是早期简化。代价是 agent 行为不可预测：per-goal 模式下 LLM 可能越界改他 goal 的文件，rework 模式下又可能保守不敢跨 goal 改。

### 修复设计

**方案 A（推荐）**：保留单一 agent，prompt 头部强制 Mode 段，调用方必须填。

```
# Mode: {{direct|per-goal|rework}}

## If Mode=direct
- You see the full tree. Implement the user's request end-to-end.
- owned_paths 不存在；你对整棵树负责。

## If Mode=per-goal
- You see a GoalContract. Write ONLY to files in `owned_paths`.
- Cross-goal interfaces: import from dependency `exports`, do NOT touch their files.

## If Mode=rework
- You see a merged tree + rejection_details.
- Cross-goal edits are ENCOURAGED — fix integration glue, rename symbols project-wide.
- owned_paths 不约束你。
```

调用方（SessionProcessor / GoalPool / Orchestrator rework）在构建 user prompt 时**必须**顶部写 `# Mode: xxx`，缺失则 agent 硬拒（代码在 build runtime 检查）。

### 落地步骤

1. `agent/prompt/build.txt` 顶部加 Mode 段（替换 L3 开场白为 Mode-aware 版本）
2. 新建 `agent/runtime/build-mode.ts`，定义 `BuildMode = "direct" | "per-goal" | "rework"` 和 prompt 装配函数
3. 三个调用点改造：
   - `SessionProcessor`（direct）→ 在 user prompt 顶部注入 `# Mode: direct`
   - `GoalPool.executeGoal`（per-goal）→ 注入 `# Mode: per-goal` + GoalContract
   - `Orchestrator` rework 调用 build → 注入 `# Mode: rework` + rejection_details
4. `AgentRuntime` 对 agent=build 的请求做前置 assert：user prompt 必须以 `# Mode: ` 开头，否则抛 `BuildModeMissingError`

### 验收

- per-goal 模式下 executor 写 owned_paths 外文件的事件归零（当前偶发）
- rework 模式下跨 goal 修复成功率上升（当前 LLM 有时保守不敢跨 goal）

---

## P5. Delivery 验收 floor 按 task 分流

### 现状

`delivery/agent.ts:620-624` 硬性要求 accept 前必须有：启动应用、curl HTTP、puppeteer 截屏。

L837 有 library 例外但与 L624 "If any of these three is missing, you may NOT accept" 直接冲突。puppeteer 需要 Chrome 二进制，CI 不一定有。

### 根因

把"视觉任务的验收"硬编成"所有任务的 floor"。违反规则 15（通用工具）。

### 修复设计

**禁止引入 `DeliveryKind` 枚举 + `classifyDelivery()` 代码分类器**——那会是规则 23 明文禁止的"状态枚举 + if-else 路由"。

正确做法：**让 LLM 看原始证据自己判断该跑哪些验证**。Delivery prompt 的硬 floor 拆解成**一组验证工具 + LLM 的选择指引**，不是一组预设 kind × 预设 floor 的组合。

**改动 1：删除硬 floor。**

`delivery/agent.ts` L620-624 的 "personal-verification floor (non-negotiable)" 整段删除。改为：

```
## Evidence your verdict must carry

Your accept verdict must be grounded in tool-call evidence that matches what the
task actually produced. Run the subset of these that applies to THIS task; skip
the others with an explicit "N/A — <reason>" in deferred_checks:

- Build / test / typecheck / lint (always, when the project defines them)
- App startup + HTTP response capture (when the deliverable is a running service
  or web app — judge from the changed files and task request)
- Browser screenshot via puppeteer-core (when the deliverable is a web UI with a
  visual reference attached)
- Public API smoke invocation (when the deliverable is a library)
- CLI invocation + stdout assertion (when the deliverable is a CLI)
- Docs lint / link check (when the diff is docs-only)

You choose which set applies by reading `changedFiles`, `attachments`, and
`task.request`. A library delivery does NOT need a browser screenshot; a docs-only
delivery does NOT need app startup. Forcing irrelevant checks is noise, not rigor.
```

**改动 2：skill 注入走**_signal_**驱动，不走**_kind_**枚举。**

已有的 `TaskSignals` (`has_attachment_image`, `request_contains_url`, `package_has_script`) 是**特征信号**不是状态枚举，不违反规则 23。扩展 skill 文件按 signal 声明 auto_detect：

- `skills/delivery-visual.md` — `auto_detect: { task_signals: { has_attachment_image: true } }`，内容是视觉任务的验证指引 + `required_tools: ["puppeteer_screenshot"]`
- `skills/delivery-service.md` — `auto_detect: { task_signals: { package_has_script: ["start", "dev"] } }`，内容是服务任务的启动+curl 指引
- 不再为 library / cli / docs 预设 skill——它们没有独特的 signal 指征，让 LLM 从 base prompt 自己推。

**关键区别**：signal → skill 的映射是**特征检测**（文件/配置存在性），不是**状态判定**。LLM 拿到注入的 skill 内容自己决定怎么用；没有枚举、没有 kind 切换、没有"现在是 X 模式"的状态。

**改动 3：`required_tools` 校验保留但松绑。**

`skill-inject.ts:34-46` 当前是"有 required_tools 就强制 accept 前必须调"。改为"强制列为 tool_call_evidence 里的一条，但 LLM 可用 `{ passed: false, reason: "N/A — <why>" }` 声明不适用"——这本身就是 LLM 决策，不是代码判定。

### 落地步骤

1. `delivery/agent.ts::DELIVERY_AGENT_SYSTEM` 替换 L620-624 的硬 floor 为上面"Evidence your verdict must carry"段
2. 新增 `skills/delivery-visual.md`（signal: `has_attachment_image`） + `skills/delivery-service.md`（signal: `package_has_script: [start, dev]`）
3. `skill-inject.ts` 的 `required_tools` 校验增加"N/A with reason" 出口（LLM 可显式声明不适用）
4. 扫描代码库确认**没有**新增任何 `DeliveryKind`、`classifyDelivery`、`switch(kind)`、`if (kind === ...)` 类型的代码
5. 删除 `DELIVERY_AGENT_SYSTEM` 中"If the project is a library, verify compile + tests instead of startup"这条旧的硬编码特例（L950，现已由 LLM 自行判断覆盖）

### 验收

- library / docs task 的 puppeteer 调用次数归零——**验证方式**：fixture replay 统计
- Chrome 缺失环境的 task 不再因 floor 失败
- UI task 的视觉验证严格度不下降（has_attachment_image skill 注入后 LLM 看到明确指引）
- **静态检查**：grep 代码库 `DeliveryKind|classifyDelivery|kind\s*===` 返回 0 命中（保证没违反规则 23）

---

## P6. Agent 间无探索共享 → ProjectSnapshot

### 现状

Requirements、Architect、Planner×N、Delivery 各自重复读 `package.json`、入口文件、测试文件。一轮 pipeline 里同一个文件被读 5-10 次，每次占用对应 agent 的 context。

### 根因

只有"决策产物"（Decision Log、GoalContract）在 agent 间流转；**探索动作**（"我看过哪些文件、它们说了什么"）没有流转通道。

### 修复设计

Requirements 阶段结束时产出 **ProjectSnapshot**，落盘 `.opencorvus/snapshots/<task_id>/project.json`：

```json
{
  "package_manager": "bun",
  "runtime": "bun",
  "test_framework": "bun:test",
  "entry_points": ["packages/opencorvus/src/index.ts"],
  "test_files_sample": ["src/auth/auth.test.ts"],
  "key_configs": {
    "tsconfig": "packages/opencorvus/tsconfig.json",
    "package_json": "packages/opencorvus/package.json"
  },
  "module_graph_digest": "sha256:...",
  "file_summaries": {
    "src/api/index.ts": "Hono app, mounts /api/stocks, /api/trades",
    "src/types/index.ts": "Stock, Portfolio, Trade types"
  }
}
```

下游 agent prompt 拼装时注入 `ProjectSnapshot` 的摘要段，而不是让它们自己探。Agent 仍可按需 `read_file` 读细节，但不必重跑 package.json 之类的常规探索。

### 落地步骤

1. 新增 `packages/opencorvus/src/project/snapshot.ts`，定义 ProjectSnapshot schema 和 `buildProjectSnapshot(taskID)`
2. Requirements agent 在 `finalize_requirements` 之后同步调 `buildProjectSnapshot` 落盘
3. Architect / Planner / Delivery 的 prompt 装配函数接受 `ProjectSnapshot`，作为 "# Project Snapshot" 段注入
4. Architect prompt 删除"Phase 2: EXPLORE"段中对 package.json / 测试文件的要求（已在 snapshot 里），保留对任务相关模块的探索要求
5. Planner prompt 删除 `Rules - EXPLORE the codebase first`（改为"consult ProjectSnapshot; explore only the task-specific modules"）

### 验收

- 平均一轮 pipeline 的 `read_file(package.json)` 调用数从当前 5-8 次降到 1 次
- 下游 agent 首轮 context 中重复的探索性 read_file 减少 ≥50%
- Snapshot 本身的 token 成本 < 节省的总 token 成本（从 fixture 验证）

---

## P7. 模型路由按 task 特征分流

### 现状

`resolveAgentModel("delivery")` 只看 stage，不看 task。UI 任务和 library 任务走同一模型。

### 根因

模型路由设计时没接入 TaskSignals 通道。纯遗留，不是设计错误。

### 修复设计

同 P5，**禁止用 `DeliveryKind` 枚举做路由**（规则 23）。路由维度改为**特征信号**：

```typescript
resolveAgentModel(stage: string, ctx: {
  sessionID?: string
  taskID?: string
  taskSignals?: TaskSignals   // 已有：has_attachment_image / request_contains_url / package_has_script
}): Promise<ProviderModel>
```

配置层（`opencorvus.jsonc`）按 signal 声明 override，每个 override 独立评估、不构成状态机：

```jsonc
{
  "agent": {
    "delivery": {
      "model": "anthropic/claude-sonnet-4-6",
      "signal_overrides": [
        { "when": { "has_attachment_image": true }, "model": "anthropic/claude-opus-4-7" }
      ]
    }
  }
}
```

**关键**：多个 signal_override 按顺序**叠加**取第一匹配——这是**配置数据**，不是代码 if-else。`resolveAgentModel` 是遍历配置数组，不是硬编码分支。

### 落地步骤

1. `agent/model.ts::resolveAgentModel` 加 `ctx.taskSignals` 参数
2. `EngineConfig` schema 加 `signal_overrides: Array<{ when: Partial<TaskSignals>, model: string }>` 字段
3. 解析逻辑：遍历 signal_overrides，第一个所有 `when` 字段都被 taskSignals 满足的条目胜出；否则 stage default
4. Delivery 调用点传 `taskSignals`；其他 stage 暂不接（没有区分信号）
5. 静态检查：grep `if.*kind\s*==|switch.*kind|DeliveryKind` 返回 0

### 验收

- 有图片附件的 delivery 命中 override 模型率 100%
- 无图片附件的 delivery 不受 override 影响
- 配置增减 signal_override 条目**无需改代码**

---

## P8. Fidelity 不再原地改 architect 输出

### 现状

`architect-core.txt:31` "your final goal set may differ slightly from what you registered" — architect 不知道自己最终输出。Fidelity 原地修改破坏 agent 边界。

结合 P1 的修复（删除 fidelity LLM agent），P8 自动消失：validator 改成纯函数，只返回 ok / errors，architect 自己迭代直到通过。

### 修复设计

见 P1 的 fidelity → validator 重构。补充：

- Validator 返回 `{ ok: boolean, errors: ValidationError[] }`
- architect 在 `finalize_architect` 后拿到 errors，自己决定修复哪些、再次 finalize
- 没有任何 LLM 代 architect 改它的输出

### 落地步骤

并入 P1 落地步骤 2-3，不单独列。

### 验收

- architect re-run 时 seed 的 goals 是 architect 自己最后 registered 的那份，不存在 fidelity 改过但 architect 不知道的情况
- architect 产出一致性（相同输入两次跑产出相同）- 当前因 fidelity 干预有波动

---

## 实施顺序与依赖

```
P1 (砍 prosecutor + fidelity-as-agent)
 ├─ 前置：无
 └─ 自动触发 P8

P2 (GlueContract)
 ├─ 前置：无
 └─ 解锁 delivery Phase 0 简化

P4 (build Mode)
 ├─ 前置：无
 └─ 独立

P3 (rework 代码路由)
 ├─ 前置：P1 完成（prosecutor 删除后 trigger 路径简化）
 └─ 独立

P5 (delivery kind 分流)
 ├─ 前置：无（可与 P1 并行）
 └─ 解锁 P7

P6 (ProjectSnapshot)
 ├─ 前置：无
 └─ 独立

P7 (模型路由)
 └─ 前置：P5（deliveryKind 来自 P5）
```

**建议 Sprint 划分：**

- **Sprint 1（1 周）**：P4 + P1 前半（删 prosecutor）— 低耦合，收益立显
- **Sprint 2（1 周）**：P1 后半（fidelity 改 validator） + P8 + P3 — 连锁改动
- **Sprint 3（1.5 周）**：P2（GlueContract）— 最复杂，需跨 architect/goal_pool/delivery
- **Sprint 4（1 周）**：P5 + P7 + P6 — 性能优化收尾

---

## 不做的事

以下曾被考虑但决定不做：

1. **不引入 aggregator stage agent**。P2 的 glue 拼装由 delivery Phase 0 读 manifest 完成，不再加一个 stage。增加 stage 违反规则 26（过度工程）。
2. **不把 intent-analysis 与 requirements 合并**。两者输出形状差异明显（class/complexity vs REQ-N），合并会导致单 prompt 过载（规则 26）。目前分离是合理的。
3. **不为 architect 引入 skill 注入**。Architect prompt 已经是系统最复杂的一份；加 skill 层只会让调试更难。语言特化通过 ProjectSnapshot 传递更干净（P6）。
4. **不引入 task-level caching layer**。P6 的 ProjectSnapshot 是针对 task 内部的一次性快照，不是持久化 cache，避免旧快照污染新任务。
5. **不引入 `DeliveryKind` / `classifyDelivery` / `pickRework` 等代码分类器或路由器**。规则 23 明文禁止。任何需要"根据 X 选 Y 再跑对应分支"的意图，必须转换为"把 X 作为证据暴露给 LLM，LLM 自己选 Y"。这是本 spec 最容易滑坡的地方——审阅时要重点盯。

## 实施期间的规则 23 自检清单

每个 PR 合并前必须过一遍 grep：

```bash
# 任何命中都需要解释为什么不是状态机
grep -rnE "type\s+\w+Kind\s*=" packages/opencorvus/src/
grep -rnE "function classify\w+" packages/opencorvus/src/
grep -rnE "switch\s*\(\s*kind\s*\)" packages/opencorvus/src/
grep -rnE "pick(Rework|Workflow|Mode)" packages/opencorvus/src/
```

Signal-driven 配置（`signal_overrides[]` 数组遍历取第一匹配）是**允许**的——那是配置驱动，不是流程控制。界限：**"根据数据选配置" OK；"根据状态选代码分支" 禁止**。

---

## 验收总标准

修复完成后：

| 指标 | 当前基线 | 目标 |
|---|---|---|
| 单次 pipeline iteration 的 LLM 调用数（N=6） | ≥16 | ≤10 |
| Delivery Phase 0 工具调用平均数 | — | -80% |
| Rework 选错档位导致的浪费迭代 | 偶发 | 0 |
| per-goal executor 越界写 | 偶发 | 0 |
| Library/docs task 无谓 puppeteer 调用 | 全有 | 0 |
| 平均一轮 pipeline 的 read_file(package.json) 次数 | 5-8 | 1 |
| UI delivery 命中 vision 模型率 | 随机 | 100% |
| architect 输出一致性（相同输入两次） | 有波动 | 一致 |

全部指标以 20 个历史 task 的 fixture replay 为测试集。
