# Integrity Review — Requirement-Fidelity (REQ-N) as Audit Unit

> 2026-05-10 / 用户反馈：integrity review 审查的是 requirements 有没有完成，不是 goal，goal 的粒度太粗了。
> 当前 `goal_fidelity` 维度以 goal contract 为枢纽走查，REQ 只是上下文。
> 本方案把 fidelity 维度的审计单位下沉到 REQ-N，让 issue 携带 `requirement_ids`，并把 prompt / 事件 / overlay 一并跟齐。

---

## §0 决策

- **重命名维度** `goal_fidelity` → `requirement_fidelity`。greenfield 项目无兼容包袱（rule 7 / 18），直接替换；DB 中 `engine_artifact.kind=integrity_attempt` 的旧 per_dimension id 接受 reset。
- **审计单位下沉到 REQ-N**：`requirement_fidelity` 的 checklist 必须按"对每条 REQ 走查"组织，不再以 goal 为枢纽。
- **issue 上加 `requirement_ids?: string[]` 和 `spec_ids?: string[]`**：分别用于 REQ-keyed 与 post-build spec-keyed evidence。其它维度可选（结构上不强制以避免 schema 分叉，强制由 prompt 描述）。
- **新增 issue type `implicit_dependency_missing`** — 用户描述了 user-visible 交付物，但其实现 tier（FE→BE/数据源等）在 REQ 列表中缺失。
- **新增结构 `RequirementStatusRow[]`** — pure projection of REQ → claiming goals → goal_run status → source_requirement_id-keyed scorer outcomes，post-build 阶段注入到 prompt，让 fidelity 评判建立在真实证据上而不仅是结构覆盖。
- **prompt 重构**：`buildIntegrityPrompt` 把 REQ-N 章节升为审计枢纽，附 "REQ-N → claimed-by goal_ids → 关联 acceptance_specs" 反查表；post-build 时再附 `# Requirement Status Snapshot` 表；goal 合同保留为 supporting context。
- **维度数量保持 4 个**：本次的"系统完成度"语义全部并入 `requirement_fidelity`，不开新 dimension（rule 5 / rule 6）。
- **corrections / missing_goals 不动**：REQ 层发现的修复仍然落到 goal 层（modify goal.requirement_ids、split、新建 missing goal owning REQ-N）。整套 wire schema 保持。

不做的事（明确 out of scope）：

- 不引入新的 dimension（rule 5 反对过度工程）。
- 不改 acceptance_spec / goal contract / verification-evidence 表结构。`goal.requirement_ids`、`acceptance_spec.source_requirement_id`、`engine_artifact[verification-evidence].checks[].spec_id` 已经在了，够 join。
- 不在 requirements agent 端加 implicit-REQ 抽取逻辑 — integrity 是审查方，不替 requirements agent 抽（独立改动）。
- 不重构 decision-log；REQ 完成度证据通过新 `computeRequirementStatusSnapshot` 投影，不动 decision-log。

---

## §1 影响面（rule 35 全仓 grep 已完成）

### 1.1 维度定义层（语义改动主体）

| 文件                                                 | 改动                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/integrity/dimensions.ts`    | id 字面量 `"goal_fidelity"` → `"requirement_fidelity"`；summary + checklist 重写为 REQ-walk；`IntegrityDimension.id` 联合类型同步；hallucination `out_of_scope` 描述里 `goal_fidelity's distorted` 改名                                                                      |
| `packages/opencorvus/src/integrity/agent.ts`         | 空 goal-set 兜底 `id: "goal_fidelity"`（line 278）→ `"requirement_fidelity"`；`IntegrityIssue.requirementIDs?: string[]` 加入；`buildIssueInput` 加 `requirement_ids: z.array(z.string()).optional()`；comment 行 711 改名；`buildIntegrityPrompt` 把 REQ 章节前置并附反查表 |
| `packages/opencorvus/src/integrity/index.ts`         | 无（re-export 即可）                                                                                                                                                                                                                                                         |
| `packages/opencorvus/src/integrity/submit-schema.ts` | 无（terminal submit 与维度无关）                                                                                                                                                                                                                                             |

### 1.2 prompt 文本

