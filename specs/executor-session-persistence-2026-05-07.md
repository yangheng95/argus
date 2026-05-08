# Executor Session Persistence 方案

**日期**: 2026-05-07
**状态**: 实施中
**触发**: live task 重试时 external build agent/native provider context 丢失；用户要求先按既有架构修内部和外部执行器的 session 持久化，不继续调整 `merge_back` 工具边界。

## 0. 术语

- LLM: Large Language Model，大语言模型。
- SDK: Software Development Kit，外部 provider 的官方/本地执行接口。
- DB: Database，数据库。
- native session id: provider 自己的会话 id，例如 Codex app-server 的 `thread:turn`、Claude SDK 的真实 `session_id`。
- logical session id: OpenCorvus 的 `session.id`。

## 1. 已查证现状

### 1.1 内部执行器

`mirrorcode` 走 `OpencodeExecutor` / `SessionPrompt`：

- logical session id 本身就是执行入口。
- messages / parts / compaction 都已落 DB。
- `resume({ sessionID, message })` 会继续同一个 logical session。

内部执行器的问题不是 native id 丢失，而是需要明确 pin：即使 executor adapter 重建，`resume` 仍用同一个 logical session，不依赖内存 map。

### 1.2 外部执行器

`ManagedCodingExecutor` 为 `codex` / `claude-code` 维护内存 `tasks` map：

- `State.externalSessionID` 从 provider stream 的 `done.sessionID` 或 event meta 里提取。
- `resume` 只从上一条内存 `State` 继承 `externalSessionID`。
- 进程重启、adapter 重建、或直接走 BuildAgent external path 时，这个 native id 没有单源持久化。

`BuildAgent.runWithExternalProviderImpl` 绕过 `ManagedCodingExecutor`，直接 `provider.run(...)`：

- 创建 OpenCorvus build session。
- provider stream 的 native session id 只存在于 event/meta 或局部变量。
- 没写入 `Session.metadata`，所以后续无法稳定 resume。

仓库已有 `Session.metadata`，并有 `Session.mergeMetadata()` 原子合并能力；这是当前最小、无需 DB migration 的持久化点。

## 2. 根因

外部 provider 的 native session id 只存在于进程内存和事件流中，没有被提升为 logical session 的持久属性。

因此，系统虽然有 logical session transcript，但缺少“这个 logical session 对应 provider 哪个 native thread/session”的 durable mapping。重试或进程重启后只能新开 provider session。

## 3. 单源设计

把 executor session refs 持久化到 `Session.metadata.executor`：

```ts
{
  executor: {
    provider: "codex" | "claude-code" | "mirrorcode",
    native_session_id?: string,
    thread_id?: string,
    turn_id?: string,
    updated_at: number
  }
}
```

规则：

- logical session 的 durable mapping 单源是 `Session.metadata.executor`。
- event/part metadata 可以继续记录 provider raw facts，但不作为 resume 真源。
- `ManagedCodingExecutor` 的内存 `State.externalSessionID` 只是缓存，必须从 `Session.metadata.executor` 恢复。
- `BuildAgent` external path 收到 provider native session id 时必须写 `Session.metadata.executor`。
- `mirrorcode` 写 provider=`mirrorcode`，native_session_id 不需要。

## 4. 实施范围

### 4.1 新 helper

新增 `packages/opencorvus/src/executor/session-ref.ts`：

- `extractExecutorSessionRef(event)` 从 `CodingEventInfo` 里提取：
  - `event.sessionID`
  - `event.meta.session_id`
  - `event.meta.thread_id + event.meta.turn_id`
  - `event.meta.threadId + event.meta.turnId`
- `persistExecutorSessionRef({ sessionID, provider, ref })`
- `readExecutorSessionRef(sessionID)`

### 4.2 ManagedCodingExecutor

- `submit` 启动时写 provider metadata。
- stream 消费中每次发现 native ref，写入 session metadata，同时更新内存 cache。
- `resume` 如果内存没有 `externalSessionID`，从 `Session.metadata.executor.native_session_id` 读取。
- 若 provider 是 `mirrorcode`，不需要 native id；若是 external 且 metadata 无 native id，按 provider.run 新开仍可执行，但必须保持显式事实，不伪装成 resume。

### 4.3 BuildAgent external path

- `provider.run` event loop 中发现 native ref 后写入 build session metadata。
- `runInput.sessionID` 继续是 logical session id，不改现有 provider API。
- 本 PR 不把 build retry 改成自动 resume；只先把可 resume 的 native ref 持久化，供后续 session reuse 使用。

### 4.4 内部执行器 pin

- 给 `OpencodeExecutor.resume` 加测试：adapter 重建后仍能基于 same logical session 追加消息。
- 不引入第二 native session id。

## 5. 测试

- `test/executor/session-ref.test.ts`
  - Codex `thread_id/turn_id` → `native_session_id = thread:turn`
  - Claude `session_id` → native id
  - empty meta → undefined

- `test/executor/managed-session-persistence.test.ts`
  - provider emits native id on run → `Session.metadata.executor.native_session_id` persisted
  - new `ManagedCodingExecutor.create(...)` instance resumes same logical session using metadata native id

- `test/executor/opencode-session-persistence.test.ts`
  - internal resume uses same logical session and does not require native id

## 6. 验收

- external provider native session id survives adapter recreation.
- external resume uses persisted native id when memory cache is gone.
- build external session writes provider/native refs into `Session.metadata`.
- internal mirrorcode resume remains logical-session based.
- No DB migration.
- No fallback retry or host-generated synthetic conversation.

