# 09 — Verification Evidence

> **状态（2026-05-12）**：本 spec 设计的 evidence 模型已实施，**底层存储统一为
> `engine_artifact` + `kind="verification-evidence"`**；`engine_evaluation` 表已删（Phase 6-b）。
>
> 现行公开 API：
>
> - `verification/persist.ts` — `persistEvidence` / `findLatestGoalRunEvidence` /
>   `findGoalRunEvidence` / `findLatestAcceptanceEvidence`（**4 个 export**；该文件顶部注释里
>   出现的 `findPreviousAcceptanceEvidence` 名字属于跨文件描述，真函数是
>   `acceptance/manifest.ts:findPreviousAcceptanceEvidenceManifest`，按 manifest 角度查 evidence）
> - `verification/query.ts` — `queryEvidence` / `renderEvidence`（当前无 acceptance tool 包装）
> - `acceptance/arbiter.ts` — `arbitrateAcceptanceGate` / `arbitrateAcceptanceVerdict`
>   （**arbiter 真源在 `src/acceptance/`，不在 `src/metrics/`**；`src/metrics/` 只导出
>   `types / score / store / executor`）
> - `computeSignature` 这个函数从未在 `src/` 中落地，本文 §Signature 章节是历史决策
>
> 本文余下章节是**设计原始论证**，作为历史决策保留：所有 `goal-pool.ts` / `engine_evaluation`
> 表 / `goal/runner.ts:467 buildRetryFeedbackSection` / `prefetchAcceptanceContext` /
> `FrontendCheck.renders_correctly` 等具体符号已不存在或已迁移；§Phase A-F 视为已完成或失效。
> 表名 / 字段以代码为准。`engine_evaluation` 表整张已下线（`engine.sql.ts:552-556`
> 注释），verdict/checks 现以 `engine_artifact.kind="verification-evidence"` 的 payload
> 持久化；`EngineEvaluationScope/Status/Verdict/Check` TypeScript 类型仍在
> `engine.sql.ts:120-160` 区域，只是不再绑表。<br>
> **2026-05-10 起的新增物（在本文中无对应章节）**：
>
> - `AcceptanceSpec.scenario` 字段（Gherkin Given/When/Then，`acceptance/types.ts:24,119`）
>   作为 walkthrough 的结构化来源，影响 evidence check 的人类可读 reasoning。
> - `engine_artifact.kind="orchestrator-stream-error"`（`engine.sql.ts:120`、
>   `engine/persist.ts:1964`）记录 orchestrator session 流式异常；与 verification-evidence
>   并列，不是同一 kind。
> - 集成度审计已迁出 evidence 管线：参考 `integrity/agent.ts` 的 post-build
>   `Requirement Status Snapshot` 与 `contract_audit` / `ContractIR` /
>   `architect/linker.ts` 链路。
> - Acceptance review/tool/service surface 已删除；runtime screenshot capture 归属
>   `build/screenshot-tool.ts` + `runtime/page-capture.ts`，最终验收归属 `integrity/`。
>
> 对应代码：`src/engine/engine.sql.ts` (EngineArtifactTable) · `src/engine/persist.ts` ·
> `src/engine/store.ts` · `src/acceptance/checks/` · `src/acceptance/arbiter.ts` ·
> `src/runtime/page-capture.ts` · `src/build/screenshot-tool.ts` · `src/acceptance/contract-audit.ts` · `src/acceptance/types.ts` ·
> `src/orchestrator/tools.ts` · `src/verification/persist.ts` · `src/verification/query.ts`

## 一句话

正本清源的是 **evaluation 的 scope 与写入时机**，不是再加一张并列表。`engine_evaluation`
表已经原生支持 `goal_run_id` 与 `acceptance_id` 两个可空外键 —— "验证证据" (Verification
Evidence) 是跨越这两个 scope 的领域概念；落地形态是在既有行上补字段、补写入点、补
language，而非新开一张表。

## 问题

1. **机械校验的真值延迟**。executor 声明完成 → `goal_run.status = "completed"` → 合并
   → acceptance-time 才跑 acceptance_specs。per-goal 评估虽然已经在 `goal-pool.ts:699`
   调 `evaluateGoal`，但产物（`verdict.checks`）只被 upsert 到 `task.metadata.criteria_results`
   作为 UI view (`goal-pool.ts:710-721`)，**不落任何 evaluation row**。失败信号只能
   从 `goal_run.status="failed"` 间接读 `error` 字符串（`goal-pool.ts:728`），没有结构
   化证据供下游（retry prompt、rework 无进展检测、acceptance 短路）复用。

