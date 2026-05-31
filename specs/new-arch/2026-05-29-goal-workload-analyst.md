# Goal Workload Analyst — 独立工作量解构 + goal 定型复核层

- 日期：2026-05-29
- 状态：草案（待实施）
- 关联：[[2026-05-29-goal-run-owner-orphan-liveness]]（同期 goal_run/owner 改造，本 spec 明确**不碰** goal_run 生命周期）
- 决策来源：用户选择「独立只读 Analyst（index/lens 形态）」；2026-05-29 追加两条决策——(1) analyst 自己的输入要 **inline 全文 template**；(2) analyst 产物**回喂 architect 重新定型 goal**（architect 为主消费者，build 为次消费者）。

---

## §0 问题（第一性）

**表象诉求**：build 初始 prompt 塞满 req/architect 产物，几千行 spec 容易被低估工作量。

**真实问题**（证据驱动，rule 3）：

1. build prompt 里 inline 的是 requirements / contract graph / 全部 sibling goal 契约 / fidelity（`build/agent.ts:2384-2571`, `BuildContext` 162-247）。
2. 最重磅的 frontend template **不是 inline 的**——是 path 引用 + 摘要（`frontendDesign` 字段），正文在磁盘 `frontend-template.md`，由消费者自行深读。
3. 真痛点两条：**(a) 浅读**——只拿 path 容易浅读几千行；**(b) 估算偏见**——背着实现压力的 agent 倾向把工作量压成「我现在能做的最小集」。

**两条都指向「独立、无实现压力、专职深读 template 的 agent」**：
- 对 (b)：让有实现/分解压力的 agent 自评工作量无法去偏见；必须换一个只读、不写代码、不分解 goal 的 reviewer。
- 对 (a)：context 不是稀缺约束——**恰恰相反，我们主动把全文 template inline 进 analyst**（它唯一的工作就是消化 template），用 analyst 的 context 预算换深读；下游（architect 再决策 / build 实现）拿到的是 analyst 消化后的 **compact brief**，而非再去浅读原文。

**非目标**：不评估「工期 / effort / story point」，不产出 `small|medium|large` 粗粒度分类（那正是要避免的「泛泛估算」，且分类枚举有 rule 13 味）。产出的是**可数工作面清单 + 反低估证据 + goal 定型意见**。

---

## §1 决策与数据流

新增**只读、非 gate、task 级**的 stage agent：**Goal Workload Analyst**——身份是「独立的 goal 定型复核者 + 每 goal 执行清单产出者」。

### 数据流（全部 orchestrator-LLM 决定，advisory，rule 13）

```
architect(V1)
   └─► workload_analysis            读「goals(V1) + 全文 template(inline) + contract graph + reference_coverage」
            └─► 产 goal_workload artifact（每 goal 一份 brief，带 decomposition_concern）
                   │
   ┌───────────────┴────────────────────────────┐
   │ orchestrator 读 describe 后自行决策：          │
   │  • 有 goal 被标 decomposition_concern（过大/欠定义）│
   │      → 回喂 architect 重跑：split / rebalance → goals(V2)
   │        （V2 后通常再跑一次 workload_analysis 给 build 用新 brief）
   │  • goals 定型 OK → 进入 per-goal build         │
   └────────────────────────────────────────────┘
                   │
            per-goal build  ← 注入该 goal 的（与 active snapshot 匹配的）compact brief
```

- **主消费者 = architect**。analyst 是 architect 的**独立 sizing reviewer**：architect 提案 → analyst（无分解沉没成本）复核每个 goal 是否「对单次自治 build 过大/欠定义」→ architect 据此 split/rebalance。这是把「goal 过大」修在**分解根因**，而非在 build 端打补丁（rule 2）。它正好喂给 architect 既有的「why no goal is too large」职责与既有 re-run 机制。
- **次消费者 = build**。即便 architect 定型完，每个 goal 仍有隐藏深度（验证清单、「深读 template 哪几节」、residual why_not_smaller）。build 拿到自己那份 brief，反过早最小化。
- **运行形态**：一次 task 级 session 读整张图（与 architect 同形），一次产出全部 brief；task 级视角能捕捉**跨 goal 低估**（assembly-owner 型 goal：标题小、实际拼装多个 sibling 产出的 surface）。
- **边界（沿用用户初版约束）**：analyst **不创建/不修改 goal**，**不提出具体拆分方案**（那是 architect 的活，避免变成第二个 architect）。它只**标记**「这个 goal 过大，因为 X/Y/Z」+ 给可数清单；**由 architect 决定怎么拆**。

