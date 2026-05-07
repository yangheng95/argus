# 架构 review / build 硬控制松绑方案 — 2026-05-06

## 背景

> 用户原话："这些 schema 太傻逼了，一个套一个，一个锁一个。完全把我的规则当放屁。
> agent 能力足够自动纠错，也能忍受少许的问题，照着昨天连续 benchmark 重构前的版本，
> 拆掉这些新加的傻逼 schema，我只要求消息传输不遗漏例如完整检查的 feedback 能引起
> 修复，其他的都交给 LLM。"

CLAUDE.md 明文规则：
- **rule 5**：第一性原因，禁止过度工程
- **rule 6**：承认 LLM 模型的能力足够解决大多数问题，利用 LLM 智能简化设计
- **rule 13**：禁止任何状态机代码 / if-else / switch-case 形式的流程控制，所有流程控制必须通过 LLM 智能决策实现

5/5 那一连串 benchmark 驱动的 commit 反复给 build / integrity / orchestrator 三处加自动 supersede / startNewAttempt / fallback 路由 / verdict 重整 / coverage 审计 / mergedHead 守门 ——
本质都是 rule 13 状态机违规。`_smoke-ai-chat-20260506-132728` 触发 V_n 死循环的根因正是这些
硬约束互锁（"一个套一个"）。

## 唯一保留的硬约束

**消息传输不遗漏**：integrity / build / delivery 各阶段 LLM 产出的完整 feedback 必须如实
渲染成自然语言文本，进入 orchestrator LLM 上下文。orchestrator LLM 读完文本后自行决定
modify_goal / build({goalID}) / architect / restart_from_stage / fail_task / deliver。

下游不再做"基于 count 二次决策"。

## 拆除清单（rule 35 — 全仓 grep 校对过）

### A. 消息传输完整化

| # | 文件:行 | 现状 | 改为 |
|---|---|---|---|
| A1 | `orchestrator/tools.ts:81-101` `IntegrityReviewOutcome.reviewed` | 只有 `issues: string[]`、`correctionsCount`、`missingCount`、`issueGoalIDs`、`correctionGoalIDs`，**丢失 corrections / missingGoals 详情** | 增 `corrections: Array<{goalID, action, reason, updates?}>`、`missingGoals: Array<{title, objective, reason, owned_paths, kind, priority, acceptance_spec_hints}>`、`dimensions: Array<{id, verdict, issuesText[], correctionsText[], missingText[]}>` 完整文本 |
| A2 | `orchestrator/tools.ts:4869-4872` `architectureReviewLine` | 只拼 `verdict; summary; corrections=N; missing=N` | 拼完整 markdown：每 dimension 列 issues 文本 + corrections 文本 + missing_goals 文本 + affected_goal_ids |
| A3 | `orchestrator/tools.ts:691-722` `renderIntegrityOutcome` | yieldResult 字段也只有 count + issue strings | 同 A2，让独立 `integrity` 工具调用也输出完整文本 |

### B. 删除硬控制

