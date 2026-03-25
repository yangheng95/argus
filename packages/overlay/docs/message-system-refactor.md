# 消息系统重构方案：对齐 OpenCode 模式

> **状态**: 已实施（2026-03-25）
> **改动文件**: `packages/overlay/src/app.js`（净删 486 行）, `packages/overlay/src/workspace.js`
> **语法验证**: node --check + terser 均通过

## 目标

将 overlay 消息面板从「SSE + 轮询降级 + 序号追踪 + 快照合并 + 文字动画」五层嵌套架构，
简化为 OpenCode 的「一次性全量加载 + SSE 纯增量 + 16ms 批量刷新」模式。

## 验收标准

1. 选择 task 后消息正常显示（初始加载）
2. LLM 流式输出实时展示（delta 事件）
3. tool call 参数实时展示（raw delta）
4. SSE 断线后自动重连 + 全量重新加载，消息不丢失
5. 切换 task 时旧消息清空、新消息正确加载
6. board/task 状态事件正常触发 UI 更新
7. 无任何 fallback 逻辑、无轮询定时器、无序号追踪
8. 高频 delta 事件不卡顿（16ms 批量合并生效）

## 数据流（改造后）

```
选择 Task
  → syncTask(taskID): GET /transcript → 写入 messageStore → renderConversation()
  → startSSE(taskID): 连接 SSE 流

SSE 事件到达
  → enqueueEvent(event): 推入 eventQueue
  → 16ms 内合并后 flushEvents()
    → applyEvent(): 二分查找 + 直接修改 messageStore
    → 有变更 → renderConversation()

SSE 断线
  → 3s 后 syncTask() 全量重新加载 + startSSE() 重连

切换 Task
  → stopSSE() → 清空 messageStore → syncTask(new) + startSSE(new)
```

## 删除清单

### 常量
- `POLL_INTERVAL` (4000)
- `CONVERSATION_POLL` (6000)
- `SSE_BACKSTOP` (15000)

### 文字动画层（全删）
- `liveTextStreams` Map
- `LIVE_TEXT_INTERVAL`, `LIVE_TEXT_MIN_CHUNK`, `LIVE_TEXT_MAX_CHUNK`
- `startLiveText()`, `stopLiveText()`, `clearLiveTextStreams()`
- `advanceLiveText()`, `liveTextChunk()`, `messageLiveTextKey()`
- `streamMessagePart()`, `hydrateLivePart()`
- `pruneConversationLiveText()`
- part 上的 `_targetText`, `_targetOutput` 字段

### 快照合并层（全删）
- `mergeConversationSnapshot()`
- `mergeSnapshotMessage()`, `mergeSnapshotParts()`, `mergeSnapshotPart()`
- `mergeSnapshotFieldTarget()`, `shouldPreserveSnapshotLiveText()`
- `cloneMessages()`, `stashPendingTaskMessages()`
- `state.pendingTaskMessages`

### 轮询层（全删）
- `startPolling()`, `stopPolling()`
- `state.pollTimer`, `state.conversationTimer`
- `scheduleConversation()`, `state.conversationKick`, `state.conversationQueued`
- `state.conversationBootstrapPending`
- `state.conversationLoading`

### 序号追踪（全删）
- `acceptEventSequence()`, `repairEventGap()`
- `eventSequence()`, `boardSequence()`
- `state.taskSequence`

### 变更检测
- `conversationChanged()`（事件驱动后不需要比对）

## 新增清单

### 1. messageStore（归一化存储）
```javascript
const messageStore = {
  messages: [],     // MessageInfo[]，按 time.created 排序
  parts: {},        // { [messageID]: Part[] }
  synced: false,
};
```

### 2. binarySearch（二分查找）
```javascript
function binarySearch(sorted, id, getId) {
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midId = getId(sorted[mid]);
    if (midId === id) return { found: true, index: mid };
    if (midId < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return { found: false, index: lo };
}
```

### 3. syncTask（一次性全量加载）
- GET /task/{taskID}/transcript
- 写入 messageStore.messages + messageStore.parts
- 排序，标记 synced=true
- 调用 renderConversation()

### 4. 16ms 事件批量合并
```javascript
let eventQueue = [];
let flushTimer = null;
let lastFlushTime = 0;
const FLUSH_INTERVAL = 16;

function enqueueEvent(event) { ... }
function flushEvents() { ... }
```

### 5. applyEvent（事件应用）
- message.updated → 二分查找 → 插入或更新 messageStore.messages
- message.part.updated → 二分查找 → 插入或更新 messageStore.parts[messageID]
- message.part.delta → 二分查找 → 直接字符串追加（无动画）
- 非消息事件 → 保留现有的 board/task 事件分发逻辑

### 6. SSE 简化
- 删除序号追踪
- 事件入队（enqueueEvent）而非直接处理
- 断线后 3s 延迟 → syncTask() + startSSE()
- 无指数退避（固定 3s 重连间隔）

## board/meta 处理

board 更新改为纯 SSE 事件驱动：
- task.updated/run.*/plan.*/goal.*/delivery.*/evaluation.* → loadBoard()
- loadMeta() 在 syncTask() 时调用一次
- SSE 重连后 syncTask() 内顺带刷新 board + meta

## 改动范围

仅 `packages/overlay/src/app.js` 一个文件。

## 实施步骤

1. 新增 messageStore + binarySearch + enqueueEvent + flushEvents + applyEvent + syncTask
2. 改造 startSSE：删除序号追踪，事件入队，简化重连
3. 改造 selectTask 入口：调用 syncTask + startSSE
4. 改造 renderConversation 数据源：从 messageStore 组装
5. 删除：动画层全部代码
6. 删除：快照合并全部代码
7. 删除：轮询全部代码
8. 删除：序号追踪全部代码
9. 删除：conversationChanged、scheduleConversation 等辅助函数
10. 验证：启动应用，验证全部验收标准
