# 09 — Verification Evidence

> 对应代码：`packages/opencorvus/src/verification/persist.ts` ·
> `packages/opencorvus/src/verification/query.ts` ·
> `packages/opencorvus/src/engine/engine.sql.ts` ·
> `packages/opencorvus/src/acceptance/visual-feedback-verification.ts` ·
> `packages/opencorvus/src/acceptance/checks/` ·
> `packages/opencorvus/src/acceptance/arbiter.ts` ·
> `packages/opencorvus/src/orchestrator/tools.ts`

Verification Evidence 是验收与 goal-run 机械检查的结构化证据层。当前实现的存储真源是
`engine_artifact` 中 `kind="verification-evidence"` 的 artifact row；查询、渲染和
Orchestrator lifecycle 决策只从这条 artifact-centric 路径读取证据摘要；该层本身不拥有 workflow acceptance authority。

## 当前真源

| 代码                      | 职责                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `verification/persist.ts` | 写入与查找 verification evidence：`persistEvidence`、`findLatestGoalRunEvidence`、`findGoalRunEvidence`、`findLatestAcceptanceEvidence` |
| `verification/query.ts`   | 只读查询与人类可读渲染：`queryEvidence`、`renderEvidence`                                                                               |
| `engine/engine.sql.ts`    | `EngineArtifactTable` 与 `EngineArtifactKind`；artifact kind 枚举只以代码为准                                                           |
| `acceptance/visual-feedback-verification.ts` | 写入和校验 `label="visual-feedback-verification"` 的 visual acceptance artifact；它绑定 task / run / preview target 和 Browser Preview visual evidence refs |
| `acceptance/checks/**`    | deterministic checks、runtime readiness、walkthrough、project evidence manifest                                                         |
| `acceptance/arbiter.ts`   | functional acceptance arbitration; it reports evidence verdicts and is not the workflow acceptance authority                            |
| `orchestrator/tools.ts`   | 消费 evidence 摘要、decision-log 记录和 workflow 投影，用 `complete_task` / `fail_task` 写入最终 lifecycle 决策                         |

## 存储契约

- `engine_artifact` 是 verification evidence 的唯一持久化表。
- `kind="verification-evidence"` 标识 evidence artifact；`label` 使用 scope 语义，例如
  `evidence-goal_run` 或 `evidence-acceptance`。
- payload 保存 scope、status、verdict、checks、summary、signature、time_completed，以及
  goal/run/acceptance 关联所需的显式字段。
- `EngineArtifactKind` 是 artifact kind 的唯一枚举真源，文档不复制完整枚举。
- 已删除的历史 evaluation 表不是当前架构的一部分；当前文档不得用历史表名或历史 phase 计划
  描述运行时合同。

## Scope

| Scope        | 写入与读取语义                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal_run`   | 某个 goal run 的 on-goal checks。`persistEvidence` 写入后，`findLatestGoalRunEvidence` / `findGoalRunEvidence` 为 retry feedback 与工作流投影提供结构化失败原因。 |
| `acceptance` | 合并交付面的 acceptance checks 与 arbiter 结论。`findLatestAcceptanceEvidence` 给 Orchestrator lifecycle 决策、integrity 复核和摘要使用。                         |

`browser_preview_evidence` 是独立 artifact kind，用于浏览器预览、截图、reference comparison 等视觉证据。
Visual QA 或 acceptance 报告可以引用这些 artifact；它们不自动等同于
`verification-evidence`，除非调用方显式把结果写成 verification evidence payload。

## Visual Feedback Verification

Reference-driven visual acceptance 消费的当前 rendered feedback 真源是
`kind="verification-evidence"` 且 `label="visual-feedback-verification"` 的
artifact。该 artifact 由 Visual QA / Orchestrator 从当前 rendered preview
feedback 生成，payload 使用 `scope="visual_feedback"`，并记录 `taskID`、
`runID`、可选 `goalRunID` / `acceptanceID`、`previewTargetID`、required
reference regions、Browser Preview `reference-comparison` evidence refs 和生产阻塞列表。

`visual-feedback-verification` 是视觉裁决投影；它引用的图片 truth 仍然是
task-scoped `browser_preview_evidence` artifact。校验必须证明这些 visual
evidence refs 可读、属于同一 task/run/preview target、operationKind 是
`reference-comparison`、状态为 passed、包含 source / target crop 与视觉指标，
且 target crop 不是 blank 或 monochrome。缺失这些条件时，metrics / acceptance
不能把它当作通过。

`VisualEvidenceBundle`、source manifest、`web-clone-source`、`webpage-evidence`
和 Build resource-consumption report 都不是 final visual acceptance authority。
它们只能作为 Build input 或实现审查上下文。Integrity 只能读取经过裁剪的 Visual
QA implementation-defect context 帮助定位实现缺陷，不能读取 Visual QA visual verdict、
reference-comparison authority、`visual-feedback-verification` 指针，不能验证或重判
`visual-feedback-verification`，也不能接收 Visual QA report summary 这类自由文本
verdict。Integrity handoff 只保留 changed files、缺陷计数、code module problem 和
DOM locator / bbox / style / code-search 等实现定位字段；最终视觉 verdict 由 Visual QA /
visual-feedback verification 和 metrics acceptance 消费链路负责。

Visual QA tool result 同步暴露当前 rendered visual feedback verification 的事实投影：
`visual_feedback_verification_status` 和
`visual_feedback_verification_failed_attempts`。Orchestrator prompt 消费这些事实：
首次失败表示应把当前 comparison / annotation / diagnostic 反馈交回 Build；同一 task
连续第二次失败表示当前视觉目标未达成，应 `fail_task`，不能把该 verdict 交给
Integrity 重判或让 Build 盲修。失败次数字段是 decision-log / verification artifact
的事实投影，不是新的 host gate 或 Integrity verdict。

Workflow / UI 投影也必须遵守同一边界：普通 Visual QA report 可以投影普通前端
QA 审查状态；一旦 report 声明 `reference_parity.required=true` 或包含
`reference_comparison_evidence_refs`，投影只能从同阶段持久化的
`visual-feedback-verification` artifact 得出 completed / failed。Visual QA prose、
`latest_summary`、截图路径字符串或 source package 状态不能把 reference parity
投影为 completed。

## 查询契约

`verification/query.ts` 是只读入口：

- `queryEvidence({ scope, goalID, taskID })` 返回匹配的最新 evidence。
- `renderEvidence(evidence)` 生成 prompt / log 可读摘要。
- 查询层不执行 checks、不补写 artifact、不读取历史表。

## Acceptance 使用

1. deterministic checks 在 `acceptance/checks/**` 里生成结构化 check 结果。
2. `acceptance/arbiter.ts` 根据 functional arbitration 规则给出 accepted / rejected / inconclusive 结论。
3. `verification/persist.ts` 把 scope 内的结果写为 verification evidence artifact。
4. `orchestrator/tools.ts` 和 workflow 投影消费 evidence 摘要，而不是重新解释历史实现计划。

## 不变量

- 同一条 evidence 的 verdict、checks、signature 必须来自同一个 payload。
- aggregate UI view 只能是 evidence / artifact 的投影，不能成为第二个验收或 lifecycle 真源。
- 视觉证据引用必须指向可读 artifact；无法读取或未通过的引用不能被当作 formal evidence。
- 新增 check family 时，先扩展 check 生产者和 artifact payload，再更新查询/渲染测试。

## 验证

- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- 与 evidence 行为相关的改动还必须覆盖 `packages/opencorvus/test/visual-qa/output-tools.test.ts` 和
  `packages/opencorvus/test/engine/workflow-integrity-step.test.ts`。
