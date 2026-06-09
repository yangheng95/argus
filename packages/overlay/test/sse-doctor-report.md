# SSE Doctor 诊断报告

## 测试环境

- Server: 编译后的 opencorvus.exe (dist)
- 模型: alibaba-cn/qwen3.5-plus (opencorvus.jsonc 配置)

## 诊断结果

### SSE 事件链路：✅ 正常

- SSE 连接成功
- task.created, task.updated 事件正常到达
- 事件格式正确（type, payload 字段完整）

### 消息事件：❌ 全零

- message.updated: 0
- message.part.updated: 0
- message.part.delta: 0

### 根因：ProviderModelNotFoundError

- task 创建后进入 spec 阶段，spec agent 调用 LLM 失败
- 错误: `Spec failed: spec agent failed: ProviderModelNotFoundError`
- 原因: 编译时的 models-snapshot.ts 与运行时 opencorvus.jsonc 的模型 ID 不匹配
- **task 秒失败，根本没进入流式输出阶段，所以不会有 message 事件**

### 结论

前端消息系统（applyMessageEvent、enqueueEvent、flushEvents）未收到过任何 message 事件，
无法验证流式刷新是否工作。需要先修复 LLM provider 配置使 task 能正常运行。

## 待验证（需要 LLM 正常工作后）

1. message.part.delta 是否到达前端
2. applyMessageEvent 是否正确累积 delta 文本
3. renderConversation 是否正确渲染
4. syncTask 是否会覆盖流式累积的文本（transcript 中 text="" 问题）
