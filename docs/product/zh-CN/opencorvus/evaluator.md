# 交付检查与判决

> **重要变化（2026-05）**：旧 `evaluator` agent / `src/evaluator/` 目录已**整体删除**。它原先承担的"判定交付物合格与否"职责现在由 **Delivery agent** + `src/delivery/checks/` 模块完成；判决产物以 `engine_artifact[kind="evaluation" | "verdict" | "verification-evidence"]` 形式落盘。本页保留 URL 兼容性，内容已替换为新模型。

## 两阶段验证

### 阶段 1：确定性检查

Delivery agent 通过 `delivery/checks/discovery.ts` 解析当前 task 的 check family，按以下顺序运行：

1. **从 `done_definition` / `check_selectors` 提取命令**：解析 Goal / Requirement 上声明的命令（`bun run typecheck`、`bun test`、`pytest` 等），直接运行，以 exit-code 为准。命令必须来自结构化 metadata，**不从关键字推断**（见 `check/policy.ts::inferSelectors` 返回空数组的设计）。
2. **Project discovery**：从 `owned_paths` 向上找最近的 `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`，自动发现 build / test / lint 命令。具体规则在 `delivery/checks/project-gate.ts` 与 `delivery/checks/runtime-readiness.ts`。
3. **语义标准**：无法执行的纯文字标准（如"符合架构规范"）只作 evidence，不影响 pass/fail。

### 阶段 2：LLM judge

仅当确定性检查**不足以裁定**（例如没有可执行的测试，或 UI 视觉 fidelity 判断）时，LLM judge 才出场。视觉渲染证据使用 `runtime/visual-page.ts`；内容指纹 helper 位于 `delivery/checks/content-fingerprint.ts`；最终验收 verdict 由 integrity review 汇总。

## CheckSelector

合法 selector 列表（`packages/opencorvus/src/check/policy.ts:3`，唯一权威源）：

```
build · test · lint · verify_cmd · ui_review · code_quality ·
code_review · dead_code_review · startup · spec_check
```

`CheckFamily`（`policy.ts:17`）是 selector 的子集：`build · test · lint · verify_cmd`，作为通用 family 匹配。

> Selectors 必须显式声明在 spec requirement 的 `check_selectors` 字段或 architect 的结构化输出里——**禁止从关键字推断**（`policy.ts:24`）。

## Tier 分级

配置 `assistant.delivery.*` / `assistant.delivery_visual.*`（在 `opencorvus.jsonc`），不再有旧 `assistant.evaluator.tier` 字段：

- `delivery.max_retries`：交付阶段最大回修次数
- `delivery_visual.*`：视觉判定的数值硬门槛阈值
- 具体 schema 见 [05-config.md](../../../specs/new-arch/05-config.md)

## `selectorsSatisfied` 语义

`check/policy.ts:45` 的关键实现：

```
1. 过滤掉 status === "skipped" 的检查
2. 每个声明的 selector 必须有至少一条匹配且 passed 的活跃检查
3. 未运行的 selector 不算通过
```

**注意**：没跑 = 不通过。这防止"静默跳过 build 然后声称 accepted"。

## Verdict 语义

verdict 以 `engine_artifact[kind="verdict"]` 形式落盘：

| verdict        | 后续动作                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `accepted`     | `deliver` 直接完成 task；如需补充 patch / git preview 等交付物，可显式调用 `publish_delivery` 做 post-delivery artifact export |
| `rejected`     | 走 `delivery-retry-feedback.ts` 回修；超过 `delivery.max_retries` 后由 Orchestrator 决定 retry / replan / fail                 |
| `inconclusive` | 视为 rejected，但优先 replan（无法判决通常意味着信息不全或 doom-loop）                                                         |

Delivery agent 只负责 verdict 和证据。启动 / 停止 / retry / cancel / fail 当前 task，以及发布新的 follow-up task，是 Orchestrator 的 lifecycle 权限；Delivery 如果发现应拆成新 task，只能在 verdict evidence 中提出建议，不能直接创建 task。

## 与 Benchmark 的关系

benchmark 的 `qualityVerdict === "accepted"` 现在表示 delivery agent 写下的 verdict artifact 为 `accepted` 且 `verification-evidence` 中 `required_check_pass_rate > 0`（`script/benchmark/quality-gates.ts`）。

## Prosecutor / Integrity 复核

`accepted` 候选可能再被两个独立 agent 复核，但它们不是 Delivery 内部步骤，也不是自动交付门：

- **Integrity Reviewer**（`integrity/agent.ts`）：Orchestrator 显式调用的 multi-dimension 审查（requirement_fidelity / technical_feasibility / hallucination / solution_quality），结果落 `engine_artifact[kind="integrity_attempt"]`。Delivery 不会自动运行或消费它作为内部 gate；Delivery rejection 的修复证据应直接进入下一轮 build。
- **Prosecutor**（`prosecutor/agent.ts`）：对抗性复核，结果落 `engine_artifact[kind="prosecutor_attempt"]`。

两个都是 Orchestrator 通过 tool 主动调用，不是自动 pipeline。

## 已知坑

1. **空输出 = inconclusive**：executor 返回空字符串时，必须标 `inconclusive`，**不能**标 accepted（历史 bug：空输出被当成"没问题所以通过"）。
2. **build 检查被跳过**：如果 worktree 合并失败（`EEXIST`），build 无法执行，**不能**因此放过——要标 rejected。
3. **TypeScript 错误未被检测**：确保 spec 的 `check_selectors` 包含 `lint` 或显式 `typecheck` family。

## 你接下来要看的

- [配置](./configuration.md)
- [Benchmark](../operations/benchmark.md)
- [Troubleshooting](../operations/troubleshooting.md)
- 完整 Agent 家族：[specs/new-arch/01-agents.md](../../../specs/new-arch/01-agents.md)
