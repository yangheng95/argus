# Agent Prompt 与 Schema 协调瘦身方案

日期：2026-05-01

状态：待实施

关联文档：

- `specs/multi-agent-architecture-fix.md`
- `specs/deliver-systemic-refactor-plan-2026-05-01.md`

## 1. 目标

本方案只处理本次 review 暴露的四类问题：

1. Delivery verdict 把所有任务都绑定到 runtime startup，导致非应用型交付也必须伪造或强行执行启动证据。
2. Architect metric ruler 与 DeliveryEvidenceManifest / acceptance_specs 重复裁决，形成多套质量事实源。
3. Planner 已从 workflow 删除，却仍作为 agent 暴露，留下半删除的 prompt / schema 面。
4. SessionPrompt 的输入 schema 与 part 处理逻辑存在双源和漂移。

最终状态：

- Agent 职责边界只有一套：orchestrator 决策，requirements 抽需求，design-analyst 抽视觉规格，architect 只做目标与契约分解，build 实施，delivery 做最终语义验收。
- 质量事实源只有两层：确定性 DeliveryEvidenceManifest + delivery 语义 verdict。
- Schema 只表达下游真实消费的字段，不为 prompt 叙事、历史兼容或未接线 agent 保留字段。
- Prompt 输入的 schema、part 解析、命令入口和 HTTP 入口共用同一个实现。

术语说明：

- LLM：Large Language Model，大语言模型。
- JSON：JavaScript Object Notation，结构化数据交换格式。
- HTTP：HyperText Transfer Protocol，服务端接口协议。
- UI：User Interface，用户界面。
- DB：Database，数据库。

## 2. 非目标

- 不新增 aggregator / reviewer / classifier 等新 agent。
- 不引入 task kind 状态机来替 LLM 做流程决策。
- 不保留旧 schema 兼容层；这是未发布项目，直接替换旧形状。
- 不把 prompt 清理做成纯文案重写。每个 prompt 改动必须对应工具、schema 或持久化事实源的收缩。

## 3. 当前证据

### 3.1 Delivery verdict 过拟合 runtime startup

证据：

- `packages/opencorvus/src/delivery/verdict.ts:40-45` 定义 `startup_verification` 为共享必填字段。
- `packages/opencorvus/src/delivery/output-tools.ts:84-101` 在 accepted verdict 上硬拒绝 `startup_verification.attempted=false` 或 `success=false`。
- `packages/opencorvus/src/prompt/core/delivery-core.txt:35-51` 的 Personal Verification Floor 要求每次接受前必须有启动 / runtime probe。

根因：

- `submit_verdict` 把“是否需要启动应用”编码成所有任务的普适 schema，而不是从 DeliveryEvidenceManifest 的 required checks 派生。
- Prompt 与 schema 双重强化同一个过拟合假设，LLM 遇到 library/docs/config 任务时只能强行解释“启动验证”。

### 3.2 Architect quality schema 重复裁决

证据：

- `packages/opencorvus/src/prompt/core/architect-core.txt:280-302` 要求每个 goal 注册四个 blocking metrics，并额外注册四个 global blocking metrics。
- `packages/opencorvus/src/architect/output-tools.ts:42-54` 保存 mandatory metric 名单。
- `packages/opencorvus/src/architect/output-tools.ts:177-190` 和 `259-271` 用 submit validator 拒绝缺失 metric。
- `packages/opencorvus/src/architect/output-tools.ts:564-607` 仍注册 prosecutor challenge seeds。

根因：

- Architect 同时承担目标分解、验收指标设计、delivery/prosecutor 先验注入，越过了“目标和契约分解者”的边界。
- acceptance_specs、deterministic checks、DeliveryEvidenceManifest 已经能表达验收合同，metric ruler 是重复事实源。

### 3.3 Planner 半删除

证据：

- `packages/opencorvus/src/engine/workflow.ts:216-220` 明确说 planner 已删除，build 直接读 acceptance specs + architect contract。
- `packages/opencorvus/src/agent/agent.ts:321-336` 仍注册 `planner` subagent。
- `packages/opencorvus/src/planner/output-tools.ts` 和 `packages/opencorvus/src/planner/tools.ts` 仍存在 planner 专用 schema / tools。

