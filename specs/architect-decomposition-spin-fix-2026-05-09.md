# Architect Decomposition Spin Fix

日期：2026-05-09

状态：已实施首轮修复

## 1. 问题现状

用户提供的 Architect 日志显示，架构分解在 `submit_architect` 后反复收到同两类问题：

1. `goal_tests` 没有依赖 bootstrap goal。
2. reference-driven 任务缺少最终视觉验收：blocking verification/integration goal 上必须有 `essential + trigger: "on_delivery" + llm_judge` acceptance spec。

Architect 之后多轮尝试“修复”，但没有收敛。表现包括：

- 同时出现 `goal_unit_tests` 和 `goal_tests`，目标命名和职责不稳定。
- 把 visual fidelity acceptance spec 加到测试 goal 后仍被拒绝。
- 反复推测 `modify_goal` 是否覆盖了字段，但没有读取或稳定重建当前 collector 状态。
- 争辩“这不是视觉任务”，但 validator 已经因 `designAnalysis` 存在把它判定为 reference-driven。
- 没有处理用户需求“真实数据拿不到就 mock 数据”和项目规则“禁止 fallback/兜底逻辑”的冲突。

这不是单点模型失误，而是 prompt、validator、tool ergonomics 和需求冲突处理共同造成的系统性问题。

## 2. 当前代码证据

### 2.1 Validator 的真实规则

`packages/opencorvus/src/architect/output-tools.ts` 中：

- `requireReferenceCoverage` 为真时，必须存在至少一个 goal：
  - `priority === "blocking"`
  - `kind === "verification"` 或 `kind === "integration"`
  - `acceptance_specs.some(isEssentialDeliveryJudgeSpec)`
- `isEssentialDeliveryJudgeSpec` 只检查：
  - `severity === "essential"`
  - `trigger === "on_delivery"`
  - 至少一个 scorer `type === "llm_judge"`

因此，视觉验收放在普通 feature goal、非 blocking goal、非 verification/integration goal，或者没有显式 `trigger: "on_delivery"`，都会被拒绝。

### 2.2 Reference-driven 的触发范围

`packages/opencorvus/src/architect/agent.ts` 中：

```ts
requireReferenceCoverage: (input.designSpecs?.length ?? 0) > 0 || Boolean(input.designAnalysis?.trim())
```

也就是说，只要传入了 design-analysis handoff 文本，即使没有截图或 `design_specs`，Architect validator 也会要求 reference coverage 和最终 delivery visual acceptance。

这解释了日志里“C# 转 React 不是视觉任务”的自辩为什么无效：当前系统规则不是按任务语义判断，而是按 `designAnalysis` 是否存在判断。

### 2.3 Prompt 和 validator 存在认知摩擦

`packages/opencorvus/src/prompt/core/architect-core.txt` 同时要求：

- 每个 decomposition 必须有 exactly one final `goal_tests`，`kind: verification`。
- reference-driven work 的视觉验收必须放在 final verification/integration goal。
- llm_judge 一般只在 shell 无法验证时使用。

这些规则单独正确，但对模型来说容易产生冲突：

- “单元测试 goal”与“最终 verification goal”被混为 `goal_tests`。
- “llm_judge only when no shell command can verify”削弱了 reference-driven 任务必须加 judge 的硬约束。
- 日志中的 agent 把视觉验收补到 `goal_tests`，但如果它注册的 `goal_tests` 不是 `kind: verification` 或后续更新覆盖了字段，validator 仍会拒绝。

### 2.4 Tool 反馈不足以让模型停止猜测

`modify_goal` 返回：

```text
OK: goal "goal_tests" fields updated (N change(s))
```

它没有返回更新后的完整 goal 摘要，也没有显示 `kind`、`depends_on`、`acceptance_specs` 的关键字段。模型只能根据记忆猜当前状态，日志中也确实出现了“可能被覆盖了”的推测。