| # | 文件:行 | 现状 | 改为 |
|---|---|---|---|
| B1 | `build/types.ts:109` `BuildPassedResultSchema.files_changed.min(1)` | passed 强制 ≥1 | 删 `.min(1)`（passed 可空数组） |
| B2 | `tool/goal-report.ts:35` 同 `files_changed.min(1)` | 同上 | 同上 |
| B3 | `build/agent.ts:416-422` mergedHead 守门 | passed 必须 mergedHead 真才接受 | 删整个分支，schema 校验通过即写 collector |
| B4 | `build/agent.ts:423-442` `fileChangeExplanationCoverageError` 调用 in execute | 自动审计 reported vs git diff | 删 |
| B5 | `build/agent.ts:601` `shouldExposeOnlyTerminalTool: () => Boolean(mergedHead)` | mergedHead 后强制只剩 terminal tool | 改为永远 false（不强制 terminal-tool scoping） |
| B6 | `build/agent.ts:652-667` 后置 `fileChangeExplanationCoverageError` | 双源审计，强转 failed | 删（B4 已删 in-tool；后置也删，rule 8 单源） |
| B7 | `build/agent.ts:760-788` 后置 `!mergedHead && passed → failed` 强转 guard | 把 LLM 报的 passed 改 failed | 删；不强转，LLM 报什么就什么。merge_back 状态作为消息附在 build tool return 里 |
| B8 | `build/agent.ts:721-745` `BuildAgentContractError(merge_back_blocked)` | 抛错强迫 orchestrator 走 retry | 改：保留 `missing_terminal_report`（agent 没调 terminal tool 必须抛错，否则消息没传出来），但 `merge_back_blocked` 不再强抛 — 让 LLM 自报 status='failed' 即可 |
| B9 | `build/agent.ts:559, 674-684, 697-699` `preserveWorktreeForRetry` 路径 | mergedHead/blockedBeforeMerge 决定保留 worktree | 简化：`ownsWorktree && worktreeDir` 时永远保留（spec 已有原则 "orchestrator owns cleanup"） |
| B10 | `build/agent.ts:603-606` `recovery: { maxTurns: 3, buildTerminalReportRecoveryPrompt }` | 3 轮自动 recovery prompt | 保留（这是 missing_terminal_report 的最后兜底，确实是消息传输保障，不是流程控制） |
| B11 | `integrity/agent.ts:357-365` `IntegrityResult.verdict` 重整 | 三层 if 改 LLM 提交的 verdict | 删整段，直接采纳 LLM 提交的 verdict |
| B12 | `orchestrator/tools.ts:852-870` `postBuildReviewReworkGoalIDs` + `fallbackGoalID` | 路由硬决策 + fallback to attached | 整个函数删 |
| B13 | `orchestrator/tools.ts:872-901` `dependentGoalClosure` | 依赖图自动展开 | 整个函数删 |
| B14 | `orchestrator/tools.ts:903-955` `openArchitectureReviewRework` | 自动 supersede + startNewAttempt | 整个函数删 |
| B15 | `orchestrator/tools.ts:4875-4892` post-build review 触发链 | 调 B12+B14 | 删整个 if 块（review 走完就把详情拼到 architectureReviewLine 完事，不自动 supersede） |
| B16 | `orchestrator/tools.ts:4843-4846, 4936-4942` `architectureReviewAllowsDeliver` / `architectureReviewNeedsRework` | 状态机 boolean 决定 NEXT 提示 | 删；NEXT 提示统一为 "Review 详情已附在上方，自行决定 modify_goal / build({goalID}) / architect / deliver / fail_task" |

### C. 下游 gate 同步松绑（rule 8 双源治理）

| # | 文件:行 | 现状 | 改为 |
|---|---|---|---|
| C1 | `delivery/checks/project-gate.ts:351-369` `corrections_count > 0 || missing_count > 0` 阻塞 delivery | count 二次决策 | 改：完整 review 文本作为 evidence 一行，但不再当 blocker；delivery LLM 自己判 |
| C2 | `engine/workflow.ts:377-379` `correctionsCount > 0 || missingCount > 0` → "failed" | 同上 | 删此映射；workflow status 只看 verdict / 无 LLM 二次决策 |

### D. supersede reason enum 清理

`startNewAttempt({ reason: ... })` 当前接受任意 string，包括：
- `architecture_review_rework`（B14 删后无人调用）
- `architecture_review_dependency_rework`（同）
- `delivery_rework`（保留 — 是用户手动触发 retry 用的）
- `manual_retry` / `restart_stage` / `modify_contract` / `build_retry`（保留）

不动 enum，只是死代码不再产生 `architecture_review_rework` 这两条。历史 artifact 仍可显示。

### E. 测试调整

| # | 文件 | 改动 |
|---|---|---|
| E1 | `test/build-agent/types.test.ts:103-110` `passed + files_changed=[] → reject` | 改为 → accept |
| E2 | `test/build-agent/file-change-coverage.test.ts` | 整个文件删（函数已删） |
| E3 | `test/build-agent/contract-error.test.ts` 中 `merge_back_blocked` 路径 | 改为只测 `missing_terminal_report`（B8） |
| E4 | `test/integrity/agent.test.ts:104+` `correction-bearing concerns 升级 needs_correction` | 改：`concerns + corrections=N` 维持 verdict=concerns（B11） |
| E5 | 新增 `test/build-agent/types.test.ts` `passed + files_changed=[]` 接受测试 |
| E6 | 新增 `test/orchestrator/integrity-outcome-completeness.test.ts` 验证 IntegrityReviewOutcome 含 corrections/missingGoals 详情（A1） |

## 风险与对策

1. **agent 报 passed 但实际没 merge_back** ─ 删 B3/B7 后理论可能。对策：build tool return 把 mergedHead / mergeBackOutcome 作为消息附上。orchestrator LLM 看到 "agent reported passed but mergedHead=null, last merge_back outcome=conflict on X" 自己判断是否要 retry。
2. **agent 报 files_changed 与实际 diff 不符** ─ 删 B4/B6 后理论可能。对策：build tool return 同时附 actual git diff summary（baseRef..HEAD）。orchestrator LLM 自己判断是不是撒谎。
3. **删 openArchitectureReviewRework 后整套 review_rework 消失** ─ orchestrator 必须自己读 review 详情决定调哪个工具。orchestrator-core.txt:259-263 阶梯指引足够，无需新加 prompt 文字。

