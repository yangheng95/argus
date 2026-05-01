# Deliver 单处理大脑与单出口修复方案

日期：2026-05-01

## 目标

Deliver 允许内部多阶段执行：项目检查、runtime 证据、specialist review、LLM 语义裁决、publish gate。
但对 orchestrator、board、overlay、publisher 暴露时，只能表现为一个处理大脑和一个出口：

- 入口：`DeliveryService.verify()` 是唯一 delivery brain。
- 出口：`DeliveryEvidenceManifest` 是唯一事实出口。
- 状态变更：goal retry 只能从 manifest 中真实归因的 goal-scope finding 派生。
- UI 展示：delivery 卡片只从 manifest projection 展示阶段活动。

## 当前根因

当前 delivery 存在多源：

- `delivery` artifact 表示 candidate / publish lifecycle。
- `delivery-agent-verdict` artifact 表示 semantic verdict。
- `verification-evidence` artifact 再投影一份 checks。
- `delivery_evidence_manifest` 表示 deterministic gate。
- `delivery_specialist_review` 和 `delivery_surface_manifest` 又额外写独立 artifact。

这些源字段重叠、读路径分散。`arbiter` 为了满足 `rejection_details[].goal_id` 必填，在无法真实归因时退回所有 goal，导致项目级 build/test/lint failure 被复制成每个 goal 的 failure。Orchestrator 再从 `affectedGoalIDs(verdict)` 派生 reset 集合，于是所有 goal 都被 `startNewAttempt()` 重置。

## 第一阶段修复

本阶段直接切断全量 reset 和不可见 delivery 活动：

1. `RejectionDetail.goal_id` 改为可选，允许 task-scope rejection。
2. `affectedGoalIDs()` 只返回真实存在的 `goal_id`，不把 task-scope failure 转成所有 goal。
3. `arbiter` 中任何无法真实归因的 failure 都生成 task-scope rejection，不再 fan-out。
4. render prerequisite、runtime gate、visual hard gate 也不能复制到所有 goal。
5. orchestrator rejected path 对 task-scope rejection 只记录并唤醒 orchestrator，不调用 `startNewAttempt()`。
6. board 的 delivery projection 从 manifest 输出 required checks、check results、runtime flows、reviews、task-scope rejection 摘要。
7. overlay 的 DeliveryPanel 渲染 manifest 阶段列表，不只显示 summary 和 changed files。

## 后续收敛

第一阶段完成后，继续删除重复 artifact 写入：

- `delivery-agent-verdict` 只保留 manifest 内 semantic verdict 后删除 artifact label。
- `verification-evidence` 的 delivery-scope checks 从 manifest 投影，不再写重复 payload。
- `delivery_specialist_review` 不再独立持久化，只作为 manifest slice。
- `delivery_surface_manifest` 不再独立持久化，只作为 manifest slice。

## 验收

- 项目级 build/test/lint/runtime/render failure 不 reset 任何 goal。
- 有明确 `goal_id` 的 specialist/LLM rejection 只 reset 对应 goal。
- `affectedGoalIDs()` 忽略 task-scope rejection。
- board payload 能展示 manifest 的 checks / runtime flows / reviews。
- overlay delivery card 展示 manifest 阶段活动。