虽然 `modify_goal` 的代码是 partial merge，不是整块覆盖，但模型无法从工具结果确认这一点，仍然进入按报错猜字段的循环。

实施复核时确认了一个更深层的真实 bug：`GoalContractUpdateSchema` 原先从带 default 的 `GoalContractFieldsSchema` 派生 `.partial()`，导致只更新 `acceptance_specs` 时，schema parse 会注入默认 `kind=feature`、`depends_on=[]`、`exports=[]`、`imports=[]`、`priority=blocking`、`requirement_ids=[]` 等字段。Architect 内部 `modify_goal` 随后把这些默认值合并进 goal，确实可能把原本的 verification goal 改回 feature goal，并清空依赖。首轮修复已将 update schema 改成无默认值的真正 partial schema。

### 2.5 缺少直接覆盖本事故的测试

已有测试覆盖了：

- reference-driven 缺少 essential delivery visual acceptance 会被拒绝。
- 有正确 spec 时会通过。
- bootstrap goal 必须出现在每个 non-bootstrap goal 的 `depends_on`。

但缺少一个综合回归：当同时存在 bootstrap goal、feature goal、final `goal_tests`、`designAnalysis` handoff 且无 `design_specs` 时，正确的 decomposition 能一次通过。也缺少错误形态回归：视觉验收加到非 final verification goal 时必须报出更具体的定位信息。

## 3. 根因模型

### L1：直接触发原因

Architect 没有把两个硬规则同时满足到同一个最终 goal：

- `goal_tests.depends_on` 必须包含 `goal_csharp_analysis`。
- `goal_tests` 必须是 `blocking + verification/integration`，且包含 essential on_delivery llm_judge。

### L2：模型行为原因

Architect 在 validator 报错后没有重建完整 goal graph，而是局部 `modify_goal`。当同名/近名 goal 同时存在时，模型无法稳定判断自己修改的是不是 validator 指向的目标。

### L3：系统设计原因

Validator 把“有 designAnalysis handoff”统一视作 reference-driven visual task，但报错文案只说 rendered-vs-reference visual fidelity，没有说明：

- 是 `designAnalysis` 触发了这个要求。
- 具体哪个 final goal 不满足。
- 满足条件需要 goal 的哪些字段。

### L4：需求契约原因

用户原需求包含“真实数据拿不到就 mock 数据”。项目规则禁止 fallback/兜底逻辑，因此正确做法不是登记成运行时 fallback，而是改写成：

- 真实数据接入是生产路径。
- mock 只能作为显式开发/测试数据源，必须由配置或测试夹具选择。
- 运行时不得在真实数据失败时自动切换 mock。

Architect 没有在 requirement/architecture 层拦截这个冲突，导致后续 goal 可能把 forbidden fallback 写入合同。

## 4. 目标架构

### 4.1 Goal 命名和职责单源化

每次 decomposition 只能有一个最终验证 goal：

```text
goal_tests
  kind: verification
  priority: blocking
  depends_on: all bootstrap/feature/system/integration goals
  owned_paths: only integration/e2e/regression tests
  acceptance_specs:
    - acc-goal_tests-suite: heuristic full test command
    - acc-final-reference-fidelity: essential on_delivery llm_judge when requireReferenceCoverage is true
```

禁止同时注册 `goal_unit_tests` 作为并列的全局测试 goal。单元测试属于各 feature goal 的 `owned_paths` 和 acceptance spec；最终测试只叫 `goal_tests`。

### 4.2 Reference-driven 规则显式化

当 `designAnalysis` 或 `designSpecs` 存在时，Architect prompt 和 validator 都要明确：

- 当前任务已进入 reference-driven mode。
- 触发原因是 `designAnalysis` handoff 或 `design_specs`。
- 最终 `goal_tests` 必须带 final reference fidelity acceptance spec。
- 即使没有截图，PRD/SPEC 也是 authoritative reference surface。