| 文件                                                        | 改动                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/prompt/core/integrity-core.txt`    | `submit_goal_fidelity_verdict` → `submit_requirement_fidelity_verdict`；`granularity_off under \`goal_fidelity\``字面量改名；新增"audit unit is each REQ-N, walk REQ rows not goal rows"段，要求 REQ-fidelity issue 必填`requirement_ids` |
| `packages/opencorvus/src/prompt/core/architect-core.txt`    | 行 47 / 435 / 449 三处 `goal_fidelity` 字面量改 `requirement_fidelity`                                                                                                                                                                    |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | 行 421 改名；新增一句"fidelity is REQ-keyed; issue.requirement_ids names which REQ failed"                                                                                                                                                |
| `packages/opencorvus/src/orchestrator/tools.ts`             | line 2699 字符串改名；emit/record 路径无逻辑改动（perDimension 字段已 string-typed）                                                                                                                                                      |
| `packages/opencorvus/src/agent/agent.ts`                    | line 381 描述字符串改名                                                                                                                                                                                                                   |

### 1.3 事件协议 / SDK

| 文件                                                              | 改动                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/engine/model.ts`                         | `IntegrityReviewCompleted.dimensions[].id` 的 `z.enum([...])` 把 `goal_fidelity` 替换；`issues[]` 加 `requirement_ids: z.array(z.string()).optional()` |
| `packages/opencorvus/src/integrity/agent.ts` `emitIntegrityEvent` | issue payload 携带 `requirement_ids`                                                                                                                   |
| `packages/sdk/openapi.json`                                       | 由 `bun run docs:api` 重生（line 27249 enum）                                                                                                          |
| `packages/sdk/js/src/gen/{types.gen.ts,sdk.gen.ts}`               | 由 codegen 重生（line 421 union）                                                                                                                      |

### 1.4 overlay

| 文件                                                | 改动                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/store/card-tree.ts`           | line 211 enum 字面量；issue type 加 `requirement_ids?: string[]`                                                                          |
| `packages/overlay/src/services/tree-writer.ts`      | line 111 enum、line 910 `dimensionIDs` 数组；payload pipe 透传 `requirement_ids`                                                          |
| `packages/overlay/src/components/IntegrityCard.tsx` | issue `<li>` 渲染时把 `requirement_ids` 当作小 chip 列出来（"REQ-1 REQ-3 …"），无 ids 不渲染                                              |
| `packages/overlay/src/i18n/zh-CN.json` `en-US.json` | key `integrity.dimension.goal_fidelity` 改 `integrity.dimension.requirement_fidelity`，文案：zh 「需求对齐」/ en 「Requirement Fidelity」 |
| `packages/overlay/test/redesign-visual.html`        | line 214 fixture 文案改名（仅影响 redesign 预览）                                                                                         |

### 1.5 持久化层

| 文件                                                                           | 改动                                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/engine/persist.ts` `recordIntegrityAttempt`           | `perDimension: Array<{ id: string; ... }>` 已 string-typed，无代码改动；注释行 1807 字面量改名 |
| `packages/opencorvus/src/engine/store.ts` `findLatestIntegrityAttemptArtifact` | 无                                                                                             |
| `packages/opencorvus/src/acceptance/checks/project-gate.ts`                    | 无（按 kind 检索，不依赖 dimension id）                                                        |

### 1.6 测试（mock 改名 + 新增）

mock 改名（仅替换字面量）：

- `packages/opencorvus/test/integrity/agent.test.ts` 行 39, 63, 97, 107, 167
- `packages/opencorvus/test/orchestrator/tools.test.ts` 行 177, 1002, 1109, 1346, 1442, 1580, 1740, 1922, 1984, 2054, 2072, 2139, 2157, 2251, 2413, 2503
- `packages/opencorvus/test/server/task-conversation-routes.test.ts` line 61
- `packages/opencorvus/test/engine/workflow-integrity-step.test.ts` 行 138, 202, 270
- `packages/opencorvus/test/acceptance/project-gate.test.ts` line 1013
- `packages/opencorvus/test/benchmark/acceptance-runtime-flow-benchmark.test.ts` line 187
- `packages/overlay/test/tree-writer-hierarchy.test.ts` 行 593, 607
- `packages/opencorvus/test/integrity/tool-payload-budget.test.ts` 重测 schema 字符数（新增 `requirement_ids` 字段对单维度 schema 的字符数影响 < 200B，不会越 990k 阈值，但要落新 baseline）

新增测试（rule 36，每条改动配单测）：

- `test/integrity/req-fidelity-audit.test.ts`：
  1. REQ-N 没有任何 goal 在 `requirement_ids` 中声明 → 维度 verdict `needs_correction`，issue type `uncovered`，`requirement_ids=[REQ-N]`。
  2. REQ-N 被两个 goal 同时声明、双方 acceptance_spec 共同覆盖 → 不应误报 `merged_incorrectly`（多 goal 协作不是缺陷）。
  3. REQ-N 在 goal.requirement_ids 中但所有相关 acceptance_spec 都是 `severity: optional` → `partial`。
  4. issue 上 `requirement_ids` 字段透传到 IntegrityResult.issues[]。
- `test/integrity/agent.test.ts` 加用例：dimension 名称改名后 4 个 `submit_*_verdict` tool 全部存在；缺失 `requirement_fidelity` 时报 `missingDimensions=requirement_fidelity,...`。
- overlay 渲染快照：issue 上 `requirement_ids` 渲染成 chip 列表。

---

## §2 实施顺序

每步独立可 commit + push（rule 33）：

1. **dimensions.ts**：rename id、重写 summary/checklist（REQ-walk 框架）、补 hallucination 的 `out_of_scope` 描述里的 cross-reference。
2. **agent.ts**：
   - `IntegrityIssue` 加 `requirementIDs?: string[]`（camelCase 内部）；
   - `buildIssueInput` 加 `requirement_ids: z.array(z.string()).optional()`（snake_case 在 wire）；
   - tool execute 把 `it.requirement_ids` 映射到 `issue.requirementIDs`；
   - empty-goal 兜底 id 改名；
   - `buildIntegrityPrompt`：新增 `# Requirement-to-Goal Coverage Map` 章节（每条 REQ 列 claiming goals + 关联 specs），把 `# Requirements` 章节往前提，结尾改提示语为 "Walk REQ-N row by row under requirement_fidelity. Cite REQ-id in `requirement_ids` on every fidelity issue."
