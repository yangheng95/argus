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

| 符号 | 处置 |
|---|---|
| `ArchitectGoalRegistrationInputSchema` (100) | 删除；`register_goal.inputSchema` 改用 `GoalContractFieldsSchema` |
| `ArchitectGoalModificationInputSchema` (122) | 删除；architect `modify_goal.inputSchema` 改用 `z.object({ id, updates: GoalContractUpdateSchema })` |
| `parseRegisteredGoalForTool` (129, 587, 642) | 删除；execute 直接收已校验入参 |
| `parseGoalUpdatesForTool` (142, 639) | 删除 |
| `formatGoalContractError` (138/155/170) | 删除 |
| `acceptanceScorerHints` (171/184) | 删除 |
| `acceptanceScorerGuidance` (92/109/125/180) | 删除 |
| `withGoalContractDefaults` (132/159) | 删除（canonical schema 的 `.default()` 已覆盖默认值）|
| `ACCEPTANCE_SCORER_TYPES` (89/197/206) | 删除 |
| `normalizeGoalContractFields` (82, toRegisteredGoal) | **保留**——seeding existingGoals 的 DB→RegisteredGoal 路径仍需要 |

orchestrator 侧（`orchestrator/tools.ts`，rule 9 重复实现，一并清理）：

| 符号 | 处置 |
|---|---|
| `ModifyGoalInputSchema` (477) | `updates` 改 `GoalContractUpdateSchema`，`goalID`/`reason` 改 `z.string().min(1)` |
| `parseModifyGoalUpdates` (487, **exported**, 用于 3406 + test) | 删除；execute 直接用已校验 `input.updates`。**修改 test** |
| `modifyGoalAcceptanceHints` (507) | 删除 |
| `goalUpdateAcceptanceGuidance` (471) | 删除 |
| `GOAL_UPDATE_SCORER_TYPES` (469) | 删除 |
| `computeContractFieldChanges` / `goalUpdateNoOpFields` (617) | 保留——no-op 过滤仍需要，输入现为已校验 partial |

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
  + `:171` `'"shell" is not a scorer type'`：`parseModifyGoalUpdates` 删除 →
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

---

## 6. 审计反馈修订（2026-05-19 — 4-agent 全域 schema 审计 + register_contract 死循环实证；禁止静默重写本段以上原决策，rule 35 末条）

### 6.1 §2 核心假设被实证证伪

§2 原文断言："可见的 discriminated union 本身已告诉模型 `type` 合法值与各自形状，
curated scorer 提示随之冗余 …… repairToolCall 返回 null → 模型读后重试"。

实证证伪（task `tsk_e3f3a5e13001sIKjGs1nVHLkBD`，architect 真实运行）：
`register_contract` 注册 `type` 合约时，`ir`（`ContractIRSchema` 嵌套
`ValueDomainSchema`，`architect/contract-ir.ts:5,52`）连续 9 次判别值猜错
（`ir.kind` 猜 `interface`/`struct`，`valueDomain.kind` 猜 `primitive`/`brand`，
全部 schema 外），**后 6 次逐字节相同**，architect 死循环、task 永久卡死。

根因（逐项实测）：
- `z.toJSONSchema(ContractIRSchema).anyOf[].properties.kind.const` 实测 =
  `["type","function","enum"]`——合法值**在给模型的 JSON Schema 里可见**。
  故 §2 "schema 可见即够" 的前半不成立：可见 ≠ 模型据此自纠。
- zod4 `z.discriminatedUnion` 失配只产唯一 issue
  `{"code":"invalid_union","errors":[],"note":"No matching discriminator",
  "discriminator":"kind","path":[...]}`——**结构性不含合法判别值**。
- `session/llm.ts` `experimental_repairToolCall` 对该错 `return null`，AI SDK
  把上面那段裸 JSON 原样回灌模型；模型无新信息 → 同输入重试 → 死循环。
  §2 "repair 返回 null → 模型读后重试" 对**非判别联合** Zod 错（`min`/类型错，
  文本自带信息）成立，对 `z.discriminatedUnion` 失配**不成立**。