2. **acceptance-time 重复跑**。`orchestrator/tools.ts:2179` 又对合并后的 worktree 调了
   一遍 `evaluateGoal`。同样的 shell 命令、同样的 spec，跑两次：一次在 goal 自己的
   worktree 里（落到 task.metadata），一次在合并 worktree 里（落到 acceptance 级）。两
   次的结果可能不一致（on_goal spec 在单 goal worktree 过但合并后 grep 不到其它 goal
   的产出），也可能完全一致（纯粹浪费）。没有"读缓存就好"的能力，因为缓存主体不存在。

3. **retry prompt 用模糊字符串**。`goal/runner.ts:467`
   的 `buildRetryFeedbackSection` 读 decision-log 上一轮的 "retry analysis" 自然语言
   条目。这是 LLM 写给 LLM 的文字，不是机械 check 的结构化证据。executor 无法对着"哪
   条 spec 失败、什么 exit_code、stdout 末 500 字"下手修。

4. **rework 无进展检测不存在**。`orchestrator/tools.ts:2497` 只比较 `reworkHistory.length

   > max_acceptance_iterations`。没有"两次失败内容是否一致"的判断。bench8 观察到：同一个
14 条 strict fail 集合连续出现 3+ 次，直到耗尽 `max_acceptance_iterations=3` 才 fail_task，
   > 浪费 15-40 分钟在已知无解的重复上。

5. **on_goal / on_acceptance trigger 语义没被文档提升**。`acceptance/types.ts:125-130`
   的 `resolveTrigger` 是个现成合同：heuristic/prebuilt 默认 `on_goal`，llm_judge
   essential → `on_goal`，其它 → `on_acceptance`。`per-goal.ts:242-253` 对 on_acceptance
   的 heuristic 显式延后（`"deferred to acceptance — not executed at goal stage"`）。
   这个 **不是漏跑，是契约**。证据模型必须在行上标注 scope，否则会误以为漏了或误认为重复。

6. **`EngineGoalCheck` 太扁**。
   ```ts
   // engine.sql.ts:103
   type EngineGoalCheck = { name: string; label?: string; family?: string; status: ...; evidence?: string }
   ```
   没有 `mode`（strict/soft）、没有 `severity`、没有 `operator_kind`、没有 `exit_code`、
   没有归一化的输入快照。rework 无进展检测要用这些字段算 signature，短路要用 mode。
   现在没有地方放这些。

## 设计

### 概念：Verification Evidence

一个 **evidence** = "一次 scope 内，全部 applicable scorer 被跑一遍的结构化结果"。
scope 有两种：

- `scope="goal_run"` — 在某个 goal_run 的 worktree 里跑 **该 goal 的 on_goal scorer**。
  写入点：`goal-pool.ts` 在 `evaluateGoal()` 返回之后、`updateGoalRun(status=completed|failed)`
  之前。
- `scope="acceptance"` — 在合并 worktree 里跑 **全部 goal 的 on_acceptance scorer +
  acceptance-agent 判决**。写入点：现有 `persistAcceptance()` (`persist.ts:470`) 的延伸；
  `orchestrator/tools.ts` acceptance 分支不再重复 eval，而是读 goal_run 级 evidence +
  补跑 on_acceptance scorer。

一个 goal 在它的生命周期里会产出 N 条 `scope=goal_run` 的 evidence（每次 retry 一条）
和若干条 `scope=acceptance` 的 evidence（每一轮 acceptance rework 一条，按 `run_id` 串起来）。

### 物理模型：扩展既有 `engine_evaluation`，不新开表

```ts
// engine.sql.ts
export const EngineEvaluationTable = sqliteTable("engine_evaluation", {
  id: text().primaryKey(),
  task_id: text().notNull().references(...),
  run_id: text().notNull().references(...),
  goal_run_id: text().references(...),        // 当前保留
  acceptance_id: text().references(...),        // 当前保留

  // ── 新增 ──
  scope: text().$type<"goal_run" | "acceptance">().notNull(),
  signature: text().notNull(),                // hash，见下
  // checks 字段仍是 JSON，类型加厚（向后兼容新字段为 optional）

  status: text().$type<EngineEvaluationStatus>().notNull().default("pending"),
  verdict: text().$type<EngineEvaluationVerdict>().notNull().default("inconclusive"),
  summary: text().notNull(),
  checks: text({ mode: "json" }).$type<EngineEvaluationCheck[]>(),
  time_completed: integer(),
  ...Timestamps,
})
```