3. **integrity-core.txt**：tool 名 / 维度名 / 决策语句改名 + 新增"audit unit"段。
4. **engine/model.ts**：`IntegrityReviewCompleted.dimensions[].id` enum 改名，`issues[]` 加 `requirement_ids: z.array(z.string()).optional()`；agent.ts `emitIntegrityEvent` 透传。
5. **architect-core.txt / orchestrator-core.txt / orchestrator/tools.ts / agent/agent.ts**：字符串改名。
6. **overlay**：card-tree、tree-writer、IntegrityCard、i18n。
7. **测试 mock 一把替换**（grep `"goal_fidelity"` 全仓改 `"requirement_fidelity"` — 注意只在 test mock + 字符串 fixture 中替换，源码已经在前面手动改完）。
8. **新增 4 条 unit test + overlay snapshot 用例**。
9. **跑 codegen**：`bun run docs:api` → 重生 openapi + sdk types。
10. **typecheck**：`cd packages/opencorvus && bun run typecheck`，`cd packages/overlay && bun run typecheck`。
11. **靶向测试**（rule 21、no_bun_test）：
    - `bun test packages/opencorvus/test/integrity packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts packages/opencorvus/test/acceptance/project-gate.test.ts packages/opencorvus/test/server/task-conversation-routes.test.ts`
    - `cd packages/overlay && bun test test/tree-writer-hierarchy.test.ts`
12. **api:routes-check + docs:check**（pre-push hook 会自动跑，不绕 hook — rule 33）。
13. **DB reset + 一次 bench dry-run** 验真：`cd packages/opencorvus && ... bun run script/benchmark/overlay-web-benchmark.ts --executor=opencorvus`，确认 overlay 正常显示新维度名 + REQ-id chip。
14. **commit + push**。

---

## §3 验收

- typecheck 通过。
- 所有列出的 targeted test 通过。
- `bun run docs:api` 输出无未提交差异（即 openapi.json / sdk types 已与代码同源）。
- bench dry-run：overlay 中 integrity 卡片维度名为「需求对齐 / Requirement Fidelity」，issue 行能看到 REQ-id chip。
- 检索旧字面量：`rg -n '"goal_fidelity"'` 在 packages/_ 与 specs/_ 之外无残留（specs/\_archive 与历史 spec 不动）。

---

## §4 风险与回滚

