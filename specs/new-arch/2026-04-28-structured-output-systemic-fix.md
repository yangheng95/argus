# StructuredOutput 系统性修复方案

**日期**: 2026-04-28  
**状态**: 审查后修订版  
**触发**:
- `ainvest-20260428-100538` benchmark 中 integrity reviewer 多次重试，最终 `submittedDimensions=none`
- live task `tsk_dd200fc58001606QiIAbsibN5r` 中 build session `ses_22dedf211ffdRvpavHkEV022Qv` 同形态空转：启动 73 秒后触发 compaction，session 已累计 `summary_additions=249969 / summary_deletions=58226 / summary_files=36`，但 `merge_back` 与 `StructuredOutput` 均未被调用，task 仍未完成（`engine_task.time_completed=NULL`）

## 0. 术语

- LLM: Large Language Model，大语言模型。
- SDK: Software Development Kit，软件开发工具包。
- JSON: JavaScript Object Notation，结构化数据格式。
- API: Application Programming Interface，程序接口。
- CI: Continuous Integration，持续集成。
- E2E: End-to-End，端到端验证。
- ROI: Return on Investment，投入产出比。
- PR: Pull Request，代码合并请求。
- AI: Artificial Intelligence，人工智能。
- UTC: Coordinated Universal Time，协调世界时。
- SQL: Structured Query Language，结构化查询语言。
- SQLite: 基于 SQL 的嵌入式数据库引擎。
- Zod: TypeScript-first schema validation library，用于定义和校验结构化数据。
- MCP: Model Context Protocol，模型上下文协议。
- DB: Database，数据库。
- HEAD: Git 当前检出的提交位置。
- K: Thousand，千；本文在 `992K schema` 中表示约 992,000 字符或字节级别的数量级。
- P0/P1/P2/P3/P4/P5/P6: Priority 0 到 Priority 6，本文中的问题优先级标记。

## 1. 审查结论

原方案抓到了一个真实现象：session 在 step 1 触发 predictive compaction，外层 retry 反复创建相同形态的新 session，导致 integrity reviewer 空转。但原方案不能直接执行，原因有三点。

1. `ainvest-20260428-100538` 是一次历史 run，不能证明 current HEAD 仍然存在同样的 schema 体积。特别是 `69714dae6` 已经移除了 `AcceptanceSpec` 子树，必须重新基于当前代码采集 `toolSchemaChars`。
2. `toolSchemaChars=992342` 的诊断口径可疑。当前 `session/loop.ts` 用 `JSON.stringify(tool.inputSchema)` 估算工具体积；对 Zod tool 来说这会量到 Zod 内部对象，而不是 provider 最终收到的 JSON Schema。这个虚高估算本身会错误触发 predictive compaction。
3. benchmark 日志显示 compaction 后 `StructuredOutput` 工具消失。step 1 的工具包含 `StructuredOutput`，compaction 继续轮只有 4 个 `submit_*_verdict` 工具。根因是 compaction 自动创建的 continue user message 没有继承原 user message 的 `format/system/tools`，导致 structured-output contract 在运行时被丢弃。

因此，修复顺序必须调整为：

1. 先修工具 schema 预算估算口径。
2. 再修 compaction 后 structured-output contract 丢失。
3. 再阻止 context-cold session 做无意义 compaction。
4. 然后修 StructuredOutput miss 的信号层。
5. 最后再做 provider hard-pin 验证和 LLM stream 入口清理。

## 2. 证据边界

### 2.1 该 benchmark 能证明什么

`packages/opencorvus/script/benchmark/runs/ainvest-20260428-100538.log`:

```text
:10189 step=1 toolCount=5
       toolNames=submit_goal_fidelity_verdict,...,StructuredOutput
       toolSchemaChars=992342 totalTokensEst=258914

:10190 step=1 totalTokensEst=258914 limit=235929
       usableBudget=262144 predictive-compaction-triggered

:11564 step=3 toolCount=4
       toolNames=submit_goal_fidelity_verdict,submit_technical_feasibility_verdict,
                 submit_hallucination_verdict,submit_solution_quality_verdict
       toolSchemaChars=991739 totalTokensEst=254889

:11792 attempt=1 reason=integrity reviewer ended without emitting
        StructuredOutput({summary}); submittedDimensions=none
```

