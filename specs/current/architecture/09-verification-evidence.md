# 09 — Verification Evidence

> 对应代码：`packages/opencorvus/src/verification/persist.ts` ·
> `packages/opencorvus/src/verification/query.ts` ·
> `packages/opencorvus/src/engine/engine.sql.ts` ·
> `packages/opencorvus/src/acceptance/checks/` ·
> `packages/opencorvus/src/acceptance/arbiter.ts` ·
> `packages/opencorvus/src/orchestrator/tools.ts`

Verification Evidence 是验收与 goal-run 机械检查的结构化证据层。当前实现的存储真源是
`engine_artifact` 中 `kind="verification-evidence"` 的 artifact row；查询、渲染和
acceptance 决策只从这条 artifact-centric 路径读取。

## 当前真源

| 代码                      | 职责                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `verification/persist.ts` | 写入与查找 verification evidence：`persistEvidence`、`findLatestGoalRunEvidence`、`findGoalRunEvidence`、`findLatestAcceptanceEvidence` |
| `verification/query.ts`   | 只读查询与人类可读渲染：`queryEvidence`、`renderEvidence`                                                                               |
| `engine/engine.sql.ts`    | `EngineArtifactTable` 与 `EngineArtifactKind`；artifact kind 枚举只以代码为准                                                           |
| `acceptance/checks/**`    | deterministic checks、runtime readiness、walkthrough、project evidence manifest                                                         |
| `acceptance/arbiter.ts`   | functional acceptance arbitration; it reports evidence verdicts and is not the workflow acceptance authority                            |
| `orchestrator/tools.ts`   | 消费 evidence 摘要、decision-log 记录和最终 workflow 投影                                                                               |

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
| `acceptance` | 合并交付面的 acceptance checks 与 arbiter 结论。`findLatestAcceptanceEvidence` 给最终验收、integrity 复核和 orchestrator 摘要使用。                               |

`browser_preview_evidence` 是独立 artifact kind，用于浏览器预览、截图、reference comparison 等视觉证据。
Visual QA 或 acceptance 报告可以引用这些 artifact；它们不自动等同于
`verification-evidence`，除非调用方显式把结果写成 verification evidence payload。

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
- aggregate UI view 只能是 evidence / artifact 的投影，不能成为第二个验收真源。
- 视觉证据引用必须指向可读 artifact；无法读取或未通过的引用不能被当作 formal evidence。
- 新增 check family 时，先扩展 check 生产者和 artifact payload，再更新查询/渲染测试。

## 验证

- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- 与 evidence 行为相关的改动还必须覆盖 `packages/opencorvus/test/visual-qa/output-tools.test.ts` 和
  `packages/opencorvus/test/engine/workflow-integrity-step.test.ts`。