- **DB 兼容**：旧 `engine_artifact` 行 per_dimension id 还是 `goal_fidelity` 字符串。`recordIntegrityAttempt` 字段是 `string`、不参与匹配查询，仅在 read_context 渲染中露出 → 老行展示成 "goal_fidelity" 不影响新 review 决策。如确需统一，按 rule 18 reset。
- **prompt cache 失效**：dimension 名 + 工具名变了，OpenCorvus 缓存自然 miss，正常。
- **回滚成本**：所有改动是机械字符串替换 + 一处 prompt 段落 + 一个可选字段。回滚 = 反向替换；不改 schema、不动 DB 表。

---

## §5 系统完成度审查（用户 2026-05-10 二次反馈：FE page → BE API 端到端 review）

> §0~§4 把审计单位下沉到 REQ 行；本节把"完成"语义从"REQ 行被某 goal 声明"扩到"该 REQ 所在的 user-visible 交付物的整条依赖链端到端真做完"。
>
> 用户问题：前端页 REQ 被 goal_FE 声明、goal_FE 跑过 → 当前会判 covered。但若 FE 依赖的 BE API REQ 根本没在 REQ 列表（requirements agent 漏抽）、或 BE API REQ 在但 goal_BE 失败/未跑 → 系统其实没"完成"。

### 5.1 两个新增审查点（都落在 `requirement_fidelity` 维度内，不新增 dimension — rule 5）

**审查点 A：implicit dependency tier surfacing（pre-build 也能查）**

User request 描述的是 user-visible 交付物，但实现需要的隐含 tier（FE page → BE API + 数据源；CLI tool → 运行时入口 + 持久化；webhook → 外部回调可达性）未必出现在 REQ 列表。`technical_feasibility` 维度对每条 user-visible REQ 推它的实现 tier，逐 tier 检查 _merged tree_ 中是否有承担该 tier 的 goal — 缺 tier = `missing_capability` against an implicit infra goal，提议 `missing_goal` 拥有该 tier（或 `modify` 现有 goal 加宽 `owned_paths` / `exports`）。**integrity 不会改 REQ 行**（schema 不允许，见 §6.3.#12）；REQ 列表自身的缺漏由 orchestrator 决策是否回到 requirements agent 重抽。

**审查点 B：post-build REQ completion evidence（运行后才有）**

每条 REQ 的"完成"= 所有 claiming goals 跑过且与该 REQ 关联的 acceptance_spec scorer 全部 pass。证据链：

```
REQ-N
  ↓ goal.requirement_ids ∋ REQ-N
claiming goal G
  ↓ findLatestGoalRunEvidence(G.id) → VerificationEvidence
  ↓ checks[].spec_id  ←→  acceptance_spec.source_requirement_id == REQ-N
per-REQ scorer outcomes
  ↓ aggregate
REQ status: done / partial / not_done / unstarted
```

REQ 状态机制（pure projection，无状态机代码 — rule 13）：

- 无 claiming goal → `unstarted`（同 `uncovered` issue）
- 有 claiming goal 但全 unstarted/queued → `unstarted`
- 至少一 claiming goal 跑了，但与 REQ 关联的 essential spec 全部 pass → `done`
- essential spec 部分 pass → `partial`（issue type `partial`）
- essential spec 全 fail → `not_done`（issue type `partial` + 严重，verdict `needs_correction`）

### 5.2 新增结构（数据投影，不动 schema）

**新文件 `packages/opencorvus/src/integrity/requirement-status.ts`**

```ts
export interface RequirementStatusRow {
  reqID: string // REQ-N
  reqDescription: string
  claimingGoals: Array<{
    goalID: string
    goalTitle: string
    runStatus: EngineGoalRunStatus | "unstarted"
    /** acceptance_spec rows whose source_requirement_id == reqID, on this goal */
    relatedSpecs: Array<{
      specID: string
      severity: "essential" | "important" | "optional" | "pitfall"
      /** Latest scorer outcome for this spec on this goal_run, undefined when no evidence */
      passed?: boolean
      checkSummary?: string
    }>
  }>
  aggregate: "done" | "partial" | "not_done" | "unstarted"
}

export function computeRequirementStatusSnapshot(input: {
  taskID: string
  specSnapshotID: string
}): RequirementStatusRow[]
```

实现：单次 `Database.use(db => …)`，三步 join — REQ rows → goals filtered by `requirement_ids ∋ reqID` → latest verification-evidence per goal (`findLatestGoalRunEvidence`) → spec_id 过滤。aggregate 由纯函数 `aggregateRequirementStatus(specs)` 计算。

### 5.3 新增 issue type 与 dimension checklist 改动（合并进 §1.1）

`packages/opencorvus/src/integrity/dimensions.ts`：