### 4.3 禁止 fallback 合同写入 goal

Requirement/Architect 应将“如果拿不到真实数据就 mock”规范化为：

```text
Production path: real data accessor.
Mock path: explicit fixture/dev mode selected intentionally by tests or development configuration.
Forbidden: automatic runtime fallback from failed real request to mock data.
```

如果必须保留 mock，合同名称应使用 `fixture` / `explicit mock mode`，不得使用 `fallback`。

### 4.4 Tool 结果提供状态快照

`modify_goal` 成功后应返回该 goal 的关键字段快照：

```text
OK: goal "goal_tests" fields updated (2 change(s))
Current: kind=verification priority=blocking depends_on=[goal_csharp_analysis, goal_rewrite_workflow] acceptance_specs=[acc-goal_tests-suite:on_goal:heuristic, acc-final-reference-fidelity:on_delivery:llm_judge]
```

`submit_architect` 报错时也应包含定位：

```text
Missing essential delivery visual acceptance:
requireReferenceCoverage=true because designAnalysis is present.
No blocking verification/integration goal has essential trigger=on_delivery llm_judge.
Candidates:
- goal_tests kind=feature priority=blocking specs=[...]
- goal_unit_tests kind=verification priority=blocking specs=[...]
```

这不是 fallback，而是把 validator 已知事实直接暴露给模型，减少猜测。

## 5. 实施方案

### P0：测试先行

新增或扩展测试：

1. `packages/opencorvus/test/architect/output-tools.test.ts`
   - bootstrap + feature + final `goal_tests` + `requireReferenceCoverage=true` + no `designSpecs` 时，正确 spec 通过。
   - visual spec 放在 feature goal 时拒绝，并报出候选 goal 状态。
   - `goal_tests` 缺 bootstrap dependency 时拒绝，并在修复后通过。

2. `packages/opencorvus/test/architect/agent.test.ts`
   - designAnalysis 非空时，terminal readiness 和 `submit_architect` 对 reference-driven requirement 一致。

3. `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
   - Architect prompt 明确说明 reference-driven mode 的触发条件和 final goal 放置位置。
   - Prompt 不鼓励创建 `goal_unit_tests` 这种第二个全局测试 goal。

### P1：改进 validator 诊断

修改 `packages/opencorvus/src/architect/output-tools.ts`：

- 把 `requireReferenceCoverage` 的原因传入 validator，例如：
  - `designAnalysis`
  - `designSpecs`
- `Missing essential delivery visual acceptance` 附带候选 verification/integration goals 和 specs 摘要。
- 保持校验规则不放宽，不添加兼容路径。

### P2：改进工具反馈

修改 `modify_goal` 和 `register_goal` 的返回文本：

- 输出更新后的 `kind`、`priority`、`depends_on`。
- 输出每个 acceptance spec 的 `id`、`severity`、`trigger`、scorer type。
- 对 `goal_tests` 输出是否满足 final verification shape。

这只改变可观测诊断，不改变持久化结构。

### P3：收紧 Architect prompt

修改 `packages/opencorvus/src/prompt/core/architect-core.txt`：

- 在 Phase 4.6 中明确：final verification goal 是唯一全局测试 goal，推荐 id 为 `goal_tests`。
- 在 reference-driven 规则后增加反例：
  - 不要把 final visual/reference acceptance 放到 feature goal。
  - 不要创建 `goal_unit_tests` + `goal_tests` 双全局测试 goal。
  - 不要在 validator 报错后局部猜测；应重读 issue，整体修正 final goal。
- 明确 PRD/SPEC handoff 也算 authoritative reference surface。

### P4：数据 fallback 冲突治理

在 Requirements 或 Architect 层加入测试和 prompt 规则：

- 检测需求文字中的“拿不到就 mock / fallback / 兜底”。
- 要求重写为 explicit mock mode 或 fixture source。
- 对运行时自动 fallback 合同进行拒绝或至少进入 issue 列表。

目标不是阻止 mock，而是禁止 mock 成为失败路径的自动兜底。

### P5：验收 benchmark

用用户提供的 C# KeyStatistics 任务复现：

- 输入中包含 design-analysis handoff。
- 目标目录已存在部分实现。
- 用户需求含真实数据/mock 表述。

验收标准：

1. Architect 不超过两次 `submit_architect` 收敛。
2. 最终 goal set 只有一个 final `goal_tests`。
3. 所有 non-bootstrap goals 都依赖 bootstrap。
4. `goal_tests` 是 `kind=verification`、`priority=blocking`。
5. `goal_tests` 同时包含 full-suite heuristic 和 final reference llm_judge。
6. 架构合同中没有运行时 fallback；mock 被表达为显式 fixture/dev 数据源。

## 6. 推荐的正确 goal shape

针对日志中的 KeyStatistics 任务，推荐最终形态是：

```text
goal_csharp_analysis
  kind: bootstrap
  owns: analysis artifacts / rewrite gap document / source behavior inventory
  exports: KeyStatistics behavior inventory, source-to-target gap table