### 被否决的备选（rule 32 留痕）

- **B：并入 architect 自评**——用户已否决。architect 对自己刚画的图有 sizing 沉没成本偏见，自评去不掉偏见；独立 reviewer 才行（与「为什么不让 build 自评」同理）。
- **C：只改 build-core 强制先列清单**——同一上下文/实现压力下自评，偏见仍在；且修在 build 端而非分解根因。

---

## §2 反双源契约（rule 8）—— 核心约束

经全仓核验，用户初版 schema 7 字段里 **6 个已有单一来源**：

| 初版字段 | 既有单一来源 |
|---|---|
| `user_visible_workflows` | frontend-design `product_spec`/`fillable_modules` |
| `visual_surfaces` | frontend-design `visual_consistency_contract`(freeform) + architect `register_reference_coverage`(有 `id`) + `render_surface` 契约(有 `id`) |
| `interactions_or_states` | frontend-design `fillable_modules` / `register_interaction_spec`(`vis-*`，可选) |
| `data_contracts` | architect `register_contract`(typed IR + valueDomain，有 `id`) |
| `verification_plan` | architect `goal.acceptance_specs`(scorers，有 `id`) |
| `reference_artifacts_to_read` | architect `reference_coverage`/contract `artifact_paths`/design `reference_artifacts` |
| `why_not_smaller`/低估陷阱/工作面计数/**定型意见** | **无任何来源——本层唯一原创** |

**硬约束**：analyst 是既有产物的**索引 + 反低估透镜 + 定型意见（index/lens/verdict）**，不是第三份真理。

- **只 ORIGINATE**：`why_not_smaller`、`underestimation_traps`、`execution_inventory`(可数)、`verification_inventory`、`decomposition_concern`(定型意见)。
- **只 REFERENCE**（禁止用自己的话重写 surface/contract/workflow）：
  - 强锚点（恒存在、结构化）：architect **goal id / contract id（含 render_surface/behavior_inventory）/ reference_coverage id / acceptance_spec id**。
  - 弱锚点（可选，**不得依赖其存在**）：frontend-design `vis-*` id。
  - 无 id 的 freeform：按 **section 标题 + `frontend-template.md` 路径**引用。
- **快照时效**：brief 引用的是 architect **当前快照**的 id；architect 重跑后旧 brief 失效（见 §5 staleness），由 spec_snapshot_id 绑定解决——analyst 引用 id 不需要跨 architect 重跑稳定。

> 设计自检（rule 11）：本层**聚合并审视**既有结构、给定型意见，不**再生产**结构。回喂 architect 的也是「concern + 证据」，不是替它写好的新 goal。

---

## §3 输出 schema

```ts
// src/goal-workload-analyst/types.ts
export interface WorkloadBrief {
  goal_id: string            // architect llmID，如 "goal_visual_shell"（必须是已注册 goal）

  // ── 定型意见（喂 architect 的主信号） ───────────────────
  /** 非空 = analyst 判断此 goal 对「单次自治 build」过大或欠定义。
   *  内容是「为什么不该一个 build 吞下 + 触及的工作面证据」，
   *  但**不写**具体拆法（拆法是 architect 的活）。空 = 定型 OK。 */
  decomposition_concern?: string

  // ── ORIGINATED（本层唯一原创） ───────────────────────────
  why_not_smaller: string[]          // 为什么比 title/objective 看起来更大
  underestimation_traps: string[]    // 具体「别停在 X」，如「建 Header/Sidebar 不够；chart 区含 grid+price axis+overlay+subpanel」
  execution_inventory: {             // 可数解构 —— 反过早最小化
    surfaces: number
    states: number
    data_contracts: number
    verification_points: number
  }
  verification_inventory: string[]   // build report pass 前必须执行的可观测检查

  // ── REFERENCED（指针，禁止重写） ─────────────────────────
  references: {
    contract_ids: string[]
    reference_coverage_ids: string[]
    acceptance_spec_ids: string[]
    visual_spec_ids: string[]        // 可选 vis-*，可能空
    prd_sections: string[]           // frontend-template.md 中 build/architect 必须深读的 section
  }
}