根因：

- Workflow 删除了 planner 调度，但 agent registry / prompt catalog / board metadata 没有同步清理。
- `createPlannerTools()` 已经退化成共享 codebase tools，名称继续叫 planner，制造错误抽象。

### 3.4 SessionPrompt schema 与 part 处理双源

证据：

- `packages/opencorvus/src/session/prompt/schema.ts:5-66` 定义 `PromptInput`。
- `packages/opencorvus/src/session/prompt/index.ts:55-116` 又定义一份同名 `PromptInput`。
- `packages/opencorvus/src/session/prompt/parts.ts:187-199` 使用 `isDecodableText()` / `decodeDataUrlText()`。
- `packages/opencorvus/src/session/prompt/index.ts:312-317` 仍用旧的 `part.mime === "text/plain" || Filesystem.isTextLikeMime(part.mime)` + 手写 base64 decode。

根因：

- `session/prompt` 曾经拆过 `schema.ts` 和 `parts.ts`，但 `index.ts` 没有删掉旧实现。
- HTTP route、command path、direct `SessionPrompt.prompt()` path 没有同一解析入口。

## 4. 目标架构

### 4.1 Delivery verdict 只表达语义判断

收缩后的 verdict：

```ts
type DeliveryVerdict =
  | {
      verdict: "accepted"
      summary: string
      evidence_refs: string[]
      semantic_findings: DeliveryFinding[]
      launch_command?: string
    }
  | {
      verdict: "rejected"
      summary: string
      evidence_refs: string[]
      rejection_details: RejectionDetail[]
    }
```

规则：

- `evidence_refs` 指向 DeliveryEvidenceManifest check ids、runtime flow ids、screenshot ids、specialist review ids。
- `startup_verification`、`frontend_check`、`tool_call_evidence` 从 verdict schema 移除。
- 启动、截图、runtime flow 是否必需，由 DeliveryEvidenceManifest 的 `requiredChecks` 决定。
- `submit_verdict` 只校验引用存在、accepted 不引用 failed blocking evidence、rejected 至少有一个 `rejection_details`。

对应 prompt：

- 删除 delivery-core 的 Personal Verification Floor。
- 改成：“先读 manifest；只执行 manifest 要求但尚未满足、或语义判断必须补充的检查。”
- 对 library/docs/config 任务，允许 accepted verdict 引用 test/typecheck/docs build 等证据，不要求 app startup。

### 4.2 Architect 只输出 goal / contract / traceability

保留：

- `register_goal`
- `modify_goal`
- `remove_goal`
- `register_traceability`
- `register_contract`
- `submit_architect`

删除：

- `register_goal_metric_spec`
- `register_global_metric_spec`
- `register_challenge_seed`
- metric mandatory validator
- architect prompt 中 Phase 5 Metric Ruler 和 Challenge Seeds 正文
- prosecutor 相关 prompt 文本和持久化字段引用

验收合同来源：

- 每个 goal 的 `acceptance_specs` 是 goal-level 验收合同。
- DeliveryContractBuilder 从 acceptance_specs、package scripts、project metadata、runtime signals 派生 DeliveryEvidenceManifest。
- Architect 不再要求“每个 goal 有 exports”，改为：feature/bootstrap/system goal 需要真实 handoff 时必须有 exports；verification goal 可以没有 exports；纯文档 / 配置 goal 可以没有 exports，但必须有 acceptance_specs。

### 4.3 Planner 从 agent 表面删除

删除或改名：

- 删除 `Agent.state().planner` 注册。
- 删除 `NATIVE_DEFAULTS.planner`。
- 删除 prompt catalog 中 planner 展示。
- 删除 `packages/opencorvus/src/prompt/core/planner-core.txt`，除非还有测试直接引用。
- 删除 `packages/opencorvus/src/planner/output-tools.ts`。
- 将 `createPlannerTools()` 改名为 `createCodebaseTools()` 或并入 `engine/codebase-tools.ts`。

保留前提：