约束：`scope="goal_run" ⇒ goal_run_id NOT NULL`；`scope="acceptance" ⇒ acceptance_id NOT NULL`。
应用层校验（sqlite 不便表达条件 check）。

### `EngineGoalCheck` 升级为 `EngineEvaluationCheck`

```ts
export type EngineEvaluationCheck = {
  // 既有
  name: string
  label?: string
  family?: string // "goal_eval" | "acceptance_verify" | "visual_diff" | ...
  status: "passed" | "failed" | "skipped"
  evidence?: string // stdout/stderr 截断
  // 新增
  spec_id?: string // 对应 acceptance_specs[].id
  scorer_kind?: "heuristic_shell" | "heuristic_script_ref" | "llm_judge" | "prebuilt" | "visual_diff"
  mode?: "strict" | "soft" // 从 scorerMode(spec) 派生
  severity?: "essential" | "important" | "optional" | "pitfall"
  trigger?: "on_goal" | "on_acceptance"
  // 失败时可选字段
  exit_code?: number
  idle_timed_out?: boolean
  matched_paths?: string[] // grep/file_exists 操作的命中路径
  output_digest?: string // sha256(evidence) 截断 16 字节 — signature 计算用
}
```

向后兼容：旧 row 里没有新字段 → 读取侧做 fallback；signature 计算侧跳过空字段。

### Signature — 收紧到能区分"根因"而非只"结果"

```
signature = sha256(
  scope + "|" +
  sorted_join(",",
    for each check in checks where status === "failed":
      spec_id + ":" +
      (scorer_kind ?? "unknown") + ":" +
      (mode ?? "unknown") + ":" +
      (trigger ?? "unknown") + ":" +
      (exit_code ?? "na") + ":" +
      (output_digest ?? "na")
  )
)
```

为什么不只 `(spec_id, passed)`：P2 critique 说对了。如果这一轮 `build` 因为 `tsc error TS2345`
挂、下一轮因为 `tsc error TS2741` 挂，两轮结果都是 "build failed"，但根因不同，executor
retry 是有意义的。把 `exit_code` 和 `output_digest` 纳入，只有真正"完全没动过"的两轮
才签名相等 → 只有这种才判定 no progress。

### on_goal / on_acceptance 契约提升

`scope="goal_run"` 的 evidence **只**承载 `trigger="on_goal"` 的 check 结果。
`on_acceptance` scorer 在 per-goal 阶段仍然被显式列入 checks，但 `status="skipped"`，
`evidence="deferred to acceptance — not executed at goal stage"` — 保留现有行为，只是
现在这个信息被显式写进 evidence，下游（retry prompt、UI）一眼能看到"这条留到 acceptance
再验"。

`scope="acceptance"` 的 evidence 合并：每个 goal 的 `on_acceptance` scorer × 合并 worktree
结果 + acceptance-agent 的判决（记为 `family="acceptance_verdict"` 的 check 条目，
`scorer_kind="llm_judge"`）+ visual-diff 结果（`family="visual_diff"`）。

### task-wide aggregate view 保留

`task.metadata.criteria_results` 的 upsert 流继续存在 —— 它是 **evidence 的投影**，
不是另一个真值源。旧 acceptance tool surface 的 `query_criteria` 继续读 aggregate；
但 aggregate 的每一项来源都是一条 evidence row 的一个 check，不再是 orchestrator/
goal-pool 各自独立上报的。

新增 `query_evidence(scope?, goal_id?, latest?)` tool（仍在 acceptance tools.ts）供
acceptance review 精查：

- `query_evidence(scope="goal_run", goal_id="gol_...", latest=true)` → 最近一次该 goal 的 goal_run evidence
- `query_evidence(scope="acceptance", latest=true)` → 最近一轮 acceptance rework 的 evidence

`query_criteria` 保留作为快览；`query_evidence` 做 drill-down。两者不矛盾。

### 写入时机 & status 派生