export interface GoalWorkloadResult {
  briefs: WorkloadBrief[]
  spec_snapshot_id: string           // 本次分析针对的 architect 快照（staleness key）
  summary: string                    // 一句话：几个 goal 定型 OK / 几个被标 concern
}
```

Collector（`output-tools.ts`，镜像 architect collector）：`{ briefs, summary, fact_check_items, finalized }`。

**输出工具**（镜像 architect `register_goal`/`submit_architect`）：`register_workload_brief`（每 goal 一次，Zod 校验）；`submit_workload_analysis`（terminal，置 `finalized`）。

**轻量校验**（rule 5；只挡数据完整性 rule 6.1(a)）：`brief.goal_id` 必须已知（host 传 `knownGoalIDs`）；每个 blocking goal 至少一份 brief（concern）；`why_not_smaller` 非空；`references.contract_ids` 须存在于传入 contract graph（concern）。

---

## §4 rule-13 / rule-6.1 守则

- **不加 goal_run 生命周期状态/phase**（否决 explorer 的 `analyzing` 状态提议）：workload 是 task 级，与 architect/requirements 同层，不进 per-goal 状态机；且与 [[2026-05-29-goal-run-owner-orphan-liveness]] lease/owner 改造撞车。
- **不自动触发，不自动回喂**。「architect 后跑 workload」「workload 标 concern 后回 architect」**都由 orchestrator LLM 决定**，不是 host gate（orchestrator 刚删了三个 auto-rewake gate）。实现：workflow advisory step + orchestrator-core 引导 + describe 暴露事实（已分析/已过期/有 concern）。
- **loop 防抖（复用既有纪律）**：architect⇄workload 的回喂受 orchestrator-core **既有**「seal the plan / 优先 modify_goal / Frequent Architect re-runs 是质量信号」约束（已被 `core-prompt-hygiene.test.ts` 钉死）。注意 `modify_goal` 只能改单 goal 字段、**不能 split**；「过大需拆」必须走 architect 重跑，"过大但不可拆" 则只把 brief 留给 build。orchestrator 据 concern 性质择一。
- analyst 工具集**只读**（`read_file/find_files/search_code/list_directory/read_context` + output tools），无写/无 bash——结构上保证无实现压力。

---

## §5 数据模型（artifact）

**单 artifact、task 级、latest-wins**（镜像 `persistArchitectContractGraph`, `engine/persist.ts:402-426`）：

- 新增 artifact kind `"goal_workload"`（加入 `EngineArtifactKind` union, `engine/engine.sql.ts:89-116`）。
- 写：`db.insert(EngineArtifactTable).values({ id, task_id, run_id:null, goal_run_id:null, delivery_id:null, kind:"goal_workload", label:"active", payload: GoalWorkloadResult, time_created, time_updated })`。
- 不用 N 个 per-goal artifact（artifact 表无 `goal_id` 列；单 task artifact 更简单且自带 staleness）。briefs 是 per-goal，存 payload 数组。

**新增辅助**：`persistGoalWorkload(db,{taskID,specSnapshotID,briefs,now})`（persist.ts）；`findLatestGoalWorkloadArtifact(taskID): GoalWorkloadResult|undefined`（store.ts）。

**Staleness（rule 8 单源）**：brief 绑 `spec_snapshot_id`。architect 重跑产生新快照后旧 brief 自动过期——architect 重跑入参 / build 注入 / describe 都**只认 active snapshot 对应的 brief**；不匹配视为「未分析」，orchestrator 可重跑 workload。

---

## §6 消费者

### §6A architect（主）—— 复核回喂

- `orchestrator/tools.ts` 的 `architect` 工具在（重）派发时，读 `findLatestGoalWorkloadArtifact(taskID)`，把**匹配当前快照**的 briefs（重点是带 `decomposition_concern` 的）传给 `ArchitectAgent.coordinate({ ..., workloadBriefs })`。首跑 architect 时无 workload（入参空，等同 `retryContext` 首跑为空）。
- `architect/agent.ts`：`CoordinateInput += workloadBriefs?: WorkloadBrief[]`；`buildUserPrompt` 加一节「# Workload Review — goals flagged for re-sizing」，逐条列 goal + `decomposition_concern` + 计数证据。
- `architect-core.txt`：加一条——「当 workload review 标记某 goal `decomposition_concern`（对单次自治 build 过大或欠定义）时，split 或 rebalance 它；这是你『why no goal is too large』职责的外部证据，不是可选项。无法再拆的，就在 decomposition_analysis 说明为何不可拆」。

### §6B build（次）—— 执行清单注入

- `BuildContext += workloadBrief?: WorkloadBrief`（`build/agent.ts` 162-247）。
- 装配（`orchestrator/tools.ts` build 工具，context 字面量 ~5396-5409）：
  ```ts
  const wl = findLatestGoalWorkloadArtifact(taskID)
  const workloadBrief =
    wl && wl.spec_snapshot_id === activeSpecSnapshotID
      ? wl.briefs.find((b) => b.goal_id === goal.llmID)   // 用 architect llmID 匹配
      : undefined
  ```
- 渲染（`buildUserPrompt` goal 分支，放 `# Goal:` 契约块**之前**，框住契约；仅当存在时渲染，缺省安全）：
  ```
  ## Goal Workload Brief — scope this BEFORE you implement
  This goal is larger than its title suggests. Do not stop at the obvious components.
  Why it is not smaller: <why_not_smaller[]>
  Underestimation traps: <underestimation_traps[]>
  Work surface (all required): N surfaces / M states / K data contracts / J verification points
  Verify before reporting pass: <verification_inventory[]>
  Read deeper (do not skim): architect contracts <contract_ids> · reference coverage <reference_coverage_ids> · frontend-template.md sections <prd_sections>
  ```
  **渲染只引用 id/section，不复制 surface 散文**（§2）。