- 如果 requirements / architect / design-analyst / intent-analysis 仍需要共享 read/search/list/memory tools，这些工具以 `createCodebaseTools()` 名义存在。
- 不保留 `planner` 作为可被 `task` tool 调用的 agent。

### 4.4 SessionPrompt 单一入口

目标文件职责：

- `session/prompt/schema.ts`：唯一 `PromptInput` schema。
- `session/prompt/parts.ts`：唯一 `resolvePromptParts()` 与 `createUserMessage()` 实现。
- `session/prompt/index.ts`：只聚合导出并实现 `prompt()`，不得重新定义 schema 或复制 part 处理。
- `session/prompt/command.ts`、routes、scheduler 只依赖 `schema.ts` / `parts.ts` 导出的类型和函数。

约束：

- data URL 文本解码只走 `isDecodableText()` / `decodeDataUrlText()`。
- file URL 文本判断只走一个 helper，避免 HTTP prompt 和 command prompt 漂移。
- 新增 snapshot test 比较 command path 和 direct prompt path 对同一 text data URL 的解析结果一致。

## 5. 实施阶段

### P0：先锁测试，防止继续漂移

新增测试：

1. `test/session/prompt-single-source.test.ts`
   - 断言 `SessionPrompt.PromptInput === PromptInput` 或等价导出来自同一模块。
   - 断言 direct prompt path 与 command path 对 data URL text parts 解析一致。

2. `test/agent/planner-removal.test.ts`
   - `Agent.list()` 不包含 `planner`。
   - `TaskTool` 的 `{agents}` 描述不出现 planner。

3. `test/architect/output-tools-slim.test.ts`
   - `createArchitectOutputTools()` 不含 metric / challenge seed tools。
   - `submit_architect` 不再因缺 mandatory metrics 拒绝。

4. `test/delivery/verdict-contract.test.ts`
   - docs/library task 可以 accepted，不需要 startup fields。
   - accepted verdict 必须引用 passed manifest evidence。
   - rejected verdict 必须有 `rejection_details`。

### P1：清理 SessionPrompt 双源

改动文件：

- `packages/opencorvus/src/session/prompt/index.ts`
- `packages/opencorvus/src/session/prompt/schema.ts`
- `packages/opencorvus/src/session/prompt/parts.ts`
- `packages/opencorvus/src/session/prompt/command.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/scheduler/task-queue-service.ts`

步骤：

1. 从 `index.ts` 删除内联 `PromptInput`，改为 re-export `schema.ts`。
2. 从 `index.ts` 删除内联 `createUserMessage()` / `resolvePromptParts()`，改为调用 `parts.ts`。
3. 把 model resolution 的错误语义从旧 `index.ts` 搬到 `parts.ts`，避免退回旧 fallback。
4. 跑 session prompt、command、server route 相关测试。

验收：

- `rg "export const PromptInput = z.object" packages/opencorvus/src/session/prompt` 只返回 `schema.ts`。
- `rg "decodeDataUrlText|isDecodableText" packages/opencorvus/src/session/prompt` 只在 `parts.ts` 或 helper 中出现。

### P2：删除 Planner agent 表面

改动文件：

- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/planner/tools.ts`
- `packages/opencorvus/src/planner/output-tools.ts`
- `packages/opencorvus/src/prompt/core/planner-core.txt`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/src/architect/agent.ts`
- `packages/opencorvus/src/requirements/agent.ts`
- `packages/opencorvus/src/design-analyst/agent.ts`
- `packages/opencorvus/src/intent-analysis/agent.ts`

步骤：

1. 删除 planner agent registration 与 native default prompt。
2. 删除 planner output schema 和 board 中 `planner_report` 渲染。
3. 将共享工具工厂改名为 `createCodebaseTools()`。
4. 更新所有 imports，禁止再出现 `PlannerAgent` / `planner_report` / `planner-core`。

验收：

- `rg -n "planner-core|planner_report|Agent.*planner|name: \"planner\"" packages/opencorvus/src` 为 0，允许文档历史记录除外。
- `TaskTool` 不能调度 planner。

### P3：瘦身 Architect 输出契约

改动文件：