**goal_run scope**（`goal-pool.ts`，evaluateGoal 之后）：

```ts
const verdict = await evaluateGoal({...})            // 既有
const evidence = await persistEvaluation({           // 新
  taskID: task.id,
  runID: run.id,
  goalRunID: goalRun.id,
  scope: "goal_run",
  verdict: verdict.verdict,
  checks: verdict.checks.map(toEvaluationCheck),
  summary: verdict.reasoning,
  signature: computeSignature("goal_run", verdict.checks),
})
await upsertTaskCriteria(...)                         // 既有 — aggregate view

if (hasStrictFailure(evidence)) {
  updateGoalRun(goalRun.id, { status: "failed", error: evidence.summary })
  // 原代码已经 updateGoalRun(status=failed) —— 保持
  return { ..., evidence_id: evidence.id }            // retry 用
}
updateGoalRun(goalRun.id, { status: "completed" })
```

**acceptance scope**（`orchestrator/tools.ts`，deliver 分支）：

1. 收集每个 goal 最新的 `scope="goal_run"` evidence。任何 strict failure → 短路路径
   合成 rejected（现有短路逻辑保留，只是判断依据从一次性计算的 `strictFailedChecks`
   变成读 evidence）。
2. 否则跑 acceptance-agent 并运行 on_acceptance scorer。结果合并成一条 `scope="acceptance"`
   evidence，写到 `persistAcceptance`/`updateEvaluationFromAcceptanceVerdict` 的同一行上
   （两段各自 setter，不引入并行表）。
3. rework 分支读当前这条 acceptance evidence 与前一条（同一 task 内 `scope="acceptance"`
   按 `time_created` desc 取第二条）的 signature 对比；相等 → fail-fast，不再等
   `max_acceptance_iterations`。

### retry prompt 真值化

`goal/runner.ts:467` 的 `buildRetryFeedbackSection` 改为：读 `findLatestFailedEvalForGoal(goalID)`
（`store.ts:768`，已存在）拿到最近的 failed evidence，列出其中 strict failures 的
`{spec_id, name, scorer_kind, exit_code, output_digest snippet}`。executor 看到的是
"第 N 轮，spec `acc-bootstrap-deps:deps-install` 失败，shell 退出码 1，stderr 末
200 字：... —— 请修"，不是自然语言摘要。

### 不做的事

- **不新建表**。新增字段统一挂 `engine_evaluation`。
- **不破坏 1:1 acceptance↔evaluation 不变量**（`persist.ts:465-467` 明文说明）。acceptance
  scope evidence 仍走 `persistAcceptance → updateEvaluationFromAcceptanceVerdict` 这条成熟
  路径，新增字段是 update 而非另行 insert。
- **不引入 spec 级 partial rerun 缓存**。这属于 P1+ 讨论；本轮只搭持久化模型和 scope
  切分。
- **不改 `ScorerSchema` / `resolveTrigger` / `scorerMode`**。它们已经对了。
- **不改 overlay UI**。UI 继续消费 `task.metadata.criteria_results`；evidence 的存在
  对 UI 透明（后续可按需再让 overlay 直接读 evidence row 以拿到更丰富字段，但不在
  本 spec 范围内）。

## 实施顺序

每一阶段都可独立编译 + 单测通过。

### Phase A — 数据模型（无行为变更）

1. `engine.sql.ts`：`EngineEvaluationTable` 加 `scope`、`signature` 字段。drizzle
   migration。默认值：旧 row 的 `scope` 按 `acceptance_id !== null ? "acceptance" :
"goal_run"` 回填；`signature` 留空字符串（历史行不参与 signature 对比）。
2. 新类型 `EngineEvaluationCheck`（在 engine.sql.ts 或独立文件）。`EngineGoalCheck`
   作为前者的 structural 子集保留供旧代码读取。
3. 新模块 `src/verification/`（建议文件：`signature.ts` — computeSignature 纯函数；
   `persist.ts` — `persistEvaluation`, `findLatestEvidence`, `findLatestAcceptanceEvidence`;
   `query.ts` — `query_evidence` tool 的底层）。不改动任何调用点。

### Phase B — goal_run scope 写入