## 不在范围

- Windows worktree EACCES 锁问题（已知预存 issue，独立修）
- delivery 阶段的 visual diff / runtime capture（无关）
- architect 自身的 fidelity 验证（独立）

## 实施步骤

1. 落 spec（本文件）+ codex review（本步）
2. A1+A2 先做（让消息完整化），不破坏既有行为
3. B11+B12+B13+B14+B15 删自动 supersede 链
4. B1+B2+B3+B4+B5+B6+B7+B8 + 测试调整
5. C1+C2 下游 gate 松绑
6. typecheck + 相关测试 + 跑 ai-chat benchmark 验证
7. commit + push

## codex 审查反馈（2026-05-06，rule 35 显式标注）

codex 对原方案做了对抗性 review，给出 6 BLOCKING + 2 SHOULD-FIX + 1 NIT。下列修订全部
合入主清单：

### BLOCKING 1 — B10 删除（不再保留 3-turn recovery）

原计划 "B10 保留 maxTurns: 3 recovery 作为消息传输保障" 实际是 rule 7 隐式 fallback +
rule 13 硬编码流程。修订：

- **B10（修订）**：删 `recovery: { maxTurns: 3, buildTerminalReportRecoveryPrompt }`
  (`build/agent.ts:602-606`)。同步删 `buildTerminalReportRecoveryPrompt` 函数本体（行号查
  本仓代码）。
- `missing_terminal_report` 直接作为显式失败消息回传 orchestrator；orchestrator LLM 决定
  是否再开 build。

### BLOCKING 2 — commit_ref 必须只表示已发布 primary HEAD

原计划没说 `commit_ref` 在删 mergedHead 守门后该如何取值。修订：

- **B19（新增）**：`build/agent.ts:444` 的回退 `result.commit_ref ?? ""` 删除。managed
  worktree 模式下未 mergedHead 时 `commit_ref` 强制为空字符串，避免下游把 worktree tip
  当 published commit。
- **B20（新增）**：`BuildAgent.RunOutput`（`build/agent.ts:192-210`、`:800-806`）扩展为同时
  暴露：
  - `published_commit_ref?: string`（mergedHead 才填）
  - `worktree_head: string`（git rev-parse HEAD）
  - `merge_back_status: "merged" | "conflict" | "blocked" | "infra_error" | "not_invoked"`
  - `last_merge_back_outcome?: string`（来自现 `lastMergeBackOutcome` 局部变量）
  - `dirty_paths_after_merge?: string[]`
  - `actual_changed_files: Array<{path, status, additions, deletions}>`（contribution-base 算出的真实 diff，不是 baseRef..HEAD；用现有 `resolveGoalContributionBaseRef` 处理 merge commit 的二亲 join）
- **B21（新增）**：build tool return 的 markdown 把 B20 全部字段渲染成事实块，与 LLM 自报
  的 `files_changed[]` 并列。orchestrator LLM 自行 cross-check。

### BLOCKING 3 — 风险 1/2 的对策实化

风险 1（agent 报 passed 但没 merge）+ 风险 2（agent 报 files_changed 与实际 diff 不符）的
对策原文模糊。**B20+B21 已实化此对策**。删除 spec "风险与对策" 段中的"对策"两段，改成
指向 B20+B21。

### BLOCKING 4 — IntegrityReview 持久化完整文本

原 A1/A2 只覆盖本轮 build tool return；context 压缩 / 后续 wake / delivery agent /
read_context 仍只看 count。修订：

- **A4（新增）**：`recordIntegrityAttempt`（`engine/persist.ts:1752-1783`）payload 扩展，新增字段
  `review_markdown: string`、`corrections: GoalCorrection[]`、`missing_goals: MissingGoal[]`、
  `dimensions_full: IntegrityDimensionResult[]`。schema 同步更新。
- **A5（新增）**：`read_context` 的 Integrity section（`orchestrator/tools.ts:2676-2681`）
  渲染完整 review_markdown 而不仅 count。
- **A6（新增）**：delivery `upstream_context` 同样渲染完整 review_markdown（找 delivery agent
  组装 context 的位置后落实）。
- **A7（新增）**：`IntegrityReviewCompleted` / `IntegrityDimensionEvent` 事件
  （`engine/model.ts:1180-1186`）payload 增加完整文本字段，overlay 也能看见。

### BLOCKING 5 — prompt / workflow 文案同步松绑

删除自动 route/rework 后，三处 prompt/desc/hint 仍声称"系统自动 route"会误导 LLM。修订：