- `packages/opencorvus/src/architect/output-tools.ts`
- `packages/opencorvus/src/architect/types.ts`
- `packages/opencorvus/src/architect/agent.ts`
- `packages/opencorvus/src/prompt/core/architect-core.txt`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/metrics/*`
- `packages/opencorvus/src/prosecutor/*`
- `packages/opencorvus/src/agent/agent.ts`

步骤：

1. 删除 metric registration tools、mandatory metric arrays、metric validation。
2. 删除 challenge seed tool 与 ArchitectChallengeSeed 类型。
3. 删除 prosecutor agent registration、orchestrator `prosecute` tool、read_context prosecutor section。
4. 删除 prompt 中 metric ruler / prosecutor prior 文案。
5. 若 metrics storage 仍被 DeliveryEvidenceManifest 使用，则改名为 delivery evidence trajectory；否则删除对应表和 dead code。

验收：

- Architect 最小输出：1 个 goal + acceptance_specs + submit 可通过。
- 不存在 prosecutor 可调用路径。
- DeliveryEvidenceManifest 是唯一 delivery gate 输入，architect metrics 不再参与 accept/reject。

### P4：改造 Delivery verdict 为 manifest 引用型

改动文件：

- `packages/opencorvus/src/delivery/verdict.ts`
- `packages/opencorvus/src/delivery/output-tools.ts`
- `packages/opencorvus/src/delivery/agent.ts`
- `packages/opencorvus/src/prompt/core/delivery-core.txt`
- `packages/opencorvus/src/delivery/arbiter.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/delivery/checks/*`

步骤：

1. 新 verdict schema 删除 `startup_verification`、`frontend_check`、`tool_call_evidence`。
2. `submit_verdict` 接收 `evidence_refs`，校验引用的 manifest evidence 存在且 freshness 匹配当前 delivery run。
3. Delivery prompt 改为 manifest-first，不再要求所有任务自带 startup / screenshot。
4. Arbiter 从 manifest 派生 hard gate，从 verdict 派生 semantic finding，两者合成最终 delivery artifact。
5. Board / overlay 只显示 manifest hard gate + semantic verdict，不再显示重复 startup/frontend 字段。

验收：

- Library-only fixture：有 tests/typecheck evidence，无 startup evidence，也能 accepted。
- Web UI fixture：manifest 要求 startup/runtime/screenshot；缺任一项时 accepted 被拒。
- Rejected verdict 的 affected goals 仍从 `rejection_details[].goal_id` 派生，不新增 `affected_goal_ids`。

## 6. 推荐提交拆分

1. `test(agent): lock prompt schema and planner removal contracts`
2. `refactor(session): make prompt input and part handling single-source`
3. `refactor(agent): remove planner agent surface`
4. `refactor(architect): remove metric ruler and prosecutor seeds`
5. `refactor(delivery): make verdict reference manifest evidence`
6. `test(delivery): cover task-specific evidence requirements`

每个提交必须能独立通过相关测试；不要把所有删除混进一个巨型提交。

## 7. 全局验收命令

建议按阶段运行：

```bash
bun test packages/opencorvus/test/session packages/opencorvus/test/agent packages/opencorvus/test/architect packages/opencorvus/test/delivery
bun test packages/opencorvus/test/benchmark
bun run typecheck
```

如果项目当前没有统一 `typecheck` script，则执行 package 内现有等价命令；不要新增空脚本或吞错 wrapper。

## 8. 完成判定

完成后必须满足：

- `rg -n "planner-core|planner_report|name: \"planner\"|subagent_type.*planner" packages/opencorvus/src` 无运行时代码命中。
- `rg -n "register_goal_metric_spec|register_global_metric_spec|register_challenge_seed|prosecute|prosecutor" packages/opencorvus/src` 无运行时代码命中，除非 metrics 被明确重命名为 delivery evidence trajectory 且不再由 Architect 写入。
- `rg -n "export const PromptInput = z.object" packages/opencorvus/src/session/prompt` 只命中 `schema.ts`。
- Delivery accepted schema 不含 startup/frontend/tool-call evidence 必填字段。
- UI / board / API 只从 DeliveryEvidenceManifest + semantic verdict 展示 delivery 状态，不再从多处自行判断。