这些行能证明：

- predictive compaction 在 integrity reviewer 第一次正常发言前触发。
- compaction 继续轮没有 `StructuredOutput` 工具。
- 外层 retry 复用了同一失败形态，不能修复 deterministic budget/contract 问题。

### 2.1.1 build session 上的同形态证据（来自 SQLite 实时快照）

证据边界：当前仓库未包含该实时 `opencorvus.db` 文件，以下内容来自外部运行中的 SQLite 快照。实施前必须把查询语句和导出结果作为 artifact 归档；在 artifact 不存在时，该段只能作为调查线索，不能作为 current HEAD 的可复现验收基线。

`opencorvus.db` 表 `engine_task` / `session` / `message` / `protocol_event`，task `tsk_dd200fc58001606QiIAbsibN5r`：

```text
engine_task tsk_dd200fc58001606QiIAbsibN5r
  time_completed=NULL

session ses_22dedf211ffdRvpavHkEV022Qv  kind=build
  goal_id=gol_dd20a0c5c001o3lGLanwsBSLDt (extract-and-analyze-tradingview)
  permission=[{permission:"merge_back", pattern:"*", action:"allow"}]
  summary_additions=249969 summary_deletions=58226 summary_files=36

message timeline (UTC):
  03:11:31 user (build dispatch)
  03:11:31 assistant finish=tool-calls   agent=build
  03:12:07 assistant finish=tool-calls   agent=build
  03:12:15 assistant finish=tool-calls   agent=build
  03:12:23 assistant finish=tool-calls   agent=build
  03:12:34 assistant finish=tool-calls   agent=build
  03:12:44 assistant finish=stop         agent=compaction   ← 73 秒触发 compaction
  03:12:44 user (synthetic continue)
  03:14:00 user (synthetic continue 2)
  03:14:01 assistant finish=tool-calls   agent=build
  03:14:10 assistant finish=NULL         agent=build (still streaming)

protocol_event aggregate (last 30 min):
  message.part.updated × 884
  message.updated × 294
  goal_run.updated persist.beginBuildAttempt × 3
```

可证明：

- build session 与 integrity 走**完全同一条** predictive-compaction → contract-loss 路径。
- compaction 在 73 秒内就触发，对照 message 轨迹是 `agent=compaction` 介入而非 build agent finalize。
- 快照记录了 249,969 行 additions 级别的 diff 活动（`summary_additions`），但这不是 unique source lines，不应直接解释为净新增 25 万行代码；它只能证明 build session 在大量 worktree 变化后仍**从未发起 `merge_back`/`StructuredOutput` 调用**，外层 `beginBuildAttempt` 已重启 3 次。

结论：integrity 与 build 的失败模式同源（同一阶段 A/B/C/D 缺陷，工具数与 schema 形态不同但触发链一致），本方案修复必须在两个 surface 都验收，不能再把 build 视为 out-of-scope。

### 2.2 该 benchmark 不能证明什么

不能用这份日志直接证明 `69714dae6` 或 `ca2c39c95` 之后 current HEAD 仍然有 992K schema。原因：

- 该 run 名称是 `ainvest-20260428-100538`，进程从 2026-04-28 10:05:38 左右启动。
- `69714dae6` 的提交时间是 2026-04-28 10:12:10 +0800。
- `ca2c39c95` 的提交时间是 2026-04-28 10:46:44 +0800。
- 一个已启动的 benchmark 进程不会因为后续 git commit 自动换成新代码。

结论：这份日志是历史失败形态证据，不是 current HEAD 验收证据。修复前必须重新采集当前代码的 provider-normalized schema 预算。

## 3. 根因分层