---

## §7 全部接入点（file → symbol → 改动；行号会漂移，以 symbol 为准）

**新建**
1. `src/goal-workload-analyst/agent.ts` —— `GoalWorkloadAnalystAgent.analyze(input)`，镜像 `architect/agent.ts:89-162`：`filterAgentTools(createAgentContextTools(),"goal-workload-analyst",{taskID})` + `createGoalWorkloadOutputTools(...)` → `runAgentSession({ kind:"goal-workload-analyst", core: withFactCheckRegistration(CORE), sessionTitle, parentSessionID, taskID, signal, onSessionCreated, toolKit, buildUserPrompt, terminalTool:{ toolName:"submit_workload_analysis", isSatisfied:c=>c.finalized, shouldExposeOnlyTerminalTool } })`。
2. `src/goal-workload-analyst/output-tools.ts` —— `createGoalWorkloadOutputTools({ knownGoalIDs, contractGraph })`。
3. `src/goal-workload-analyst/types.ts` —— `WorkloadBrief`/`GoalWorkloadResult`（§3）。
4. `src/goal-workload-analyst/index.ts` —— 导出。
5. `src/goal-workload-analyst/prompt.ts` —— `buildWorkloadUserPrompt(input)`：**inline 全文 `frontend-template.md`**（从 materialized 路径读，host 侧读后传入或 prompt 内直引）+ goals + contract graph + reference_coverage + design handoff（§0 决策：analyst 是唯一 inline 全文 template 的 agent）。
6. `src/prompt/core/goal-workload-analyst-core.txt` —— core prompt（§8）。

**注册**（按 `agent/role-contract.ts` 文件头官方配方）
7. `src/agent/role-contract.ts` —— `AgentRoleContract.all`(role-contract.ts:33) 加 `"goal-workload-analyst"`(`{id,description,promptConfigMode:"append",promptEditable:true,defaultPromptRequired:true}（与 architect/requirements 等 stage agent 一致；同时加进 `AgentRoleID` union）`)。**必须最先加**：`buildState` 用 `AgentRoleContract.description(id)`，未知 id **抛错**。
8. `src/session/session.sql.ts` —— `SESSION_KINDS`(65) 加 `"goal-workload-analyst"`（text 列，**无需迁库**）。与 role-contract 被 `test/agent/role-contract.test.ts` 互钉，须同步。
9. `src/agent/agent.ts`：import core；`buildState` 加条目 **逐字段镜像 architect(448-471)**：`description:AgentRoleContract.description(...)`, `prompt:CORE`, `tools.include:["read_file","find_files","search_code","list_directory","memory_search","memory_get","todoread","todowrite"]`, `steps:1000`, `options:{}`, **`mode:"primary"`**, `native:true`, `hidden:true`；`NATIVE_DEFAULTS`(634) 加映射；**orchestrator `tools.include`(384-413)** 加 `"workload_analysis"`（紧邻 architect）。
10. `src/engine/engine.sql.ts` —— `EngineArtifactKind` union 加 `| "goal_workload"`。

