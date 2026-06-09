# Agentic Loop

Executor 内部是一个**标准的 agentic loop**：LLM 出 tool-call → 工具执行 → 结果回填 → 下一轮。本页讲清这个循环的三个状态、关键约束，以及它与 Orchestrator 外层 Task Loop 的接缝。

## 三个状态

`SessionLoop`（`packages/opencorvus/src/session/loop.ts:62`，namespace）在任何时刻都处于以下三态之一：

| 状态          | 含义                                         | 退出条件            |
| ------------- | -------------------------------------------- | ------------------- |
| **standby**   | assistant 已回 `finish`，等用户下一条消息    | 收到新 user message |
| **tool-call** | LLM 要求调工具，正在执行                     | 所有 tool 执行完毕  |
| **subtask**   | 当前消息发起了一个子任务（嵌套 SessionLoop） | 子任务完成          |

进入 standby 的判定：扫描最后一对 user/assistant 消息，assistant 的 `finishReason !== "tool-calls"` 且 user 无新消息 → standby。

## 工具路由

LLM 返回的每个 tool-call 由 `session/loop.ts` 内的 `resolveTools()`（`session/loop.ts:1732`）路由——历史上的 `SessionToolResolver` 类 / `session/tool-resolver.ts` 文件已不存在，工具解析逻辑合并进了 SessionLoop 本身。

1. **过滤**：按 `input.tools` 白名单挑选，避免 30+ 工具全量发给 DashScope。
2. **权限检查**：走 `PermissionNext.ask()`（见 [Permissions](../opencorvus/permissions.md)）。
3. **执行**：调对应 tool handler。
4. **结果回填**：以 `tool-result` part 写回 session messages。

## 子任务

子任务由 `TaskTool`（`tool/task.ts`）发起，在 SessionLoop 内递归进入新的 SessionLoop。这让 agent 可以多层嵌套：主 agent → 研究子 agent → … → 执行工具。

每个 sub-agent（requirements / architect / build / integrity / …）也是通过 `agent/runner.ts:runAgentSession` 起一条新 SessionLoop 跑完；它们的 SessionKind 在 creation time 固定（见 [SessionKind 列表](../../../specs/new-arch/02-data.md#session-域5-表)）。

## 外层 Task Loop 如何触发 SessionLoop

外层 `runTaskLoop`（`orchestrator/loop.ts:117`）通过 Orchestrator LLM 调 `build` tool，build tool 的执行体是 `goal/runner.ts`，runner 在独立 git worktree 内通过 `executor/registry.ts` 选中的 executor（OpenCorvus / Codex / Claude Code）启动 build session：

```
Orchestrator.runTaskLoop                                  orchestrator/loop.ts:117
  └─ Orchestrator LLM 调 build tool                       orchestrator/tools.ts
      └─ goal/runner.ts （worktree + executor）           goal/runner.ts
          └─ executor (claude-code / codex / opencode)    executor/*.ts
              └─ build SessionLoop                        session/loop.ts
```

> **OpenCorvus 只是 opencode 这个 executor 的品牌名**（commit `b85ff20d4`），代码实体名仍是 `OpencorvusExecutor`（`executor/opencode.ts`）。`opencode` / `opencorvus` 都可作为 executor id 在 `--executor=` flag 或 `executor.discover` 配置中使用。

## 关键约束

### 1. 必须 `streamText`，不能 `generateText`

`session/llm.ts::LLM.stream` 使用 Vercel AI SDK 的 `streamText`。**不能改成 `generateText`**，否则 reasoning 模型（DashScope 的 qwq / claude reasoning / glm reasoning 等）会在等待 reasoning tokens 时超时。

### 2. `toolChoice: "auto"`

reasoning 模型必须用 `toolChoice: "auto"`，不能用 `"required"`。用 required 时模型会把 reasoning tokens 挤占 tool-call 名额，导致格式错乱。

### 3. 无活动超时，不是总时长超时

Tool 调用超时必须是"无输出后的真实超时"，不能从启动时刻机械计时。长时间跑 build / test 的 tool 调用是合法的，只要 stdout/stderr 还在流。`OPENCORVUS_TOOL_TIMEOUT_MS` 控制的是**无活动超时**。Engine 内部对 LLM stream 同样维护一个独立的 stream-activity 看门狗（180s idle abort）。

### 4. Tool-call 结果必须结构化

所有 tool 返回的 `output` 字段是 **JSON 字符串**（不是对象）。消费者需要自己 `JSON.parse`，parse 失败 → let it crash，不静默兜底。

### 5. Build agent 共享 sub-agent 协议

build / intent-analysis / requirements / architect / frontend-design / integrity / prosecutor / acceptance 共用 `agent/sub-agent-protocol.ts` 的结构化输出契约（Zod tool call），结果写入 `engine_artifact`。

## Doom-loop 检测

`session/processor.ts` 在每次工具调用后回看最近的工具 part：当同一工具以**完全相同的入参连续调用 `DOOM_LOOP_THRESHOLD`（= 3）次**时，判定为 doom-loop，通过 `PermissionNext.ask({ permission: "doom_loop" })` 拦截该工具调用，交由 agent 的 permission ruleset 决定放行 / 拒绝——防止 agent 在死循环里烧预算。

## Trace 与 Bus

每条 LLM 调用、tool call / result、agent 边界都会写入 `AgentTrace`（`src/trace/`，JSONL 落到 `<dir>/.opencorvus/trace/<sessionID>.jsonl` 与 `_task-<taskID>.jsonl`）并同时通过 `Bus.publish` 广播到 overlay SSE。Agent 代码不手工调 trace，自动埋点在 `session/llm.ts::LLM.stream` + `agent/agent.ts::Agent.generate` + `agent/runner.ts::runAgentSession` + `orchestrator/agent.ts::Orchestrator.processTask`。

## 你接下来要看的

- [架构总览](./architecture.md)
- [Acceptance 检查与判决](../opencorvus/evaluator.md)
- [Permissions](../opencorvus/permissions.md)
