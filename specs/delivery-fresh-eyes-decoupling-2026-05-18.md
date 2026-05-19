# DeliveryAgent Fresh-Eyes 解耦方案

- 日期：2026-05-18
- 状态：已被 `delivery-host-gate-deblocking-2026-05-19.md` 修订；其中 host_gate 终局拒绝设计废止
- 分支：codex/agent-boundary-role-contract
- 关联规则：rule 5/6/6.1（禁过度工程、信任 LLM、prompt-over-host）、rule 8（禁双源）、rule 13（禁状态机）、rule 15（禁合成/代写消息）、rule 32/35（落盘+穷举调用点）、rule 36（配测试）

## 0. 问题陈述

DeliveryAgent 的产品本意：成熟项目的**轻量、独立 fresh-eyes 复核者 + 窄范围 final repairer**，从自身角度独立挖被上游遗漏/糊弄的问题，刻意不被上游预计算结论锚定。

实测被实现成"复读机"。三 agent + codex 两轮共识根因：**DeliveryAgent 角色被混成三件互相打架的事**——(1) fresh-eyes 语义复核者；(2) 主机确定性门归因路由器；(3) narrow repairer。第 (2) 个职责通过两条路径污染第 (1) 个：

- **prompt 注入结论**：`service.ts:244` 调 `DeliveryAgent.verify` 前先跑完 manifest/runtime/visual 三道确定性门，把全部 failure 结论塞进开场 prompt（`agent.ts:356-440`），并用 `You must submit verdict='rejected'`、`reject ... unless you can prove the probe is invalid` 这类**倒置举证责任**的祈使句 + `delivery-core.txt:96-98/224-255` 的 `aligning your verdict with the gate keeps the rework signal clean` 显式训练对齐。→ 违反 rule 13（prose 状态机 "gate fail→must reject"）、rule 6/6.1（教答案而非教方法）。
- **arbiter 代写 verdict**：`arbiter.ts:99-131` 在 host blocker 存在且 LLM accept 时**强制改写**为 rejected，并**无条件** `appendHostGateEvidence` 把 manifest/runtime/visual 证据注入最终持久化 verdict（`arbiter.ts:129/176-245`）。最终 artifact 名义单源 `delivery-agent-verdict`，实际被 host 代写。→ 违反 rule 8/15。

确定性硬门本身（编译/测试失败、SSIM 不达标必须阻断）合法且必要，符合 rule 6.1 数据完整性例外。问题不在硬门存在，而在 (a) 把硬门**结论**在 agent 推理前喂它，(b) host 改写 agent 的 verdict 对象。

## 1. 全仓调用点穷举（rule 35）

### 1.1 `arbitrateDeliveryVerdict` / `appendHostGateEvidence` / `appendManifestEvidence`

| 位置 | 角色 | C 处置 |
|---|---|---|
| `src/delivery/arbiter.ts:82` `arbitrateDeliveryVerdict` | host 改写+合成 verdict | 重构为无副作用纯投影 `composeDeliveryDecision` |
| `src/delivery/arbiter.ts:133` `appendManifestEvidence` (export) | 向 verdict 注入 manifest 证据 | 删除注入语义；改为构造 host_gate decision packet 的 evidence |
| `src/delivery/arbiter.ts:176` `appendHostGateEvidence` (private) | 串联 manifest+runtime+visual 注入 | 删除（不再向 agent verdict 注入） |
| `src/delivery/arbiter.ts:25` `arbitrateDeliveryGate` | manifest finalGate 仲裁（纯函数） | **保留不变**（已是 host 数据门，rule 6.1 合法） |
| `src/delivery/service.ts:24,297` | 调 `arbitrateDeliveryVerdict` | 改为新流程编排（见 §3） |
| `src/delivery/index.ts:16` | re-export | 同步导出名 |
| `test/delivery/arbiter.test.ts:2,79-494` | 现有 18 处用例 | rule 8 同步重写为新投影语义 |

### 1.2 `delivery-agent-verdict` artifact label + reader（决定 rule 8 单源边界的关键面）