4. `goal-pool.ts:699` 后，`updateGoalRun` 前，调 `persistEvaluation({scope: "goal_run",
...})`。不改 goal 状态逻辑，只是同时落一条 evidence 行。
5. 新 evidence 不被 retry / acceptance 读 —— 这一步是影子写入，验证表结构与 signature
   稳定。用现有 bench 跑一次，只观察 `engine_evaluation` 表新增的 goal_run row 是否
   正确，signature 是否稳定跨 retry。

### Phase C — retry prompt 真值化

6. `goal/runner.ts:467` `buildRetryFeedbackSection` 改读 `findLatestFailedEvalForGoal`
   的 evidence。decision-log 自然语言条目转为 aux，结构化 evidence 为主。
7. bench 观察：executor 在 retry 的第一条消息能具体点名 failed spec。

### Phase D — acceptance scope 合并

8. `persistAcceptance` + `updateEvaluationFromAcceptanceVerdict` 两侧各加上 scope 字段
   填 `"acceptance"`、signature 字段填本次 acceptance evidence 的签名。
9. `orchestrator/tools.ts` acceptance 分支：
   - 短路判断改读 `findLatestEvidenceForGoal(scope="goal_run")` 的 strict check
     数，而非 in-loop 调 evaluateGoal。
   - 不再重复跑 goal 的 on_goal scorer；只跑 on_acceptance scorer。

### Phase E — rework 无进展检测

10. acceptance 分支拿到当前 acceptance evidence 后，查上一条同 task 的 acceptance evidence，
    比对 `signature`。相等 → `updateTask(status="failed", error="rework not converging
across 2 iterations — same signature")`；不等 → 继续现有 rework 流。
11. 顺便把 `_acceptance_rework_history` 从"塞 feedback 字符串"降级为"存 evidence.id 指针
    列表"。

### Phase F — 新 tool + 清理

12. 旧 acceptance tool surface 加 `query_evidence(scope, goal_id?, latest?)`。
13. 删掉 orchestrator acceptance 分支里的重复 evaluateGoal 逻辑（已被 Phase D 替代）。
14. 删旧 acceptance review 的 `prefetchAcceptanceContext` —— evidence 有结构化数据
    之后 memory recall 对 verdict 不再产生边际价值，它的低 minScore=0.15 模糊召回是
    噪声。
15. 删 `FrontendCheck.renders_correctly` / `issues` / `AcceptanceVerdict.deferred_checks`
    （无人 populate）。

## 不变量

每次改动后仍需成立：

- `engine_evaluation.acceptance_id NOT NULL ⇔ scope="acceptance"`
- 一个 acceptance row 最多一条 evaluation row（1:1 不变量，`persist.ts:465` 明文）
- 一个 goal_run 可以有一条 evidence（该 goal_run 的 scope="goal_run"），也可以没有（还
  没执行完就被 abort 之类）。
- signature 是纯函数：同一组 `{spec_id, scorer_kind, mode, trigger, status, exit_code,
output_digest}` 输入产相同输出。
- `task.metadata.criteria_results` 的每一项都能从某条 evidence 的某个 check 推出 ——
  aggregate view 的唯一可信来源是 evidence 表。

## 开放点（不在本 spec 范围，另开 ticket）

- **spec 级 partial rerun**：只重跑新改动的 spec 而非整个 evidence。P2 讨论。
- **evidence UI**：overlay 目前读 aggregate；可增加一个 drill-down 面板直接展示
  evidence row 的完整 checks。属于 07-panel-reactivity 的继任。
- **跨 task 的 signature 聚类**：观察相同签名出现频率高的 failure class，做 planner
  层面的 prompt 改进。分析层面，非工程。

## 验收指标

- bench 级：同样的 usage-replica-vague 场景，acceptance rework 发生时：
  - iteration 2 的 signature 和 iteration 1 相等 → 2 分钟内 fail-fast（当前 20+ 分钟到
    3 轮耗尽）
  - iteration 2 根因变了但仍然失败 → 正常进入 iteration 3（不被误 fail-fast）
- 单测级：`computeSignature` 对 check 数组顺序、字段缺失、大小写 exit_code 都稳定；
  跨平台（Windows / Linux 行尾差异）output_digest 先归一化。
- 代码行数：净减 ~200 行（delete prefetchAcceptanceContext + 重复 evaluateGoal + dead
  fields），加 ~300 行（verification 模块 + evidence 读写）。净 +100 行，换掉至少
  5 条独立 bug。