- **B17（新增）**：同步改：
  - `prompt/core/orchestrator-core.txt:203-207`、`:371-374`：删除 "post-build
    architecture_review routes feedback to the affected goal IDs" 类语句；改成"review 只
    记录并返回事实；不会自动 supersede/startNewAttempt；下一步由 orchestrator LLM 自行
    选择 modify_goal / build / architect / deliver / fail_task"。
  - `orchestrator/tools.ts:2077-2079` integrity tool description 同步改文案。
  - `engine/workflow.ts:221-237` workflow hint 同步改。
- 全仓 grep "routes findings" / "automatic .* rework" / "自动开" 等关键词扫一遍补完。

### BLOCKING 6 — delivery 阶段 integrity 转 evidence-only

原 C1 只去 count blocker 不够，下面四道 hard gate 仍会让 delivery LLM 无能为力：

- `delivery/checks/project-gate.ts:353-357` 把 `needs_correction/fail/unknown` 当 failed
  review
- `:128-136` failed review 进 `failedReviewIds`
- `:225-239` functional-completion 把 `review:integrity` 当 primary blocker
- `delivery/output-tools.ts:106-115` host gate failed 时禁 accepted
- `delivery/arbiter.ts:99-114` arbiter 把 accepted 强转 rejected

修订（**采用方案 A：integrity 在 delivery 中完全 evidence-only**）：

- **C3（新增）**：`buildReviewEvidence` 对 integrity 不再产出 `status: "failed"` —— 改为只
  把完整 review markdown 放 evidence、status="advisory"。
- **C4（新增）**：`delivery/output-tools.ts:106-115` 删除 "host gate failed 时禁 accepted"
  当中关于 integrity 的分支。其他 gate（如 visual / runtime）保留。
- **C5（新增）**：`delivery/arbiter.ts:99-114` 同步：integrity 不再触发 accepted→rejected
  强转。
- 上述合在一起：integrity 在 delivery 阶段完全是 evidence，delivery LLM 看完决定。

### SHOULD-FIX 1 — external executor 伪证据 placeholder 删除

- **B18（新增）**：删除 `__external_executor_missing_file_report__` 占位（`build/agent.ts:1542-1546`、`:1692-1696`）。external executor 无结构化报告时：
  - 要么 `files_changed: []`（B1 后合法）+ 附 host diff 事实
  - 要么 status="failed" with error="external executor missing structured build report"
  不要伪造文件项。

### SHOULD-FIX 2 — 测试计划补负向断言

- **E7（新增）**：测试 post-build non-pass review **不**调用 `startNewAttempt`、**不**
  supersede、tool result 含完整 review markdown、Next step 只要求 LLM 自行选择。
- **E8（新增）**：删除/改写 `test/orchestrator/tools.test.ts:921, :1018, :1323` 中针对
  `architecture_review_rework` / `architecture_review_dependency_rework` 的正向断言。

### NIT — 合并 E1 / E5

- E1 已覆盖 "passed + files_changed=[] → accept"，删 E5 重复项。

## 修订后实施步骤

1. 落 spec（本文件）+ codex review + 反馈合入（**已完成**）
2. **A1+A2+A4+A5+A6+A7** 先做（消息完整化 + 持久化 + 跨 stage 可读）
3. **B17** 同步 prompt/workflow 文案（让 LLM 知道不再自动 route）
4. **B11+B12+B13+B14+B15+B16** 删自动 supersede 链
5. **B20+B21** 扩 BuildAgent RunOutput + tool return 渲染 merge/diff 事实
6. **B1+B2+B3+B4+B5+B6+B7+B8+B9+B19** 拆 build/agent 守门链 + commit_ref 收紧
7. **B10** 删 recovery
8. **B18** 删 external executor 伪证据
9. **C3+C4+C5** delivery integrity evidence-only
10. **C2** workflow status 映射删 count 二次决策
11. 测试调整 E1-E8
12. typecheck + 相关测试 + 跑 ai-chat benchmark 验证
13. commit + push

## 风险与对策（修订）

风险 1/2 已被 B20+B21 的事实传输项替代。剩余风险：

- **风险 3**：delivery integrity evidence-only 后，delivery LLM 可能看不出 "review
  反对此次交付" 是 blocker 还是 advisory。对策：A6 把完整 review markdown（含 issues/
  corrections/missingGoals）作为 evidence 注入，delivery prompt 已有 "weight evidence
  before accept" 阶梯指引，无需新加 prompt。

## 不在范围

- Windows worktree EACCES 锁问题（已知预存 issue，独立修）
- delivery 阶段的 visual diff / runtime capture（无关）
- architect 自身的 fidelity 验证（独立）
