# Delivery 拒绝归因修复（实施版）

**日期**：2026-05-02
**触发**：r29 benchmark 出现 deliver 连续两轮逐字段相同拒绝；11/11 goal 全 `passed`，delivery 失败但 `rejection_details[].goal_id` 全空，导致 orchestrator 无法打开任何 goal rework。

## 1. 根因

当前 manifest gate failed 时，`DeliveryService.verify` 跳过 DeliveryAgent，由 `arbitrateDeliveryVerdict` 调用 `synthesizeManifestRejection` 生成 rejected verdict。这个路径有两个结构性问题：

- `rejection_details` 由代码合成，不是 delivery agent 基于真实上下文判断。
- 归因函数 `ownerGoalIdsForFailure` 必然滑向前缀判断、特殊分支和 fallback 阶梯。
- build/test/runtime 失败经常需要读 diff、`owned_paths`、executor `files_changed` 才能归因，纯代码无法可靠判断。

因此根因不是某个归因函数写得不够聪明，而是 manifest failed 时绕开了 DeliveryAgent。

## 2. 修复原则

本次只修 manifest gate failed 的归因路径：

- manifest gate 仍是硬门。
- DeliveryAgent 在 manifest failed 时仍然运行。
- `submit_verdict` 在 manifest failed 时拒绝 `accepted` payload，要求 agent 提交 rejected verdict。
- `goal_id` 只在责任 goal 可识别时填写；项目级 failure 保持 task-scope，不强迫瞎归因。
- arbiter 删除 manifest 合成 verdict 和 owner 归因函数。没有合法 LLM rejected verdict 时 fail loud，不制造替代 verdict。

runtime evidence gate 和 visual metric gate 仍保留现有 arbiter 逻辑；它们是后续单独清理面，本次不声称完成全 delivery 单源化。

## 3. 实施内容

1. `packages/opencorvus/src/delivery/checks/types.ts`
   - `DeliveryInfo` 增加 `manifestGate` 和 `manifestFailureDetails`，承载结构化 gate 状态和失败证据。

2. `packages/opencorvus/src/delivery/service.ts`
   - 删除 manifest failed 时跳过 DeliveryAgent 的分支。
   - 始终调用 `DeliveryAgent.verify`。
   - 把 `manifest.finalGate`、结构化 failure details、兼容字符串 failure summary 一起传入 delivery prompt。

3. `packages/opencorvus/src/delivery/agent.ts`
   - prompt 渲染 `DeliveryEvidenceManifest Gate`，包含 `finalGate.status`、失败 ID 列表和失败详情。
   - 明确 manifest failed 时必须 reject；`goal_id` 只在可归因时填写。
   - output tool kit 接收 `manifestGate`。

4. `packages/opencorvus/src/delivery/output-tools.ts`
   - 当 `manifestGate.status === "failed"` 时，`submit_verdict` 拒绝 `accepted`，要求重新提交 rejected verdict。

5. `packages/opencorvus/src/delivery/arbiter.ts`
   - 删除 `synthesizeManifestRejection`。
   - 删除 `ownerGoalIdsForFailure`。
   - manifest failed 时只接受 LLM rejected verdict，并追加 manifest evidence 到 `deferred_checks` 供审计。
   - manifest failed 且没有 LLM rejected verdict 时返回 `undefined`，由 service 抛错。

## 4. 边界行为

| 场景 | 行为 |
|---|---|
| manifest failed，Agent 提交 rejected 且含 `goal_id` | 原样保留归因，orchestrator 打开对应 goal rework |
| manifest failed，Agent 提交 rejected 但无 `goal_id` | 按 task-scope rejection 处理，不 blanket reset |
| manifest failed，Agent 尝试 accepted | `submit_verdict` 拒绝；若绕过 tool 进入 arbiter，则 arbiter fail loud |
| Agent 调用失败 / 超时 | `DeliveryFailureError` 抛上游 |
| 直流 task 无 goals | task-scope rejection 是合法语义 |

## 5. 测试

- `delivery/output-tools.test.ts`：manifest failed 时 accepted payload 被拒绝。
- `delivery/agent.test.ts`：DeliveryAgent prompt 包含 `finalGate.status=failed`、failed IDs、`owned_paths`、executor `files_changed`，并把 manifest gate 传给 output tool。
- `delivery/service.test.ts`：manifest failed 时仍调用 DeliveryAgent，并把 agent 返回的 `goal_id` 归因保留到最终 verdict。
- `delivery/arbiter.test.ts`：manifest failed 不再合成归因；只保留 agent rejection，并追加 manifest evidence。

## 6. 验证命令

定向运行：

```bash
bun test packages/opencorvus/test/delivery/output-tools.test.ts packages/opencorvus/test/delivery/agent.test.ts packages/opencorvus/test/delivery/service.test.ts packages/opencorvus/test/delivery/arbiter.test.ts
```

提交前仍需通过项目 hook；失败时修根因，不绕 hook。