| 位置 | 角色 | C 处置 |
|---|---|---|
| `src/orchestrator/tools.ts:4390` | 持久化 verdict artifact，label=`delivery-agent-verdict`，payload=DeliveryService.verify 返回值 | payload 改为 **final DeliveryDecision**（唯一消费源）；raw agent verdict / host gate result 另起 label 持久化为 evidence artifact |
| `src/engine/store.ts:683` `findLatestDeliveryVerdictArtifact(taskID)` | 读 label=`delivery-agent-verdict` 最新 | 语义保持"latest consumable final delivery verdict"；继续读兼容 label，但其内容为 final decision |
| `src/engine/store.ts:731` `findLatestDeliveryVerdictArtifactForDelivery(deliveryID)` | board 用 | 同上 |
| `src/engine/store.ts:689,739` `orderBy(desc(time_created))` + `.get()` | 排序 | 三 artifact 共存须加 `id`（ascending，单调）做 tiebreak，防同毫秒随机读 |
| `src/engine/workflow.ts:401-409` | "single source of truth verdict" 读 | 读 final decision，语义不变 |
| `src/engine/describe.ts:333` | describe 输出 | 读 final decision |
| `src/orchestrator/tools.ts:685` `composeLatestDeliveryFeedbackForBuild` | retry feedback：仅 `payload.verdict==="rejected"` 触发，从 `rejection_details` 做 goal 路由，按 delivery_id 取 manifest failure details | final decision 在 host gate fail 时须呈 `verdict:"rejected"` + 非空可路由 `rejection_details`（见 §2 边界） |
| `src/orchestrator/tools.ts:5019,5034` | board/delivery 状态 | 读 final decision |
| `src/orchestrator/agent.ts:768-772` | orchestrator prompt 最近 verdict 快照 | 读 final decision |
| `src/orchestrator/tools.ts:4402` `sinkDeliveryVerdictToCriteria` | verdict→criteria_results 扁平化 | 输入改为 final decision；保持三 typed surface 扁平化 |
| `src/workbench/board.ts:566` | board delivery.status | 读 final decision |
| `test/orchestrator/tools.test.ts:3575`、`test/orchestrator/build-feedback-context.test.ts:132-165` | 用例硬编码 label | 同步：断言 final decision 形态 + raw/host evidence 分离 |

### 1.3 `DeliveryService.verify` / `DeliveryAgent.verify` 调用点

| 位置 | 角色 | C 处置 |
|---|---|---|
| `src/orchestrator/tools.ts:4357` 唯一 `DeliveryService.verify` 调用点 | 编排入口 | 返回值类型由 `DeliveryVerdictType` 改为 `DeliveryDecision`；下游 artifact/sink 适配 |
| `src/delivery/service.ts:244` 唯一 `DeliveryAgent.verify` 调用点 | service 内部 | 包进"门 pass 才调"分支；不再注入 manifestGate/hostGateFailures/runtimeEvidenceFailures/visualMetricFailures |
| `src/delivery/agent.ts:88-192` `DeliveryAgent.verify` | agent 本体 | `VerifyInput.delivery` 移除四个 host-failure 字段；`buildUserPrompt` 删四个 failure section |
| `src/delivery/checks/types.ts:102-128` `DeliveryInfo.{manifestGate,hostGateFailures,runtimeEvidenceFailures,visualMetricFailures,manifestFailureDetails,manifestFailures}` | 传输契约 | 从 `DeliveryInfo`（喂 agent 的）移除；这些迁到 host-side decision 构造的内部类型，**不再过 agent** |

## 2. 与 codex 共识的 5 条落盘边界（实施时硬约束）

1. **artifact 单源边界写死**：final `DeliveryDecision` 是 UI / publish / retry / task-completion 的**唯一**业务消费源。raw agent verdict 与 host gate result 仅作 evidence artifact，业务侧任何代码不得直接消费。兼容方式：**final decision 占用现有兼容 label `delivery-agent-verdict`**（所有现有 reader 零改动语义），raw agent verdict 改用新 label `delivery-agent-raw-verdict`，host gate result 用 `delivery-host-gate`。
2. **host_gate_rejected packet 必须命中现有 rejected shape**，使 `findLatestDeliveryVerdictArtifact → composeLatestDeliveryFeedbackForBuild` 链零语义改动：绑 `task_id/run_id/delivery_id`；payload 顶层 `verdict:"rejected"`；非空 `summary`；非空 `rejection_details`；`deferred_checks:[]` 或真实投影；非空 `tool_call_evidence`（至少含 `DeliveryEvidenceManifest`/`runtime_evidence`/`visual_metric` 的 host evidence 行）；`rejection_details[].category` 只用现有 schema 枚举 `build/test/lint/runtime/quality/startup/visual`（**禁 `manifest`**）；能可靠归因才写 `goal_id`，否则 task-scope 并依赖 raw packet + manifest failure details 驱动 task-level rework（`composeLatestDeliveryFeedbackForBuild` 已按 delivery_id 自取 manifest，host packet 不必重复全文）。
3. `composeDeliveryDecision(agentVerdict?, hostGateResult)` 允许 `agentVerdict` 在 host gate fail 时**为空**（门 fail 根本不跑 agent）。
4. 同一 delivery 三 artifact（raw / host / final）共存时，所有查询排序必须 `orderBy(desc(time_created), desc(id))`（`id` 为单调 ascending id），杜绝同毫秒随机读。
5. **C 测试矩阵**（rule 36，全部新增/同步）：
   - manifest gate fail ⇒ 不调用 `DeliveryAgent.verify`（断言自动行为不再发生）
   - host_gate_rejected packet ⇒ `composeLatestDeliveryFeedbackForBuild` 返回非空可路由反馈（goal-scope 与 task-scope 两例）
   - gate pass ⇒ DeliveryAgent prompt **不含** `You must submit verdict='rejected'` / `aligning your verdict with the gate` / `unless you can prove ... invalid` / 四个 host-failure section（用真实 buildUserPrompt 输出断言）
   - raw agent / host gate / final decision 三 artifact label 分离；业务 reader 只命中 final
   - accepted-after-narrow-repair：del 改文件后必须重跑确定性门通过，final 才 accepted；门未重跑 ⇒ 不得 accepted
   - 同毫秒三 artifact ⇒ reader 确定性取 final（id tiebreak 用例）