goal_rewrite_workflow
  kind: feature
  depends_on: goal_csharp_analysis
  owns: src/web/src/components/composite/KeyStatisticsMTts/**
  imports: behavior inventory / gap table
  exports: KeyStatisticsMTts component API, data accessor contract

goal_tests
  kind: verification
  priority: blocking
  depends_on: goal_csharp_analysis, goal_rewrite_workflow
  owns: KeyStatisticsMTts integration/regression test files only
  acceptance_specs:
    - full test/typecheck heuristic
    - final PRD/SPEC rendered/reference fidelity llm_judge, essential, on_delivery
```

如果 C# analysis 只是文档和行为库存，不需要作为 bootstrap，则更好的形态是将它合并进 `goal_rewrite_workflow`，避免 bootstrap 依赖硬约束扩大。但一旦它被注册为 `kind=bootstrap`，所有其他 goal 必须显式依赖它。

## 7. 非目标

- 不放宽 reference-driven visual acceptance gate。
- 不引入第二个 validator 或 compatibility path。
- 不让 Architect 通过自然语言解释绕过 schema。
- 不保留运行时 mock fallback。
- 不通过 git 回退修复已有未提交改动。

## 8. 预期收益

- Architect 遇到同类 validator issue 时能从工具返回中看到当前 goal 状态，不再猜。
- Reference-driven task 的 final acceptance 放置位置单一明确。
- `goal_tests` 成为唯一最终验证入口，避免 `goal_unit_tests` / `goal_tests` 双源。
- 数据 mock 与 fallback 的项目规则冲突在架构层被消解，不流入 build。
- 后续 benchmark 可用同一个 KeyStatistics 场景固定回归。

## 9. 首轮实施记录

已完成：

1. `GoalContractUpdateSchema` 改为无默认值 partial schema，避免 `modify_goal` 局部更新被默认值污染。
2. `register_goal` / `modify_goal` 返回当前 goal 快照，包括 `kind`、`priority`、`depends_on`、`acceptance_specs` 和 final reference acceptance 判定。
3. `submit_architect` 的 final visual acceptance 报错增加 reference coverage 触发原因、必需形状和候选 goal 快照。
4. Architect agent 将 reference coverage 触发原因传给 output tools。
5. Architect prompt 明确 PRD/SPEC handoff 也是 authoritative reference surface，final judge 必须放在唯一全局 `goal_tests` / `goal_e2e` verification goal。
6. 新增回归测试覆盖 reference-driven bootstrap/feature/verification graph、错误 goal 上的 final judge 诊断、goal 快照返回和 prompt hygiene。

已验证：

- `bun test packages/opencorvus/test/architect/output-tools.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/orchestrator/modify-goal-noop.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