### 6.2 §3 的 rule 35 穷举遗漏

§3 调用点表只 grep 了 goal-contract 符号，**未 grep
`register_contract`/`ContractIRSchema`/`ValueDomainSchema`**。§2"删 curated 提示"
决策据此外推到从未审计的 `register_contract.ir` 字段——本段即 rule 35
"遗漏一处即 rule 8 违规" 的实例。同源风险面（同一 canonical schema / 同一
`ContractIR` 树，4-agent 审计确认）：orchestrator `modify_goal`
（`orchestrator/tools.ts` → `GoalContractUpdateSchema` → `AcceptanceSpecSchema`）、
integrity `submit_<dimension>_verdict`
（`integrity/agent.ts` → `graph_corrections[].contract.ir` → 同 `ContractIRSchema`）。

### 6.3 例外条款（补强 §2，方向不变、不回退 curated 业务校验）

§2 "纯 schema 方案 / inputSchema = canonical schema / 不要 host 端 curated
业务校验" **保持不变且正确**（消 rule 8/9 双源）。本次仅补一条 §2 未覆盖的例外：

> **discriminated-union（含嵌套）拒绝不得依赖裸 `return null`。**
> `experimental_repairToolCall` 检出 `InvalidToolInputError` 且 issue 为
> `invalid_union`/`No matching discriminator` 时，必须从 SDK 回调提供的
> `inputSchema({toolName})` JSON Schema **现取**失败 `path` 处
> `anyOf[].properties[<discriminator>].const` 合法值集合，`throw` 携带
> 合法值的 Error（SDK 包成 `ToolCallRepairError`，`.message =
> "Error repairing tool call: …"`，经现有下游成为模型可读 tool-error）。

此例外符合：rule 6.1（schema 仍是唯一数据闸门，host 仅把闸门拒绝原因翻译为
合法值清单 = 数据完整性反馈，非状态机教路）；rule 8（合法值运行时从 schema
现取，不另维护枚举）；rule 15（同一条真实 tool-error，非合成/隐藏/双路）。
通道层单点修复，对所有 agent 的所有 discriminated-union 工具一并生效（rule 4）。
落点是 `@/llm/api` streamText wrapper（`createToolCallRepair` 单一来源），覆盖
**src/ 生产**的每一个 streamText 调用（架构师 / 编排器 / build / integrity /
delivery walkthrough 翻译等）。明确豁免（rule 35 末条，不静默）：
`script/cache-probe/` 下的一次性诊断脚本（如 `trace-aisdk-wire.ts`）有意 import
raw SDK 以观测**未包装**的 wire 行为，不在此单一来源范围内，强行包装会破坏其
探针目的；`src/**` 的 raw `import {…streamText…} from "ai"` 由回归测试结构性
锁死（仅 wrapper 自身 `llm/api.ts` 合法）。

### 6.4 配套（纵深防御，非根治；rule 6.1 prompt-over-host）

- canonical schema 判别分支补 `.describe()`（`contract-ir.ts`
  `ContractIRSchema`/`ValueDomainSchema`、`acceptance/types.ts`
  `ScorerSchema`/`HeuristicScorer.spec`），单一来源、integrity/orchestrator import 复用。
- `architect-core.txt` 像 scorer（line 53-58）那样写清 `ir`/`valueDomain` 形状
  + 一个完整 `type` contract worked example；`orchestrator-core.txt`
  /`integrity-core.txt` 补对应黑盒字段。prompt 不手抄枚举，测试锁 prompt↔schema 一致。

### 6.5 受影响测试增量（在 §4 基础上追加，rule 28/36）

断"旧行为消失"而非仅"新行为对"：repair 对 `invalid_union` **不再 return null**
（裸 JSON 不再直达模型）；`register_contract` 传 `ir.kind:"interface"` →
repair 产出 error message 含 `type`/`function`/`enum`；`valueDomain.kind:"primitive"`
→ 含 `open|literal_union|branded|numeric_range|ref`；`architect-core.txt` 的
`kind` 枚举 == `ArchitectContractKindSchema` 逐值相等（锁 rule 8 双源不漂移）。