## 3. C 目标流程（service.ts 编排）

```
1. buildDeliveryEvidenceManifest + persist            （不变）
2. if manifest.finalGate.status != passed:
     → 构造 host_gate_rejected DeliveryDecision（满足 §2.2 shape）
     → 持久化 host gate evidence artifact + final decision artifact
     → 不调用 DeliveryAgent；return final decision
3. (referencePath) runtime-evidence 门 / visual 门     （不变；fail 同 step 2 走 host_gate_rejected）
4. 门全 pass → DeliveryAgent.verify（盲态：delivery 不含任何 host-failure 字段；
     只给 task/goals/diff/design-contract/原始证据入口/工具）
5. del 若 narrow repair：重跑 buildDeliveryEvidenceManifest；任一门 fail ⇒ 回 step 2 形态
6. composeDeliveryDecision(agentVerdict, hostGatePassed=true)
     → final.verdict = agentVerdict.verdict（host 已全 pass，不改写、不注入）
     → 持久化 raw agent verdict evidence artifact + final decision artifact
7. return final decision
```

`arbitrateDeliveryGate`（manifest 内部仲裁）保留不变。`arbitrateDeliveryVerdict` 重命名 `composeDeliveryDecision`，纯函数、无副作用、不改写不注入；host gate fail 分支不接收 agentVerdict。

## 4. B 止血（仅 prompt，可先行单独提交，不算根治）

仅改 `prompt/core/delivery-core.txt` + `delivery/agent.ts::buildUserPrompt`：

- 删 `delivery-core.txt:252-255` 的 `The host gate will override an LLM accept ... aligning your verdict with the gate keeps the rework signal clean`
- 删 `delivery-core.txt:96-98` 引导"只读 gate 不独立查"的措辞，改为"独立验证；host 证据是输入不是结论"
- `agent.ts:378-383` 删 `You must submit verdict='rejected'`；`agent.ts:417-418,431-432` 删 `unless you can prove the probe is invalid` 倒置举证句；四个 host-failure section 降级为中性原始观测（去结论、去祈使、去 status rollup）
- 测试：`buildUserPrompt` 输出不含上述被删字符串（正则断言）

B 是减少复读痕迹的止血，**不解除 arbiter 改写**，schema/持久化边界仍鼓励复读 ⇒ 必须由 C 根治。

## 5. 风险与回滚

- 风险：final decision 占用兼容 label，若 raw/host evidence 误用兼容 label ⇒ 退化为新双源（rule 8）。缓解：§2.1 label 命名固定 + §2.5 三-label-分离用例。
- 风险：门 pass 后 del 盲态可能少跑昂贵检查 ⇒ 但门已 pass，确定性面已保障；del 仅负责语义/遗漏面，divergence 不再进入 retry（门 fail 早已 short-circuit），不劣化 rework。
- 回滚：B 与 C 各自独立 commit；C 出问题可 revert C commit 保留 B。

## 6. 实施次序

1. B 止血：单 commit（制造痕迹，rule 33）
2. C：rule 37 驱动 codex/claude-code（bypass+no-sandbox）实施 + §2.5 测试矩阵；每修一处 commit
3. rule 24/35 codex 二次复核交付物；pre-push hook 全绿后 push