- `IntegrityIssueType` 不增项 — 见 §6 codex 审查反馈 §6.3.#11。
- `requirement_fidelity.issueTypes` 维持 4 个：`uncovered / partial / distorted / merged_incorrectly`。
- `technical_feasibility.checklist` 新增 1 条 "**User-deliverable tier walk (system completion).**" — 对每条 user-visible REQ 推它的实现 tier；缺 tier 由 `missing_capability` 处理，repair 仍走 goal 层（`missing_goals` 或 `modify` 现有 goal）。
- `requirement_fidelity.checklist` 新增"Post-build completion walk"：当 Requirement Status Snapshot 块存在时，逐行走查；essential spec 部分 fail = `partial`（issue 必须 cite failing `spec_ids`）；snapshot 为空（pre-build）跳过。**aggregate 不在 host 计算，由 LLM 从原始证据自行判断**（rule 6.1）。

### 5.4 prompt 注入（`buildIntegrityPrompt`，合并进 §1.1）

新增可选输入 `requirementStatus?: RequirementStatusRow[]`。当非空时，在 `# Requirements` 之后插入：

```markdown
# Requirement Status Snapshot (post-build evidence)

| REQ         | Aggregate | Claiming Goals → run / spec outcomes              |
| ----------- | --------- | ------------------------------------------------- |
| REQ-1 (...) | partial   | goal_fe (completed): acc-fe-1 pass, acc-fe-2 fail |
| REQ-2 (...) | not_done  | goal_be (failed): no spec evidence                |
| REQ-3 (...) | unstarted | goal_data (queued): —                             |
```

### 5.5 编排器接线（合并进 §1.2）

`packages/opencorvus/src/orchestrator/tools.ts` `runIntegrityReviewOnce`：

```ts
const { computeRequirementStatusSnapshot } = await import("@/integrity/requirement-status")
const requirementStatus = computeRequirementStatusSnapshot({
  taskID,
  specSnapshotID: activeSpec.id,
})
const verdict = await reviewIntegrity({
  ...,
  requirements,
  requirementStatus,         // ← 新增
  ...
})
```

Pre-build 阶段 `requirementStatus` 自然为空数组（无 goal_run / 无 evidence），prompt section 跳过。

### 5.6 prompt 文本（追加到 §1.2 文件清单）

- `integrity-core.txt`：「Decision Discipline」段加一句 "Completion is a property of the **system** behind a REQ, not just the REQ row. When a `Requirement Status Snapshot` is present, fidelity verdicts must be backed by it; in its absence, fidelity is structural-only and the verdict reflects that."
- `dimensions.ts`'s `requirement_fidelity.summary` 末尾加 "When post-build status snapshot is present, also judge the REAL completion of each REQ from claiming-goal run outcomes + source_requirement_id-keyed spec evidence."

### 5.7 事件协议（追加到 §1.3）

`IntegrityReviewCompleted.issues[]` 已经在 §1.3 加了 `requirement_ids?`；本节再加 `spec_ids?: string[]`（post-build issue 需要回指失败的 spec_id 以便 overlay 能定位 / 编排器能 modify 该 spec）。`buildIssueInput` 同步加 `spec_ids: z.array(z.string()).optional()`。

### 5.8 overlay（追加到 §1.4）

- `IntegrityCard.tsx` issue 行：渲染 `requirement_ids` chip 与 `spec_ids` chip 两组。
- `card-tree.ts` & `tree-writer.ts` issue 类型加 `requirement_ids?` `spec_ids?` 透传。

### 5.9 测试新增（合并进 §1.6）

- `test/integrity/requirement-status.test.ts`：
  1. 无 goal_run → 全部 `unstarted`。
  2. 一 claiming goal 跑 completed，与 REQ 关联的 essential spec 全 pass → `done`。
  3. essential spec 部分 fail → `partial`，relatedSpecs 列出 fail 的 spec_id。
  4. REQ 没有任何 goal 在 requirement_ids 中 → 不出现在 snapshot 中（让 fidelity 维度走 `uncovered` 路径处理而非状态投影）— 验证不会和 `uncovered` 重复出 issue。
- `test/integrity/agent.test.ts` 加：
  - implicit-dependency 用例：user 说"做股票看板页"，REQ 列表只有 FE REQ → integrity 报 `implicit_dependency_missing`，evidence 引用 user 原话，missing_goal 提议 BE REQ。
  - post-build 用例：snapshot 含 REQ aggregate `partial` → fidelity verdict `needs_correction`，issue 携带 failing `spec_ids`。
