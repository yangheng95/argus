# Deliver 功能完成度优先重构方案

日期：2026-05-02

## 背景

本轮复核任务 `tsk_de3db7236001q3ZD0IlgOUxYxg` 时，真实数据库显示 13 轮
`delivery_evidence_manifest` 和 13 轮 verdict 连续拒绝。前 12 轮 summary 都是：

`Delivery evidence gate failed 3 required check(s), 0 coverage item(s), 1 runtime flow(s), and 4 review item(s).`

但 verdict 只保留 3 条 `rejection_details`，`affected_goals=0`。最后一轮实际
report 指向功能性失败：

- 没有可运行前端构建产物或 `start|preview|server` 脚本。
- runtime flow `runtime:web:.` 失败。
- client/frontend/visual specialist review 失败。

这说明当前 delivery 的沟通顺序和迭代策略不健康：辅助工程指标常常占据 summary
和 rejection details，真正的用户功能完成度被埋在 manifest side-channel 里。

## 目标

Delivery 的最终判断仍必须有证据硬门，但评分和反馈顺序必须以功能完成度为主：

1. **Primary：功能完成度**
   - 用户请求中的核心功能是否能在集成后的 deliverable 中真实运行。
   - blocking goal / requirement 是否被真实证据覆盖。
   - runtime flow 是否能启动、渲染、交互。
   - specialist review 中与功能、runtime、client contract、visual runtime 相关的 blocking finding。

2. **Auxiliary：辅助质量指标**
   - build/test/lint/typecheck 等项目检查。
   - test quality、security、style、lint 等支撑性质量信号。
   - 这些仍可阻止发布，但不能作为唯一沟通主体遮蔽功能失败。

3. **Iteration：拒绝后重试**
   - task-scope 功能失败必须形成 task-level rework request，而不是空转 `deliver`。
   - goal-scope 功能失败只重开真实归属 goal。
   - 辅助指标失败作为修复约束附带给 rework，不再抢占主原因。

## 设计

### DeliveryManifestFunctionalAssessment

在 `DeliveryEvidenceManifest` 增加单源功能评估片段：

```ts
type DeliveryManifestFunctionalAssessment = {
  status: "complete" | "incomplete"
  primaryFailureIds: string[]
  auxiliaryFailureIds: string[]
  summary: string
}
```

该片段由 manifest 自身派生，不引入第二个 verdict。

归类规则：

- coverage failure 总是 primary。
- runtime flow failure 总是 primary。
- specialist review 若 blocking finding 属于 `runtime`、`functional`、`client_contract`、
  `api_contract`、`visual`、`evidence_quality`，归 primary。
- required check failure 默认 auxiliary；但如果 failure 直接导致 runtime 无法评估，
  仍保留为 auxiliary prerequisite，不改写成“功能完成”。

### Final Gate Summary

`finalGate.summary` 改为功能优先：

- primary 失败存在：
  `Functional completion failed: ... Auxiliary blockers: ...`
- primary 失败不存在但辅助失败存在：
  `Functional completion passed, but auxiliary quality gates failed: ...`
- 全部通过：
  `Functional completion passed and auxiliary quality gates passed.`

### Verdict Details

`synthesizeManifestRejection()` 必须输出所有失败详情，并按 primary before auxiliary
排序。禁止 first-non-empty 截断。

### Rework Routing

若 rejected verdict 没有 affected goal：

- 不得 dispatch 空的 `delivery_rework` 循环。
- deliver result 必须明确要求 orchestrator 走 task-level `build({ request })`，
  并带上 manifest failure details。
- 只有存在真实 goal_id 的 rejection 才允许 `startNewAttempt()`.

## 验收

- 同时存在 check/runtime/review failure 时，verdict details 包含全部失败家族。
- finalGate summary 以 functional completion 开头。
- task-scope rejection 不再触发空 `delivery_rework` 自旋。
- latest deepseek report 中的 `no_build_artifact` / runtime / client contract 失败
  在 deliver result 中作为主要问题出现。
- `bun test packages/opencorvus/test/delivery/arbiter.test.ts packages/opencorvus/test/delivery/project-gate.test.ts`
  通过。