| 优先级 | 根因 | 证据 | 影响 |
|---|---|---|---|
| P0 | 工具 schema 预算估算口径错误 | `tool.inputSchema` 是 Zod 对象时，`JSON.stringify` 可能量到内部结构 | 误触发 predictive compaction |
| P1 | compaction continue message 丢 `format/system/tools` | step 3 工具列表缺少 `StructuredOutput` | 模型没有终结工具可调 |
| P2 | context-cold session 上做 compaction | step 1 `assistantMsgCount=0` 时触发 compaction | 没有历史可压，只能空转 |
| P3 | `StructuredOutputError` stamp 条件过窄 | 当前只在 `modelFinished && !error` 后处理 | 某些 miss 不会进入 reminder/hard-pin |
| P4 | `ProviderLLM.stream` 与 `LLM.stream` 类型漂移 | `ProviderLLM.StreamInput.toolChoice` 不含 object form | 架构双源风险，但不是当前 run 的直接根因 |
| P5 | integrity tool schema 设计可能仍偏大 | 需要 current HEAD 重测 | 只有重测超阈值时才进入 schema 重构 |
| P6 | build agent surface 同样命中 P0–P3 | live task `tsk_dd200fc58001606QiIAbsibN5r` build session 73 秒 compaction、never-finalize、大量 diff activity 后仍未 merge_back | 修复必须在 build surface 上同时验收，不能仅修 integrity |

## 4. 修订后的实施方案

### 阶段 A: 修正 schema 预算估算

**目标**: predictive compaction 必须基于 provider 最终接收的工具 JSON Schema，而不是 Zod 内部对象。

**文件**: `packages/opencorvus/src/session/loop.ts`

**改动**:

- 抽出单一 helper，例如 `normalizeToolSchemaForProvider(tool, model)`，作为工具 payload 构造和预算估算的唯一 schema normalization 入口。
- 对 raw Zod `inputSchema` 使用 AI SDK 的 `asSchema(tool.inputSchema).jsonSchema` 取得 JSON Schema，再经过 `ProviderTransform.schema(model, schema)`。
- 对已经由 `jsonSchema(...)` 包装或已经通过 `ProviderTransform.schema(...)` 的工具，必须复用同一份 normalized schema，禁止在预算估算路径二次 transform。
- `resolveTools()` 中 registry tool 与 MCP tool 的 provider transform 逻辑要迁入这个 helper，或让估算读取 helper 产出的同一 normalized payload；不能在 `resolveTools()` 和 estimator 各保留一套 schema transform。
- `toolSchemaChars` 只使用 provider-normalized payload。
- 永久日志只保留一个权威预算字段，避免 raw Zod size 与 normalized size 形成双源判断。

**测试**:

- 构造一个含嵌套 Zod schema 的 tool，断言估算值接近 `z.toJSONSchema` 后的 payload，而不是 `JSON.stringify(zodObject)`。
- 构造 registry tool，断言 `ProviderTransform.schema` 只执行一次，预算估算值与最终传给 provider 的 schema payload 一致。
- 构造 MCP jsonSchema tool，断言 estimator 不破坏原始 JSON Schema，也不重复套用 provider transform。
- 构造 integrity 当前 4 个 dimension tool，输出 current HEAD 的 normalized schema size，作为后续阈值依据。

**验收**:

- current HEAD 下 integrity reviewer 的 `toolSchemaChars` 不再使用 Zod 内部结构。
- 如果 normalized size 低于阈值，不进入 schema 重构。

### 阶段 B: 保留 compaction 后的 structured contract

**目标**: auto compaction 继续轮必须继承原 user turn 的 structured-output 契约。

**文件**: `packages/opencorvus/src/session/compaction.ts`

**现状**:

`SessionCompaction.process()` 创建 continue user message 时只复制：

```ts
agent: userMessage.agent,
model: userMessage.model,
```

这会丢掉：

- `format`: `StructuredOutput` 注入依赖它。
- `system`: stage agent core prompt 依赖它。
- `tools`: session turn 的工具启用面依赖它。
- `variant` / `extra`: 模型变体和运行时附加上下文。