- overlay snapshot 测试：issue 同时含 requirement_ids + spec_ids 时双 chip 都渲染。

### 5.10 实施顺序（与 §2 合并）

§2 步骤间隙处插入：

- §2.2 之后：写 `requirement-status.ts` 模块（pure projection，单测优先）。
- §2.5 之后：补 dimensions.ts 第二条 checklist + summary 改动。
- §2.6 之后：orchestrator 接线 computeRequirementStatusSnapshot。
- §2.13 bench dry-run 用 5 个 case 验，重点看含 BE/FE 拆分的 case（如 webpage replica）overlay 是否能呈现 REQ 状态表。

### 5.11 不做的事（明确 out of scope）

- 不在本方案中改 requirements agent 的 prompt 让它主动抽 implicit REQ — 那是 requirements agent 的另一项独立改动。本方案 integrity 是 _审查_ 该缺失，不替 requirements agent 抽。
- 不在本方案中扩 acceptance_spec / verification-evidence 数据形状 — 现有 `spec_id` 就够 join。
- 不在 integrity 内做 retry/replan 决策 — 那是 orchestrator 的事；integrity 只产出带证据的 verdict。

---

## §6 codex 审查反馈 (rule 35 / 2026-05-10 二次审查)

> codex 0.128.0 / gpt-5.5 对 §0~§5 全文 + 仓库现状交叉审查。13 条问题中 7 条是 hard data-flow / 协议错误，3 条是漏点（rule 35 漏调用），3 条是架构原则违规。逐条记录与修订，禁止静默改写。

### 6.1 数据 join 错误（必修，否则跑不通）

