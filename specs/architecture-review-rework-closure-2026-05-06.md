# Architecture Review Rework Closure — 2026-05-06

> 落盘以满足 rule 32（方案落盘前必须落盘） + rule 35（方案落盘前必须穷举调用点）。
>
> 上游 spec：`specs/orchestrator-collaboration-closure-2026-05-05.md`（design intent）。本 spec 不重新发明协议，只补齐 5/5 那份 spec 已经写过、但代码尚未完整实现的几条规则。

## Trigger

Overlay benchmark `_smoke-ai-chat-20260506-132728`：

```
05:46:55  G1 V1 → passed
05:49:03  integrity needs_correction (9 issues, 1 correction)   ─┐
05:49:03  supersedeGoalRun:architecture_review_rework            │  G1
05:49:29  G1 V2 build invoked                                    │  无限
05:52:05  V2 → failed                                            │  V_n
05:53:59  integrity needs_correction (16 issues, 0 corrections)  │  循环
05:53:59  supersedeGoalRun:architecture_review_rework            │
05:54:08  G1 V3 build invoked                                    │
05:56:35  V3 → failed (missing_terminal_report)                  │
05:57:20  G1 V4 build invoked                                   ─┘  ...
```

V3 实测：LLM 读了 V2 worktree 的 10 个文件 (`package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, ...)，evaluate 自身满足，调 `merge_back` ff 成功（mergedHead=07bd5c5a8215），调 `report_build_result({status:"passed", files_changed:[]})` —— zod schema reject `files_changed.min(1)` → 3-turn recovery 用尽 → `missing_terminal_report` → V3 failed。

## Root Cause（4 层互锁）

### Layer 1 — review verdict 缺 sanity check

`packages/opencorvus/src/integrity/agent.ts:357-365` verdict 重整：

```ts
let verdict = sub.verdict as IntegrityVerdict
if (corrections.length > 0 || missingGoals.length > 0) verdict = "needs_correction"
else if (verdict === "pass" && issues.length > 0) verdict = "concerns"
if (verdict === "needs_correction" && issues.length === 0 && corrections.length === 0 && missingGoals.length === 0) verdict = "pass"
// ❌ 缺：needs_correction + N issues + 0 corrections + 0 missingGoals → concerns
```

`integrity-core.txt:33-37` 明确教 LLM "When a finding is repairable at the goal layer, emit corrections / missing_goals. Use `concerns` only for advisory findings that do not have an executable goal-layer repair."

但 review LLM 可以违反（V3 实测 16 issues + 0 corrections + verdict=needs_correction）。代码无兜底，错误升级至 needs_correction → 触发 rework。

### Layer 2 — fallback 路由违反 prompt 承诺

`packages/opencorvus/src/orchestrator/tools.ts:852-870` `postBuildReviewReworkGoalIDs`：

```ts
if (targetIDs.size > 0) return Array.from(targetIDs)
if (verdict === "needs_correction" || correctionsCount > 0 || missingCount > 0) {
  return [input.fallbackGoalID]   // ← attachedGoalID = 当前 build 的 goal
}
```

`packages/opencorvus/src/prompt/core/orchestrator-core.txt:352-353` 明文承诺：

> "post-build architecture_review routes findings to the affected goal IDs **it names instead of defaulting to the just-built goal**"

代码恰好做了 prompt 禁止的事。把 task-level 架构问题（goal_X vs goal_Y ownership_overlap）硬塞给当前 build 的 goal（脚手架 G1），G1 build agent 读完 prompt 完全无法处理。

副 bug：`integrity/agent.ts:323` issues[].goalIDs 直接采纳 LLM 字符串，未做 DB 存在性过滤（不像 corrections 走 `goalIDs.has(c.goal_id)`，agent.ts:331）。LLM 写 logical name "goal_session_mgmt" → 进 issueGoalIDs → `dependentGoalClosure` → `findLatestTipGoalRun` 返回 null → `startNewAttempt` 抛 "goal not found"。rule 8 双源未保护。

### Layer 3 — 收敛边界缺失

`startNewAttempt({ reason: "architecture_review_rework" })` 无 retry_count 上限。每次 V_n failed → review 又拒 → 又 startNewAttempt → V_{n+1}。

`specs/orchestrator-collaboration-closure-2026-05-05.md:36`：

> "Correctable Integrity needs a convergence boundary: after repeated same-spec correction attempts, the initial decomposition is no longer scientifically stable and Architect must re-plan."

L79 同段：

> "Non-pass post-Build review findings call `startNewAttempt(reason='architecture_review_rework')` for the same goal with concrete retry feedback; they become evidence for an explicit Architect decision **only when delivery/build evidence proves the goal graph is structurally wrong**."

代码实现了"open new attempt"，未实现"upgrade to architect re-run after N attempts"。

### Layer 4 — files_changed.min(1) 把"诚实 0-edit"逼成非法

`packages/opencorvus/src/build/types.ts:109`：

```ts
export const BuildPassedResultSchema = z.object({
  status: z.literal("passed"),
  ...BuildResultBase,
  files_changed: z.array(BuildFileChange).min(1),   // ← 强制
}).strict()
```

retry 场景下 prompt（`orchestrator/tools.ts:4555`）鼓励 "edit in place rather than start from scratch unless the failure forces a structural rewrite"，LLM 读 worktree 看见 V_{n-1} 已经写完，正确反应是"无新增改动"，但 schema 不允许 0-edit + passed。

LLM 想报 status=failed 又没具体 error（V_{n-1} 真满足 acceptance），陷入两难 → recovery 3-turn 用尽 → `missing_terminal_report`。

## Call Site Audit (rule 35)

### 涉及修改的函数 / schema

| Symbol | File:Line | 调用方 |
|---|---|---|
| `IntegrityResult` verdict 重整 | `integrity/agent.ts:357-365` | `runIntegrityReview` 唯一汇集点；`reviewIntegrity` export 入口 |
| `postBuildReviewReworkGoalIDs` | `orchestrator/tools.ts:852-870` | `tools.ts:4876` 唯一调用点 |
| issues[].goalIDs 采纳 | `integrity/agent.ts:323` (`goalIDs: it.goal_ids`) | 唯一汇集到 IntegrityIssue.goalIDs；下游 `tools.ts:847` `issueGoalIDs` flatMap |
| `openArchitectureReviewRework` | `orchestrator/tools.ts:903-955` | `tools.ts:4882` 唯一调用点 |
| `BuildPassedResultSchema` | `build/types.ts:106-110` | `build/agent.ts:414` (`inputSchema: BuildResultSchema`)；`build/agent.ts` 内部 `parsed = BuildResultSchema.safeParse`；测试 `test/build/*` |
| `BuildResultBase.files_changed` | `build/types.ts:88-93` | 同 BuildPassedResultSchema，且被 BuildFailedResultSchema 共享（已有 `.default([])`） |
| retry feedback prompt 渲染 | `orchestrator/tools.ts:4550-4565` | per-build 注入；不在本次修改范围（layer 2 解决根因后 retry feedback 累积本身被截流） |
| `report_build_result.execute` | `build/agent.ts:409-456` | 内部 0-edit cross-check |
| `BuildAgentContractError` | `build/types.ts:150` | `build/agent.ts:723` 抛点；`orchestrator/tools.ts` 接收 |
| `build-core.txt` retry 指南 | `prompt/core/build-core.txt` | build agent 系统 prompt |

### 测试文件涉及

```
test/integrity/                    — Fix 1 单测
test/orchestrator/                 — Fix 2/3 单测
test/build/                        — Fix 4 单测
test/build/build-result-schema.test.ts — Fix 4 schema refine
```

待 grep 调用点扩展（执行时再补 if 漏）。

## Fix（4 层联动）

### Fix 1 — `integrity/agent.ts:357-365` 加降级兜底

```ts
let verdict = sub.verdict as IntegrityVerdict
if (corrections.length > 0 || missingGoals.length > 0) {
  verdict = "needs_correction"
} else if (verdict === "pass" && issues.length > 0) {
  verdict = "concerns"
}
if (verdict === "needs_correction" && issues.length === 0 && corrections.length === 0 && missingGoals.length === 0) {
  verdict = "pass"
}
// NEW: needs_correction 没 actionable repair → 按 prompt 应该是 advisory concerns
if (verdict === "needs_correction" && corrections.length === 0 && missingGoals.length === 0) {
  verdict = "concerns"
}
```

不 break 既有测试：原行为只有当 LLM 自己输出 needs_correction 但 0 corrections 时才被改写。LLM 行为符合 prompt 时（needs_correction → 必有 corrections 或 missingGoals）路径不动。

### Fix 2 — `orchestrator/tools.ts:852-870` 删 fallback + DB 验证

```ts
function postBuildReviewReworkGoalIDs(input: {
  review: Extract<IntegrityReviewOutcome, { status: "reviewed" }>
}) {
  const dbGoals = listGoals(taskID)
  const dbGoalIDs = new Set(dbGoals.map((g) => g.id))
  const targetIDs = new Set<string>()
  for (const goalID of input.review.issueGoalIDs) {
    if (goalID && dbGoalIDs.has(goalID)) targetIDs.add(goalID)
  }
  for (const goalID of input.review.correctionGoalIDs) {
    if (goalID && dbGoalIDs.has(goalID)) targetIDs.add(goalID)
  }
  return Array.from(targetIDs)
}
```

签名变更：移除 `fallbackGoalID` 参数（rule 7：禁止 fallback）。所有调用点（仅 `tools.ts:4876`）相应去掉传参。

`tools.ts:4880-4892` 配合：
- `reviewTargetGoalIDs.length === 0` 时（advisory 无 actionable target）→ `architectureReviewAllowsDeliver = (verdict === "concerns" || verdict === "needs_correction")`，advisory 当 concerns 处理放行
- 文案改成 "advisory feedback recorded; no goal-scoped retry target"

### Fix 3 — `openArchitectureReviewRework` 收敛边界

`MAX_REVIEW_REWORK_PER_GOAL = 2`（同 goal 同 spec 上 architecture_review_rework 上限）。

```ts
async function openArchitectureReviewRework(input: ...) {
  const { startNewAttempt, countAttemptsByReason } = await import("@/engine/persist")
  const reworkLines: string[] = []
  const exhaustedGoals: string[] = []
  for (const item of dependentGoalClosure(input.targetGoalIDs)) {
    const reason = item.direct ? "architecture_review_rework" : "architecture_review_dependency_rework"
    const priorCount = countAttemptsByReason({ goalID: item.goalID, reason })
    if (priorCount >= MAX_REVIEW_REWORK_PER_GOAL) {
      // 不再开新 attempt：写 decision_log evidence，让 orchestrator 升级 architect re-run
      decisionLog.append({
        phase: "retry",
        goalID: item.goalID,
        key: `architecture_review_exhausted_${item.goalID}`,
        value:
          `architecture_review_rework on ${item.goalID} reached ${MAX_REVIEW_REWORK_PER_GOAL} attempts; ` +
          `rework cannot converge on the current goal graph. Consider explicit architect re-run if delivery evidence supports it (spec orchestrator-collaboration-closure-2026-05-05.md L36/L79).`,
        reason: "review_rework_exhausted",
      })
      exhaustedGoals.push(item.goalID)
      continue
    }
    // ... 既有路径
  }
  return { reworkLines, exhaustedGoals }
}
```

`countAttemptsByReason` 是新 helper（engine/persist.ts），按 goalID + supersede reason 数 attempt。如果已有等价 helper 就复用（rule 35 grep 后决定）。

### Fix 4 — `BuildPassedResultSchema` 0-edit 合法

`build/types.ts`：

```ts
export const BuildPassedResultSchema = z.object({
  status: z.literal("passed"),
  ...BuildResultBase,                          // ← BuildResultBase.files_changed 已经无 min
  files_changed: z.array(BuildFileChange),     // 不再 .min(1)
  reused_prior_attempt: z.object({
    rationale: z.string().min(20).describe(
      "Why the prior attempt's worktree state already satisfies all acceptance_specs without new edits."
    ),
  }).optional().describe(
    "Set when reporting passed with files_changed=[] in a retry scenario where the prior attempt's worktree is already correct."
  ),
}).strict().refine(
  (v) => v.files_changed.length > 0 || v.reused_prior_attempt !== undefined,
  { message: "passed with empty files_changed[] requires reused_prior_attempt.rationale" },
)
```

`report_build_result.execute` 加 cross-check（`build/agent.ts:415`）：

```ts
if (result.status === "passed" && result.files_changed.length === 0 && result.reused_prior_attempt) {
  // 验证 baseRef..HEAD 真有 commits（worktree 真有"前序成果"，不是空 worktree 假报）
  const actualDiffs = await currentBuildDiffs().catch(() => undefined)
  if (!actualDiffs || actualDiffs.length === 0) {
    return (
      "Error: reused_prior_attempt requires the worktree to contain commits from a prior attempt; " +
      "but baseRef..HEAD diff is empty (no prior commits to reuse). " +
      "Either implement and commit changes, or report status='failed' with a concrete error."
    )
  }
}
```

`build-core.txt` 在 "## What you do" 段尾追加：

```
### Retry scenarios (worktree already has prior-attempt files)

If you started this session in a worktree that already contains a prior attempt's
files (the orchestrator's `## Prior Attempt Failed` section will tell you), and
after reading those files you confirm they ALREADY satisfy every acceptance_spec
without further edits:

  - Call `merge_back` (publishes the prior commits to primary), then call
    `report_build_result` with:
      status: "passed"
      files_changed: []
      reused_prior_attempt: { rationale: "<concrete sentences explaining why the
                              existing worktree state satisfies every acceptance_spec
                              and what changed since the prior attempt failed>" }

Do NOT fabricate `files_changed[]` entries describing files you did not touch this
session — the host audits files_changed[] against the actual git diff. Do NOT
report status='failed' if the work is genuinely complete.
```

## Acceptance（rule 36 — 每条 fix 配测试）

### 单测

1. `test/integrity/verdict-downgrade.test.ts`：
   - submit needs_correction + 16 issues + 0 corrections + 0 missingGoals → 重整后 verdict === "concerns"
   - submit needs_correction + 1 correction + 0 missingGoals → 保持 needs_correction（既有路径不破）
   - submit pass + 0 issues → 保持 pass

2. `test/orchestrator/post-build-review-routing.test.ts`：
   - issueGoalIDs=["unknown_logical_name"] + DB 无此 ID → reviewTargetGoalIDs=[]
   - issueGoalIDs=[] + correctionGoalIDs=[] + verdict=needs_correction → reviewTargetGoalIDs=[]，且 architectureReviewAllowsDeliver=true
   - 删除 fallbackGoalID 后调用方编译通过

3. `test/orchestrator/review-rework-convergence.test.ts`：
   - 同 goal 同 spec 第 1 次 architecture_review_rework → 开新 attempt
   - 第 2 次 → 开新 attempt
   - 第 3 次 → 不开新 attempt，decision_log 写 `architecture_review_exhausted_${goalID}`
   - exhaustedGoals 在 rework return 里出现，build tool 文案展示 "review rework exhausted; consider architect re-run"

4. `test/build/build-result-schema-zero-edit.test.ts`：
   - parse({status:"passed", files_changed:[], reused_prior_attempt:{rationale:"x".repeat(20)+" reason"}, ...}) → success
   - parse({status:"passed", files_changed:[], ...}) → fail with "requires reused_prior_attempt.rationale"
   - parse({status:"passed", files_changed:[{...}], ...}) → success（既有路径不破）
   - parse({status:"failed", files_changed:[], error:"x", ...}) → success（failed 不变）

### Bench 验收

重跑 `_smoke-ai-chat-2026...`：
- G1 V1 → passed
- integrity needs_correction + 0 corrections → 兜底 concerns → deliver 放行（Fix 1+2 生效）
- 即便 review LLM 提出 corrections 路由 → 同 goal 第 3 次自动停止（Fix 3 生效）
- retry 场景 LLM 用 reused_prior_attempt 报告 → 通过（Fix 4 生效）
- 最终 evaluation=accepted 或 architect re-run 被显式触发；不再无限 V_n

## Pre-existing test failure (not introduced by this fix)

`test/orchestrator/architect-fidelity-gate.test.ts:32` "rejects build dispatch when persisted fidelity coverage is incomplete" fails when run from `packages/opencorvus/` cwd: the test does `workDir = process.cwd()` and feeds `owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"]`, which resolves to `packages/opencorvus/packages/opencorvus/src/...` and `fs.existsSync` returns false. HEAD version matches this fix's worktree version; failure is unrelated to architecture-review-rework. Fix-out-of-scope; track separately.

## Out of scope

- retry feedback prompt 累积去重（spec L36 提到的另一个相邻问题，本次不动；Fix 1+2+3 解决后污染源被切断，retry feedback 不再快速增长）
- delivery_rework / build_retry 路径的同类 fallback 检查（如有）放在下一轮 audit
- architect re-run 自动决策算法（本 fix 只产出 evidence，让 orchestrator LLM 自己决策；rule 13 禁止状态机）
- `packages/opencorvus/src/tool/goal-report.ts:35` 同样的 `files_changed.min(1)`：这是 base agent 的 `goal_report` 工具（与 mirrorcode/external executor 走的 `BuildResultSchema` 不同路径），不在本次 review_rework 修复路径上。如未来 base agent 或 codex/claude-code path 触发同类 0-edit retry 死循环，参照 Fix 4 模式再开一份 spec。

## Cron 规范

本次属于"按用户明确要求一次性重构"，不是无人值守迭代。不设 session-level cron。