**改动**:

- 创建 synthetic continue user message 时继承 `userMessage.format`、`userMessage.system`、`userMessage.tools`、`userMessage.variant`、`userMessage.extra`。
- 继续消息仍标记为 synthetic text part，不能伪装成用户新指令。
- 不新增第二套 StructuredOutput 注入路径；继续依赖 `lastUser.format` 这一条单源路径。

**测试**:

- 构造带 `format: json_schema` 的 session。
- 触发 auto compaction。
- 断言 compaction 后下一轮 `resolveTools` 仍包含 `StructuredOutput`。
- 断言下一轮 system prompt 仍包含 stage agent 的 `system`。

**验收**:

- 日志中 compaction 后的继续轮必须出现 `toolNames=...,StructuredOutput`。
- 不再出现 “模型需要 StructuredOutput 但工具列表没有 StructuredOutput” 的状态。

### 阶段 C: context-cold / non-compressible prompt 禁止 predictive compaction

**目标**: 没有可压缩历史，或超限主要来自工具/schema/system 这类不可压缩 prompt 面时，不允许 compaction 空转。

**文件**: `packages/opencorvus/src/session/loop.ts`

**改动**:

- 在 context diagnostics 中拆分 `compressibleMessageChars` 与 `nonCompressiblePromptChars`。`nonCompressiblePromptChars` 至少包含 system prompt、tool schema payload、provider-required tool metadata；`compressibleMessageChars` 只包含 compaction 能实际缩减的历史消息内容。
- 当 `totalTokensEst > limit` 且 `compressibleMessageChars` 不足以把请求压回预算内时，不创建 compaction task。
- `assistantMsgCount === 0` 只是 context-cold 的强信号，不是唯一判定条件。第一轮如果只是用户贴入了超大需求文本，必须根据它是否可被当前 compaction 实现压缩来决定，不得用 assistant count 一刀切。
- 抛出明确错误，例如 `PromptBudgetOverflowError`，错误 payload 包含：
  - `systemTokensEst`
  - `messagePayloadChars`
  - `toolSchemaChars`
  - `compressibleMessageChars`
  - `nonCompressiblePromptChars`
  - `usableBudget`
  - `limit`
  - `toolNames`
- 当 `toolSchemaChars` 单独超过可用预算阈值时，抛 `ToolSchemaBudgetError`，由调用方直接失败而不是 retry。
- 阈值放入配置，默认值可以先用 `0.5`，但不能硬编码在散落逻辑里。

**测试**:

- `assistantMsgCount=0`、且 tools/system alone 已经让请求不可压回预算内时，断言不调用 `SessionCompaction.create()`。
- 第一轮用户消息很大但可由现有 compaction 实现压缩时，不能因为 `assistantMsgCount=0` 直接 fail-fast。
- 有历史 assistant message 且超限时，仍允许 compaction。
- 工具 schema 单独超阈值时，断言 fail-fast。

**验收**:

- 不再出现 step 1 `predictive-compaction-triggered`。
- deterministic budget overflow 不进入外层 3 次 retry。

### 阶段 D: 修 StructuredOutput miss 信号层

**目标**: 模型结束一轮但没有调用 `StructuredOutput` 时，统一进入 structured-output recovery 通道。

**文件**: `packages/opencorvus/src/session/loop.ts`

**注意**: 原方案里的伪代码不可用：

```ts
processor.message.parts.some(...)
```

`processor.message` 是 assistant message info，不带 parts。正确实现必须从持久化 parts 读取，例如 `Message.parts(processor.message.id)`，或让 processor 在 tool-call 边界记录本轮工具名。

**改动**:

- 在 `format.type === "json_schema"` 且本轮结束后读取本轮 parts。
- 如果本轮以 `stop`、`length`、`content-filter` 等非 tool-call 原因结束，且没有完成状态的 `StructuredOutput` tool part，stamp `StructuredOutputError`。
- 如果本轮以 `tool-calls` 结束且只调用了工作工具，不 stamp `StructuredOutputError`；这表示 agent 仍在执行流程，不能把正常工具链误判成 structured miss。
- 对 `stop`、`length`、`content-filter` 等非 tool-call 结束原因进入 reminder。
- 对 provider/runtime error 不伪装成 structured miss；保留原始 error，让 retry 层按错误类型处理。