**[codex #4] REQ-N ID 取错位置。**
`engine_requirement.id` 是内部生成 id；用户可见的 `REQ-N` 在 `metadata.source_requirement_id`（参见 `engine/persist.ts:295` 与 `orchestrator/tools.ts:1369` 的现成映射）。
**修订**：§5.2 `RequirementStatusRow.reqID` 注释从 `// REQ-N` 改成 `// 可见 REQ-N，从 row.metadata.source_requirement_id 提取，缺则回落 row.id`；`computeRequirementStatusSnapshot` 复用 `orchestrator/tools.ts:1368-1376` 同样的映射逻辑（抽出为 helper `extractVisibleReqID(row): string`）。

**[codex #5] `findLatestGoalRunEvidence(goalID)` 跨重试会拿旧 run 的 evidence。**
该函数按 goal 取 newest evidence，retry/superseded 场景会把上一轮绿的 evidence 当本轮结果。
**修订**：§5.2 实现改用 `findLatestTipGoalRun(goalID)` 拿当前 tip run，再用 `findGoalRunEvidence(tipRun.id)` 取该 run 的 evidence；无 tip run → `runStatus = "unstarted"`、specOutcomes 为 `[]`。

**[codex #6] `runStatus` 不能从 evidence 拿。**
`VerificationEvidence.status` 是 `EngineEvaluationStatus`（pass/fail/...），不是 `EngineGoalRunStatus`（queued/running/completed/...）。
**修订**：§5.2 字段两路分明 — `runStatus` 从 `GoalRunRow.status` (`engine/store.ts` `findLatestTipGoalRun` 返回的 row)；`specOutcomes[].passed?` 从 evidence 的 `checks[].status` 映射（`status === "passed"` → true，failed → false，其他 undefined）。

**[codex #7] spec join 方向错。**
`checks[].spec_id` 等于 `AcceptanceSpec.id`（即 `acc-foo-1` 这种），不是 `source_requirement_id`（即 `REQ-3`）。§5.1 / §5.2 描述里隐含 "checks[].spec_id ↔ source_requirement_id == REQ-N" 是错的。
**修订**：两步 join — (a) 对每个 claiming goal，从其 `acceptance_specs` 数组挑出 `source_requirement_id == REQ-N` 的 spec 子集（这步在内存里做，goal 行已有完整 acceptance_specs JSON）；(b) 把 evidence.checks 按 `spec_id` 索引成 Map，逐个 spec 查 outcome。具体代码在 §5.2 实现里写明。

### 6.2 漏调用点（rule 35 inventory 不完整）

**[codex #1]** `packages/opencorvus/src/session/session.sql.ts:35` 注释里有 `goal_fidelity` 字面量；`packages/opencorvus/test/integrity/apply-corrections.test.ts` 使用了 `IntegrityResult` 但未列入 §1.1 / §1.6。
**修订**：

- §1.5 表追加 `session.sql.ts` line 35 注释字面量改名一行。
- §1.6 mock 列表追加 `test/integrity/apply-corrections.test.ts` — 仅类型导入，无字面量改动；但若 §6.4 决定收口 implicit_dependency_missing，则保持原样。

**[codex #2]** `packages/opencorvus/src/orchestrator/tools.ts:152-158` 的 `renderIntegrityMarkdown` 只渲染 `goalIDs` + `evidence`，新增的 `requirement_ids` / `spec_ids` 会在 markdown 里被丢弃，而 markdown 是 orchestrator + acceptance 读 review 的主路径。
**修订**：§1.2 `orchestrator/tools.ts` 行追加修改：`renderIntegrityMarkdown` 在 issue 行后加 `req=[REQ-N,...]` 与 `specs=[acc-...,...]` 两个可选段，与 `goal_ids=[...]` 并列。

**[codex #3]** `packages/overlay/src/styles/surfaces/inspector.css:1718` 列举了 issue `data-type` 选择器，新增 issue type 没 CSS → 渲染无样式。
**修订**：见 §6.4 决定 — 若收口（不再加 `implicit_dependency_missing`），此项作废；若保留，§1.4 表追加 inspector.css 一行。

### 6.3 架构原则违规

**[codex #10] host-side 计算 `done/partial/not_done` 违反 rule 6.1（prompt-over-host invariant）。**
原 §5.2 `aggregate` 字段 + §5.1 "REQ aggregate `partial` despite green claiming goal = real `partial`" 是把"完成度判断"放在 host 而不是 prompt。这正是 CLAUDE.md feedback log 2026-05-07 的同种错误。
**修订**：删除 `RequirementStatusRow.aggregate` 字段。host 只投影原始数据 — `reqID`、`claimingGoals[]`、每个 goal 的 `runStatus` 和 `specOutcomes[]`（含 severity / passed?）— 由 LLM 在 prompt 中判断 done/partial/not_done。§5.1 audit point B 描述改为"LLM walks the snapshot row by row and judges REQ completion from raw run + spec outcomes; host does not pre-compute aggregate."

**[codex #11] `implicit_dependency_missing` 与 `technical_feasibility.missing_capability` 语义重复（FE page 缺 BE API = missing_capability）。**
**修订**：删除新 issue type。implicit-tier walk 不进 `requirement_fidelity` 而进 `technical_feasibility` 的 checklist —— 那里本来就有"merged-tree completeness ... missing_capability against an implicit infra goal"（dimensions.ts:122）。具体改动：

- `requirement_fidelity.issueTypes` 不变（仍是 4 个：uncovered / partial / distorted / merged_incorrectly）。
- `technical_feasibility.checklist` 加一条："**User-deliverable tier walk.** For each user-visible REQ, derive its implementation tier (FE deliverable → BE API + data source; CLI → runtime + storage; webhook → reachability infra). For each implied tier without a producing goal in the merged tree, that's `missing_capability`. Cite the user phrase that implies the missing tier in `evidence`."
- `IntegrityIssueType` 不增项；§5.7 关于 `implicit_dependency_missing` 的事件协议改动作废。
- §1.4 inspector.css 漏点（codex #3）作废。

**[codex #12] 修复路径夸大了 integrity 的能力。**
`GoalCorrectionUpdates` 只能改 goal 字段；`MissingGoal` 创的 goal 写死 `source_requirement_id: "integrity-pending"`、`requirement_ids: []`。§5.1 / §5.3 早稿曾用 ~~propose-new-REQ~~ / ~~modify-REQ-scope~~ 这种描述性夸大说法 — 实际 wire schema 不允许 integrity 改 REQ 行。
**修订**：§5.1 / §5.3 全部改成"propose missing_goal that owns the implied tier"（goal 层修复）+"modify-correction on goal.requirement_ids to rebind"（goal 层重新认领），并显式声明：integrity NEVER mutates REQ rows; if the REQ list itself is malformed, integrity surfaces the issue and the orchestrator decides whether to re-run the requirements agent. 加注脚："REQ-row mutations are out-of-scope by schema design — see GoalCorrectionUpdates @ integrity/agent.ts:145."

### 6.4 状态/时序 gap

**[codex #8] post-build integrity 会被 pre-build 的 attempt 跳过。**
`project-gate.ts:332` + `orchestrator/tools.ts:3631` 的 `findLatestIntegrityAttemptArtifact` 只按 `(taskID, kind=integrity_attempt, payload.spec_snapshot_id)` 检索，不区分 pre-build vs post-build。一次 pre-build 通过的 attempt 会被 acceptance gate 当作"已审"，post-build 永远不重跑。
**修订**：在 attempt payload 加 `phase: "pre_build" | "post_build"` 字段（`recordIntegrityAttempt` 输入加 `phase` 必填）。`buildReviewEvidence` (project-gate.ts) 与 `findLatestIntegrityAttemptArtifact`（store.ts）都按 phase 过滤；`runIntegrityReviewOnce` 自己依据上下文（是否存在 tip goal_run with completed/failed status）决定本次 phase。acceptance 阶段必须看到一个 `phase=post_build` 且新于最近 tip goal_run completion 的 attempt 才算 "已审"。

- §1.5 追加 `engine/persist.ts recordIntegrityAttempt` 加 `phase` 字段；`findLatestIntegrityAttemptArtifact` 加 `phase` 参数。
- §1.5 追加 `acceptance/checks/project-gate.ts:332` 改逻辑（按 phase + freshness 过滤）。
- §1.6 追加测试："pre-build integrity attempt does not satisfy post-build acceptance gate"。

**[codex #9] §5.5 (pre-build 空) vs §5.9 (no goal_run → unstarted) 表述自相矛盾。**
**修订**：澄清规则 — `computeRequirementStatusSnapshot` 永远走完整 join，但只有当至少一个 REQ 的 claiming goal 存在 goal_run 行（任意状态）时才返回非空数组；否则返回 `[]`。`buildIntegrityPrompt` 仅在数组非空时插入 `# Requirement Status Snapshot` 段。"no goal_run → unstarted" 描述的是数组非空但某些 goal 没跑过的情形（混合状态）。修在 §5.2 文字里。

### 6.5 测试补齐（rule 36，[codex #13]）

§1.6 / §5.9 追加：

- `renderIntegrityMarkdown` 保留 `requirement_ids` 与 `spec_ids` 字段（issue 行渲染断言）。
- `IntegrityReviewCompleted` 事件 payload 实际含 issue 的两个新字段（emit 端断言）。
- REQ-N 取 `metadata.source_requirement_id` 而非 `row.id`（snapshot helper 单测覆盖正反例）。
- retry / superseded 场景下，snapshot 取 tip run evidence、不被旧 run 污染。
- claiming goals 全 fail → snapshot 显示 essential spec failed=true；prompt 给 LLM 后 LLM 输出 `partial` verdict（agent 集成测试用 mock LLM）。
- 多 claiming goals 混合 pass/fail → snapshot 列每个 goal 各自的 specOutcomes；不在 host 做 OR 聚合。
- pre-build phase attempt 不通过 post-build acceptance gate（project-gate 集成测试）。
- snapshot 为 `[]` 时，prompt 不渲染 `# Requirement Status Snapshot` 标题（避免空标题）。

### 6.6 对 §0~§5 的最终增量

- §0 决策列表：删"`implicit_dependency_missing` 新 issue type"项；保留"REQ status snapshot 注入 prompt"，但把"完成度由 host 计算"改成"完成度由 LLM 从原始证据判断"。
- §1.5 + §1.6：增 `phase` 字段、`findLatestIntegrityAttemptArtifact` 参数、project-gate 过滤逻辑、session.sql.ts 注释、apply-corrections.test 项。
- §1.2：`orchestrator/tools.ts renderIntegrityMarkdown` 增 `req=[]` `specs=[]` 渲染。
- §5.1 / §5.2 / §5.3：删 `implicit_dependency_missing` issue type；implicit-tier walk 移到 `technical_feasibility.checklist`；`RequirementStatusRow` 删 `aggregate`；reqID 走 `metadata.source_requirement_id`；evidence 走 `findLatestTipGoalRun + findGoalRunEvidence`；spec join 两步走。
- §5.7：删除（implicit_dependency_missing 取消，spec_ids 字段保留 — 用于 post-build issue 引用 failing spec）。
- §5.10 实施顺序保持，但 `requirement-status.ts` 的 RequirementStatusRow 形状按 §6.1 / §6.3 修订。

完成上述修订后再次 commit；本节 §6 不删（保留审查痕迹）。
