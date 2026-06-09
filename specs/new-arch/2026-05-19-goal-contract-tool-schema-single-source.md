# register_goal / modify_goal — 工具 inputSchema 单一来源化

日期：2026-05-19
分支：feat/architect-contract-audit-coverage
触发：用户反馈"注册 goal 时格式错好几次才对"，怀疑 acceptance_specs schema。

## 1. 根因

`register_goal`（architect）、`modify_goal`（architect + orchestrator）三个工具的
`inputSchema` 把每个字段都声明成 `z.unknown()`，真正的校验放到 `execute`
里手动 `safeParse(GoalContractFieldsSchema / GoalContractUpdateSchema)`。

后果：

- AI SDK 把 `z.unknown()` 转成 JSON Schema 时退化为 `{}`（any），模型只看到
  `.describe()` 里的散文。`AcceptanceSpec` 是深层嵌套结构（per-spec 必填
  `id/source_requirement_id/goal_id/title/severity/scorers`，`scorers[]` 是
  4 路 discriminated union），散文无法表达。模型只能"猜形状 → 收 Zod 报错
  → 再猜"，多次往返才对。这就是用户观察到的症状。
- 输入契约存在**两份**（rule 8 双源）：`z.unknown()` 上的散文 +
  `acceptanceScorerGuidance` 字符串 vs 真正校验用的 canonical schema，必然漂移。
- 同一反模式在 architect 与 orchestrator 各复制一份（rule 9）：
  `acceptanceScorerGuidance`/`acceptanceScorerHints`/`ACCEPTANCE_SCORER_TYPES`
  ↔ `goalUpdateAcceptanceGuidance`/`modifyGoalAcceptanceHints`/`GOAL_UPDATE_SCORER_TYPES`。

`z.unknown()` 不是 provider 约束：architect 的其他工具
（`SourceCoverageEntrySchema`、`ArchitectContractRefSchema`、
`GoalDependencyContractSchema`）都用真实嵌套 schema 走同一条
`normalizeToolSchemaForProvider` 通道，证明 provider 能承载。`z.unknown()`
来自 squash 提交 `bd291c7fc`，无设计文档背书。

## 2. 决策（用户已拍板）

**纯 schema 方案**：inputSchema 直接用 canonical schema，删除手写校验/curated
报错路径。schema-invalid 调用由 AI SDK 在 execute 之前用自带 Zod /
discriminated-union 报错拒绝，`experimental_repairToolCall` 返回 null →
SDK 发 tool-error part，模型读后重试。可见的 discriminated union 本身已告诉
模型 `type` 合法值与各自形状，curated scorer 提示随之冗余。

## 3. rule 35 全仓调用点枚举

待删除符号（全部仅 `architect/output-tools.ts` 内部，无外部消费者）：

| 符号                                                 | 处置                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ArchitectGoalRegistrationInputSchema` (100)         | 删除；`register_goal.inputSchema` 改用 `GoalContractFieldsSchema`                                    |
| `ArchitectGoalModificationInputSchema` (122)         | 删除；architect `modify_goal.inputSchema` 改用 `z.object({ id, updates: GoalContractUpdateSchema })` |
| `parseRegisteredGoalForTool` (129, 587, 642)         | 删除；execute 直接收已校验入参                                                                       |
| `parseGoalUpdatesForTool` (142, 639)                 | 删除                                                                                                 |
| `formatGoalContractError` (138/155/170)              | 删除                                                                                                 |
| `acceptanceScorerHints` (171/184)                    | 删除                                                                                                 |
| `acceptanceScorerGuidance` (92/109/125/180)          | 删除                                                                                                 |
| `withGoalContractDefaults` (132/159)                 | 删除（canonical schema 的 `.default()` 已覆盖默认值）                                                |
| `ACCEPTANCE_SCORER_TYPES` (89/197/206)               | 删除                                                                                                 |
| `normalizeGoalContractFields` (82, toRegisteredGoal) | **保留**——seeding existingGoals 的 DB→RegisteredGoal 路径仍需要                                      |

orchestrator 侧（`orchestrator/tools.ts`，rule 9 重复实现，一并清理）：

| 符号                                                           | 处置                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ModifyGoalInputSchema` (477)                                  | `updates` 改 `GoalContractUpdateSchema`，`goalID`/`reason` 改 `z.string().min(1)` |
| `parseModifyGoalUpdates` (487, **exported**, 用于 3406 + test) | 删除；execute 直接用已校验 `input.updates`。**修改 test**                         |
| `modifyGoalAcceptanceHints` (507)                              | 删除                                                                              |
| `goalUpdateAcceptanceGuidance` (471)                           | 删除                                                                              |
| `GOAL_UPDATE_SCORER_TYPES` (469)                               | 删除                                                                              |
| `computeContractFieldChanges` / `goalUpdateNoOpFields` (617)   | 保留——no-op 过滤仍需要，输入现为已校验 partial                                    |

canonical schema（保持不变，单一来源）：
`GoalContractFieldsSchema` / `GoalContractUpdateSchema` @ `pipeline/goal-contract.schema.ts`。
`.default([])` 字段（depends_on/priority/kind/requirement_ids）→ JSON Schema
带 default、对模型可选，替代 `withGoalContractDefaults`。

## 4. 受影响测试（rule 28/36 必须同步）

- `test/architect/output-tools.test.ts:346` "returns actionable guidance for
  malformed scorer type" + `:381` `expect(out).toContain('"shell" is not a
scorer type')`：curated 路径已删 → 改为**断言 schema 层面拒绝**
  （`ArchitectGoalRegistrationInputSchema`→`GoalContractFieldsSchema` 的
  `.safeParse` 对 `type:"shell"` 报 discriminated-union 错），不再断言 execute 文案。
- `test/orchestrator/modify-goal-noop.test.ts:147` `describe("parseModifyGoalUpdates")`
  - `:171` `'"shell" is not a scorer type'`：`parseModifyGoalUpdates` 删除 →
    改为对 `ModifyGoalInputSchema.safeParse` / `GoalContractUpdateSchema.safeParse`
    断言；保留 `computeContractFieldChanges` 用例。
- 新增回归测试（rule 28）：断言 `register_goal` / 两个 `modify_goal` 的
  inputSchema 经 `asSchema(...).jsonSchema` 转换后，`acceptance_specs` 节点
  **不是** `{}`/any，而是含 `AcceptanceSpec` 必填字段与 scorers oneOf 的对象
  ——锁死"schema 对模型可见"，防回归到 `z.unknown()`。
- 全跑 `test/architect/output-tools.test.ts`、`test/orchestrator/modify-goal-noop.test.ts`、
  `test/orchestrator/tools.test.ts`、`test/architect/agent.test.ts`、
  `test/orchestrator/architect-fidelity-gate.test.ts`。

## 5. 验收

- typecheck 通过（pre-push hook：typecheck / api:routes-check / docs:check）。
- 上述测试全绿。
- 二次复核（rule 24）：codex review 确认无双源残留、无 curated 路径残留、
  无对模型隐藏的 `z.unknown()` goal-contract 入参。