**测试**:

- 模型只输出文本并 `finish=stop`，断言 stamp `StructuredOutputError` 并注入 reminder。
- 模型 `finish=length` 且未调 `StructuredOutput`，断言进入同一通道。
- 模型 `finish=tool-calls` 且只调用普通工作工具，断言不 stamp `StructuredOutputError`。
- 模型完成 `StructuredOutput` tool call，断言不 stamp error。

### 阶段 E: provider hard-pin 验证与 stream 入口清理

**目标**: 证明 `{ type: "tool", toolName: "StructuredOutput" }` 在生产 provider 上真实生效，并消除类型漂移。

**文件**:

- `packages/opencorvus/src/session/llm.ts`
- `packages/opencorvus/src/provider/llm.ts`
- 新增 provider integration test

**改动**:

- `ProviderLLM.StreamInput.toolChoice` 与 `LLM.StreamInput.toolChoice` 使用同一个 exported type。
- 如果 `ProviderLLM.stream()` 当前无调用方，要么删除该 stream 入口，要么让 `LLM.stream()` 复用它；不能继续保留两个不一致的 streamText 调用定义。
- 新增 E2E provider probe：注册 `target` 和 `useless_work`，设置 `toolChoice={type:"tool", toolName:"target"}`，断言只调用 `target`。
- provider probe 必须以环境变量显式开启，例如 `OPENCORVUS_PROVIDER_E2E=1`，且只在对应 provider credentials 存在时运行；普通 unit test 和默认 CI 不依赖真实 provider。

**禁止项**:

- 不实现 `activeTools` fallback。
- provider 不支持 hard-pin 时，不静默换成另一套收缩工具策略。
- 对 StructuredOutput 强约束 agent，provider 不满足 capability 应直接失败并提示模型配置不合格。

**验收**:

- 类型层只有一个 tool choice 定义。
- provider probe 明确记录支持/不支持。
- 不引入黑盒降级路径。

### 阶段 F: 外层 retry 只处理可恢复失败

**目标**: 外层 retry 不重复执行 deterministic failure。

**文件**: `packages/opencorvus/src/agent/runner.ts`

**改动**:

- `isComplete` 可以返回 typed failure object，例如 `StructuredOutputMissingError` / `PromptBudgetOverflowError` / `ToolSchemaBudgetError`。如果需要 `failureKind`，它只能是 typed error 的派生字段，不能成为新的字符串状态机。
- failure object 只能用于决定是否停止 retry，不用于创建多套执行策略。
- `tool-schema-budget`、`prompt-budget-overflow`、`compaction-useless` 直接 fail-fast。
- `missing-structured` 优先交给 in-session reminder/hard-pin 处理；外层 retry 只保留给 session stream error 或明确 transient provider error。

**测试**:

- deterministic budget error 不重试。
- transient stream error 仍按现有 retry 规则重试。
- `missing-structured` 在 inner recovery 耗尽后只返回明确错误，不再盲目创建 3 个等价 session。

### 阶段 G: 仅在重测超阈值时重构 integrity schema

**目标**: schema 重构必须由 current HEAD 的 normalized measurement 驱动。

**触发条件**:

- current HEAD 下 normalized `toolSchemaChars` 超过 configured threshold。
- 或 provider probe 证明某 provider 对当前 tool schema 明显不可用。

**可选改动**:

- 拆分 `submit_<dim>_verdict` 为更小的 per-dimension issue/correction/missing-goal 工具。
- 如果拆分，删除旧的 `submit_<dim>_verdict`，不能保留双路提交。

**明确拒绝旧方案中的 `$ref` 主路径**:

