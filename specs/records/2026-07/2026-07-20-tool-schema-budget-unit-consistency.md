# Tool Schema Budget Unit Consistency

## Recall

- 用户原始要求：修复 `Tool schema payload (56849 chars) exceeds 50% of model input budget (111616)` 的错误判定，并解释 compact 与工具输出/定义的边界。
- 验收指标：工具定义继续作为不可压缩输入计入预测预算；字符长度必须先转换为 token 估算再与 token 预算比较；56,849 字符相对 111,616 token 不得触发 50% 超限；真正超过 50% 的 Schema 仍须 fail-fast；错误消息与结构化日志同时暴露字符数和 token 估算。
- 硬约束：不降低阈值、不删除工具、不换模型、不增加 fallback/gate/状态机；不把历史工具输出和每轮工具定义混为一谈；保留结构性超限的 fail-fast 语义。
- 已读取资料：`AGENTS.md`、`packages/opencorvus/src/session/loop.ts`、`context-budget.ts`、`message.ts`、`util/token.ts`、`predictive-compaction-decision.test.ts`、`tool-payload-estimator.test.ts`、`runner-retry-classify.test.ts`。
- 全仓 grep：`toolSchemaChars` 的生产预算判断只在 `session/loop.ts::predictiveCompactionDecision`；错误结构由 `session/message.ts::ToolSchemaBudgetError` 定义；重试分类仅按错误类型 fail-fast；其他字符预算换算散落在同一 `loop.ts`，统一改用 `Token.estimateCharacters`。调用点逐项处理：预测判断改为 token 对 token；错误日志/载荷增加 `toolSchemaTokensEst`；总输入、系统、残余和可压缩消息换算改用同一估算器；既有 error-type 分类保持。
- 独立 Agent 反馈：本轮用户未要求新的独立 Agent；不创建额外委托链。

## 因果链

可观察现象是 56,849 字符的工具 Schema 被判定超过 111,616 token 预算的 50%。直接触发点是 `toolSchemaChars > usableBudget * ratio`。深层原因是左侧单位为字符、右侧单位为 token；同一请求总量路径已经使用约四字符一 token 的估算，单独的 Schema 阈值路径却漏掉转换。因此该分支将工具占用放大约四倍，产生假阳性；compact 无法改变工具定义这一设计事实本身没有错误。

## 实施方案

1. 在现有 `Token` 单一估算器增加按字符数量估算 token 的入口，并让字符串入口复用它。
2. `predictiveCompactionDecision` 先得到 `toolSchemaTokensEst`，再与 `usableBudget * ratio` 比较。
3. 保持既有 `ToolSchemaBudgetError` 持久化结构，避免无关的数据契约演进；错误文案与结构化日志明确两种单位。
4. 回归覆盖用户报告的 56,849/111,616 假阳性边界、真正超过 50% 的结构性超限，以及统一估算器。

## 验证

- `bun test packages/opencorvus/test/session/predictive-compaction-decision.test.ts packages/opencorvus/test/agent/runner-retry-classify.test.ts packages/opencorvus/test/session/compaction.test.ts --test-name-pattern "tool schema|ToolSchemaBudgetError|token estimate"`
- `bun test packages/opencorvus/test/session/tool-payload-estimator.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