**编排器 + 持久化**
11. `src/orchestrator/tools.ts` —— `tools` 对象加 `workload_analysis: tool({...})`（architect 与 integrity 之间）：`listGoals`+contract graph+active spec snapshot+**全文 template** → `GoalWorkloadAnalystAgent.analyze` → `persistGoalWorkload` → `yieldResult({headline,summary,fields,pointer})`，pointer/summary **引导**：「有 goal 被标 decomposition_concern → 考虑回 architect 重定型；否则进 build」。失败走 architect 同款 catch。
12. `src/engine/persist.ts` —— `persistGoalWorkload(...)`。
13. `src/engine/store.ts` —— `findLatestGoalWorkloadArtifact(taskID)`。

**消费**
14. `src/engine/describe.ts` —— goal 投影加事实字段（如 `workload_analyzed`/`workload_stale`/`workload_concern`，对比 active snapshot），让 orchestrator 知道「是否已分析/已过期/有定型 concern」（rule 23，纯事实不 gate）。
15. `src/orchestrator/tools.ts` `architect` 工具 —— 重派发时读 workload briefs 传给 `coordinate`（§6A）。
16. `src/architect/agent.ts` —— `CoordinateInput += workloadBriefs?` + `buildUserPrompt` 加 Workload Review 节（§6A）。
17. `src/prompt/core/architect-core.txt` —— 加「按 decomposition_concern split/rebalance」条（§6A）。
18. `src/build/agent.ts` —— `BuildContext.workloadBrief?` + `buildUserPrompt` 渲染（§6B）。
19. `src/orchestrator/tools.ts` `build` 工具 —— BuildContext 装配注入 `workloadBrief`（§6B）。
20. `src/prompt/core/orchestrator-core.txt` —— 加 advisory：architect 后通常调 `workload_analysis`；其 concern 是 architect 重定型/`modify_goal` 的输入；遵循既有 seal-the-plan 防抖。

**workflow**
21. `src/engine/workflow.ts` —— PIPELINE 加 step `{ id:"workload_analysis", tool:"workload_analysis", label:"Workload", hint:"...只读工作量解构：inline 全文 template，逐 goal 产 why_not_smaller/可数清单/低估陷阱/验证清单/定型意见(decomposition_concern)，以 id 引用 architect 契约与 reference coverage；concern 回喂 architect 重定型，brief 供 build 反过早最小化。advisory 可跳过。", scope:"task", skippable:true, after:["architect"] }`；`build.after` 改 `["workload_analysis"]`（advisory）。

---

## §8 core prompt 设计（goal-workload-analyst-core.txt）

要点（非状态机、不教路由，rule 13）：

- **身份**：只读 goal 定型复核者 + 执行清单产出者，**不写代码、不创建/改 goal、不提具体拆分方案、不当 gate**。
- **双使命**：(1) 对抗低估——每个 goal 回答「为什么比看起来大」「build 容易停在哪个最小集」；(2) 定型复核——判断每个 goal 对**单次自治 build** 是否过大/欠定义，过则填 `decomposition_concern`（写证据，**不写拆法**）。
- **深读纪律（硬约束）**：**全文 template 已 inline 在你的输入里**——必须据其 + reference 图 + reference_coverage + contract graph 下计数，禁止凭 goal title 拍脑袋（rule 35 精神）。
- **index 纪律（硬约束）**：surface/contract/workflow 一律**引用** architect 的 contract id / reference_coverage id / goal id / acceptance_spec id 及 frontend-template.md section；**禁止用自己的话重写**。原创只有 why_not_smaller / traps / 可数 inventory / verification_inventory / decomposition_concern。
- **跨 goal 视角**：识别 assembly-owner 型 goal（标题小、实际拼装多个 sibling surface）这种典型低估/错配。
- **输出**：每 goal 一次 `register_workload_brief`，末了 `submit_workload_analysis`。
- 复用 `withFactCheckRegistration`。
- **必带句**（`core-prompt-hygiene.test.ts:79-97` 强制逐字）：`Every agent owns its file mutations: if you modify project files, commit your own changes before finishing; if your role is read-only or only emits structured records, do not claim file changes.`（本 agent 只读 → 落「only emits structured records, do not claim file changes」半句）。禁止 `\`` 字面量（test:628-637）。