- OpenAI-compatible tool call 是每个 function 独立的 `parameters` schema。
- 跨工具共享 `$defs` 没有通用协议保证。
- 把 `$defs` 内联到每个工具并不能消除跨工具重复。
- 因此 `$ref` 只能作为 provider-specific 实验，不作为系统性修复主线。

## 5. 实施顺序

| 顺序 | 改动 | 验收 |
|---|---|---|
| 1 | 阶段 A: provider-normalized schema estimator | 单测证明不再 stringify Zod 内部结构 |
| 2 | 阶段 B: compaction continue 继承 `format/system/tools` | compaction 后工具列表仍含 `StructuredOutput` |
| 3 | 阶段 C: context-cold / non-compressible fail-fast | 不可压 prompt 面超限时不再 compact |
| 4 | current HEAD integrity-only benchmark | 重新获得可信 `toolSchemaChars` 与 attempts 数据 |
| 5 | 阶段 D: StructuredOutput miss stamp | 文本/length miss 都进入 reminder |
| 6 | 阶段 E: provider hard-pin probe + stream 类型单源 | toolChoice object form 被真实验证 |
| 7 | 阶段 F: retry fail-fast | deterministic failure 不重复 3 次 |
| 8 | 阶段 G: schema 重构 | 仅在重测超阈值时执行 |
| 9 | build surface 等价验收 | live build session 在 goal #1 (extract-and-analyze-tradingview) 上能在合理时间内调用 `merge_back` 并 `StructuredOutput` 终结，`summary_additions/files` 收敛、`beginBuildAttempt` 不再循环 |

## 6. 最终验收

- 任何引用 live SQLite 快照的 build surface 证据，都必须附带可重放 SQL query 和导出 artifact；没有 artifact 时不得作为验收结论。
- current HEAD 的 integrity reviewer 第一轮不会因为虚高 `toolSchemaChars` 触发 predictive compaction。
- 如果确实预算超限，系统 fail-fast 并输出预算 breakdown，不创建无意义 compaction。
- auto compaction 后继续轮仍有 `StructuredOutput`、stage `system` 和原工具启用面。
- `submittedDimensions=none` 不再由 “StructuredOutput 工具不存在” 或 “cold compaction 空转” 导致。
- 完整 `ainvest` benchmark 中 integrity reviewer 不再出现 3 次等价 retry storm。
- build surface（在 live task `tsk_dd200fc58001606QiIAbsibN5r` 重跑或同等 ainvest goal）同样不出现：73 秒 compaction、never-finalize、外层 `beginBuildAttempt` 反复重启。build session 必须在合理时间内提交 `merge_back` + `StructuredOutput` 才视为通过。

## 7. 从旧方案删除或降级的内容

- 删除 `$ref` 作为第一优先级的 schema 瘦身方案；它缺少跨工具共享协议保证。
- 删除 `activeTools fallback`；provider 不支持 hard-pin 时应明确失败，不做静默降级。
- 删除 “最近 5 个 commits 都未解决” 的断言；旧 benchmark 不能证明 current HEAD。
- 删除 `processor.message.parts` 伪代码；实现必须读取真实 message parts 或由 processor 记录本轮工具调用。
- 降级 `ProviderLLM.stream` 合并优先级；它是架构清理，不是该 benchmark 的第一根因。

## 8. Out of Scope

- 不在本方案中替换默认模型。
- 不迁移数据库。
- 不为某个 provider 写兼容分支。
- delivery agent 自身的工具 schema 重构不在本方案范围；如出现同形态失败，需要先按阶段 A 的 normalized measurement 重测，再单独立项。
- build surface 不属于 out-of-scope：阶段 A–F 的所有改动都在 session 层共享路径上，build/integrity 均会受益；本方案验收必须同时覆盖两个 surface（见第 6 节）。
- build agent 自身的工具集重构不在默认范围。只有阶段 G 的 measurement threshold 命中，且证据证明问题来自 build agent 工具集本身，而不是共享 session 层预算/compaction/retry 缺陷，才单独启动 build schema 重构。