---

## §9 测试计划（rule 28 / rule 36）

1. `test/goal-workload-analyst/output-tools.test.ts` —— `register_workload_brief` 正反例（未知 goal_id 拒绝、why_not_smaller 必填、未知 contract_id 报 concern、`decomposition_concern` 可空/可填）；submit 置 finalized；isReadyToFinalize 单源。
2. `test/engine/goal-workload-artifact.test.ts` —— `persistGoalWorkload`→`findLatestGoalWorkloadArtifact` round-trip；latest-wins；staleness（旧 spec_snapshot_id 不被采纳）。
3. `test/architect/workload-input.test.ts` —— architect `coordinate` 接到 workloadBriefs 时 prompt 渲染 Workload Review 节；无 workload 时不渲染（断言旧行为不发生，rule 36）；architect-core 含「按 decomposition_concern split/rebalance」句。
4. `test/build-agent/workload-brief.test.ts` —— BuildContext 装配：brief 匹配 active snapshot 注入并渲染；不匹配**不**注入；渲染只含 id/section、不含被禁「重写 surface 散文」标记。
5. `test/engine/workflow.test.ts` —— PIPELINE 含 `workload_analysis`（`after:["architect"]`/skippable/`scope:"task"`）；`build.after` 指向它。
6. `test/agent/core-prompt-hygiene.test.ts`（**已在改，实施前先读当前态**）：把 `goal-workload-analyst-core.txt` 加进 `promptFiles`(8-19) 否则「inventory 精确集合相等」断言(36-41)挂；给 `maxLines` 预算(44-70)；core 逐字含 file-mutation-ownership 句(79-97)；无 `\``(628-637)。
7. `test/agent/role-contract.test.ts` —— `AgentRoleContract.all` 与 `SESSION_KINDS` 互钉，新 id 两处同步才过。
8. orchestrator `workload_analysis` 工具：no-goals 早退（yieldResult 指引先 architect）、失败走 decision_log catch。

---

## §10 风险 / 待确认

- **architect⇄workload loop 收敛**：靠 orchestrator-core 既有 seal-the-plan/anti-thrash + spec_snapshot_id staleness + describe 事实暴露，全 LLM 决策、无 host loop。仍需实测确认不会在 split→重测→再 split 上抖动；二次 review 时重点看 orchestrator 是否过度回 architect（应优先 modify_goal / 仅结构性 concern 才重跑）。
- **全文 template inline 的 token**：analyst 单 session 吞全文 template + 全图，goal 多/template 长时偏高。先按 architect 同档 `steps`；撑爆再评估分批（不默认分批，rule 5）。这是**有意**的 context 花费（§0），不是 bug。
- **SDK/OpenAPI 同步**（rule 33 pre-push `api:routes-check`/`docs:check`）：`SESSION_KINDS` 经 `z.enum` 暴露（`session/index.ts`）。SessionKind 若进对外 schema 需 regen `packages/sdk`（`types.gen.ts`/`openapi.json` 已在改）。实施后必跑 hook。
- **EngineGoalTable 的 llm id 列名**：§6B 用 architect `llmID` 匹配 brief；实施时确认 goal row 存 llm id 的字段名（`upsertGoalsFromArchitect` 写入处）。
- **describe 字段命名**：`workload_analyzed`/`workload_stale`/`workload_concern` 与既有 describe 风格对齐后定。
- **二次 review**（rule 24）：复核「§2 反双源契约」是否落实——重点查 core prompt / 渲染层 / 回喂 architect 的内容有没有偷偷让 analyst 重写 surface 或替 architect 写好新 goal。
