# Rewind 统一入口重构方案

> 目标：用户的“回到这一步”只有一条 API 路径：`POST /task/:taskID/rewind`。
> 是否同时回滚 worktree 由调用方显式传入 `resetWorktree`。
> 删除 `SessionRevert.revert / unrevert / cleanup`、删除 `POST /session/:id/revert` 与 `/unrevert`、删除 `session.revert` JSON 列。
> `packages/opencorvus/src/engine/rewind.ts` 是 rewind 唯一实现位置。

## 0. 适用范围

- `packages/opencorvus/src/{session,engine,server/routes,storage,task-api,orchestrator,cli}`
- `packages/overlay/src/{components,services,store,i18n}`
- `packages/sdk`
- `packages/opencorvus/test` 与 `packages/opencorvus/script/benchmark`
- Memory 文档

不动 Snapshot 子系统的语义：前一阶段已经确认 `Snapshot.restore = patch + revert`，且 `cleanup/init` 已删除。
不动 Project / ProjectGC：它们与 rewind cursor 投影正交。

## 1. 已确认现状

### 1.1 双入口

| 入口 | 实现 | 数据落点 | 删数据 | 动文件 |
|---|---|---|---|---|
| `POST /session/:id/revert` | `SessionRevert.revert` | `session.revert` JSON 列 | 否，lazy 标记 | 是，`Snapshot.revert(patches)` |
| `POST /session/:id/unrevert` | `SessionRevert.unrevert` | 清 `session.revert` | 否 | 是，`Snapshot.restore(session.revert.snapshot)` |
| `POST /task/:taskID/rewind` | `rewindTask` | `engine_task.rewind_cursor_*` | 否 | 否 |
| `POST /task/:taskID/rewind/clear` | `clearRewindCursor` | 清 `engine_task.rewind_cursor_*` | 否 | 否 |

### 1.2 `SessionRevert.cleanup` 调用点

- `packages/opencorvus/src/session/prompt/index.ts`
- `packages/opencorvus/src/session/prompt/shell.ts`
- `packages/opencorvus/src/session/shell-exec.ts`
- `packages/opencorvus/src/server/routes/session.ts`

新模型下不再删除 message/part 行；清理点只能清 task rewind cursor，不能物理删消息。

### 1.3 TUI 依赖

必须纳入本次改造，不能漏：

- `packages/opencorvus/src/cli/cmd/tui/routes/session/dialog-message.tsx` 调用 `sdk.client.session.revert`
- `packages/opencorvus/src/cli/cmd/tui/routes/session/index.tsx` 调用 `session.revert`、`sdk.client.session.revert/unrevert`，并渲染 redo/revert UI

### 1.4 既有可复用关系

- session 表没有 `task_id`。
- `taskIDForSession(sessionID)` 已能从 parent 链反查 task。
- `sessionIDsForTask(taskID)` 已能列出一个 task 的 root + 子 session。
- 不新增重复的 `Session.listByTask`，除非实施中发现现有函数无法满足 typed API。

### 1.5 投影缺口

`Session.messages()` 当前返回 raw message 历史；overlay 的 task conversation route 已按 task cursor 过滤，但 session API、TUI sync、export/stats/coding route 仍直接读 `Session.messages()`。

本次必须明确 raw / projected 边界：

- task conversation / overlay 使用 task-level projected view。
- TUI session view 删除 `session.revert` UI 后，不再展示 lazy revert 状态。
- session raw API 不隐式按 task 投影，避免 standalone session 被错误过滤。
- 任何需要 task 投影的读取必须显式传入 taskID 或使用 task 专用 API。

## 2. 约束

| 规则 | 约束 |
|---|---|
| 7 | 不留 fallback：`SessionRevert` 不能保留为兼容别名 |
| 8 | 不留双源：旧 session revert 路径必须删除 |
| 10 | `resetWorktree` 必填，无默认 |
| 16-17 | 未发布项目，直接删旧路径；废弃代码先识别并在方案记录 |
| 18 | schema 变更后 reset DB，不写迁移 |
| 28 | 正确行为写入测试 |
| 33 | commit + push 走 hook；若工作区含他人未提交改动，只 stage 本次相关文件 |

## 3. 新 API

```ts
export const RewindTaskInput = z.object({
  taskID: Identifier.schema("task"),
  anchor: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("cursorTime"),
      cursorTime: z.number().int().nonnegative(),
      anchorEventID: z.string().optional(),
    }),
    z.object({
      kind: z.literal("message"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
      partID: Identifier.schema("part").optional(),
    }),
  ]),
  resetWorktree: z.boolean(),
  reason: z.string().optional(),
})
```

`RewindTaskResult`：

```ts
{
  taskID: string
  cursorTime: number
  rewindCount: number
  resetWorktree: boolean
  anchorKind: "cursorTime" | "message"
}
```

路由：

- 删除 `POST /session/:sessionID/revert`
- 删除 `POST /session/:sessionID/unrevert`
- 改造 `POST /task/:taskID/rewind`，body 为 `RewindTaskInput.omit({ taskID: true })`
- 保留 `POST /task/:taskID/rewind/clear`，文档说明它只清投影 cursor；若上一次 rewind 回滚了文件，clear 不恢复文件

## 4. 后端实现

### 4.1 `engine/rewind.ts`

唯一实现位置：

```ts
export const RewindTaskInput = ...
export async function rewindTask(input: RewindTaskInput): Promise<RewindTaskResult>
async function applyWorktreeReset(input): Promise<void>
async function collectPatchesAfterCursor(taskID, cursorTime): Promise<Snapshot.Patch[]>
async function collectPatchesFromMessageAnchor(sessionID, messageID, partID?): Promise<Snapshot.Patch[]>
export async function clearRewindCursor(taskID): Promise<void>
export function applyRewindCursor<T>(taskID, events): T[]
export function taskRewindCursor(taskID): number | null
```

主流程：

1. 查 task；缺失直接报错。
2. 解析 anchor：
   - `cursorTime`：使用输入 cursorTime。
   - `message`：读取 message row 的 `time_created`，作为 cursorTime。
3. 若 `resetWorktree:true`：
   - 调用 task loop interrupt + settled wait，不使用 `EngineService.cancelTask`，因为 cancel 会把 task 写成 `cancelled`。
   - 收集 patches：
     - `cursorTime`：`sessionIDsForTask(taskID)` 下所有 PatchPart，`part.time_created > cursorTime`，按 `time_created asc` 传给 `Snapshot.revert`。PatchPart 记录的是每一步编辑前的 snapshot，最早一个被隐藏 patch 的 hash 才是 cursor 处应恢复到的状态。
     - `message`：只处理指定 session，从 anchor message/part 之后的 patch，同样按 `time_created asc`。
   - `Snapshot.revert(patches)`。
   - 按 session 分组计算 diff，分别写 `session_diff/<sessionID>.json` 并 emit `Session.Event.Diff`。不把多 session diff 塞进单一 session。
4. 写 task row：`rewind_cursor_time`、`rewind_cursor_event_id`、`rewind_count++`。
5. emit `task.rewound`，包含 `resetWorktree` 与 `anchorKind`。

### 4.2 loop 中止

已有 `interruptTaskLoop(taskID)`，但没有公开 settled wait。新增一个最小 API：

```ts
interruptTaskLoop(taskID, reason)
awaitTaskLoopIdle(taskID, idleTimeoutMs)
```

超时是“无活动后的真实超时”：等待期间每次状态变化刷新 idle deadline，不能从函数启动时机械计时。

禁止用 `EngineService.cancelTask` 代替，因为它改变 task 终态。

### 4.3 清 cursor

旧 cleanup 调用点改为：

1. `const taskID = taskIDForSession(session.id)`
2. 找不到 taskID 则跳过 standalone session；不得创建 fallback revert 逻辑。
3. 找到后调用 `clearRewindCursor(taskID)`。

## 5. 数据库 schema

删除：

- `session.revert` 列
- `Session.Info.revert`
- `Session.setRevert`
- `Session.clearRevert`

新增索引：

- `message_session_time_idx(session_id, time_created)`
- `part_session_time_idx(session_id, time_created)`

DDL 与 drizzle schema 同步。按项目规则 reset DB；已有命令是 `opencorvus db reset`，不新增重复脚本。

## 6. CLI / TUI

删除 TUI 的 session revert/redo UI 与命令：

- `session.undo` 不再调用 `session.revert`；若要保留“把上一条用户消息放回输入框”，只能作为纯 prompt 操作，不修改后端状态，不改文件。
- 删除 `session.redo` 对 `session.unrevert` 的依赖。
- 删除 `revertInfo/revertMessageID/revertDiffFiles/revertRevertedMessages` 渲染。
- `DialogMessage` 的 `Revert` action 改为在有 taskID 时调用 `task.rewind`；没有 taskID 时不显示该 action。

## 7. Overlay

- `CardHeader` 的 rewind 确认从 `window.confirm` 改为双按钮 UI。
- `Card.tsx` 调用 `task.rewind` 时必须传新 anchor shape 与 `resetWorktree`。
- `task.rewound` SSE 读取 `resetWorktree`；为 true 时刷新 `snapshotVersion`，让 ChangesPanel 重新读取 diff。
- 文案改成“回到这一步”，避免“这张卡片之前”和 `time <= cursorTime` 语义冲突。

## 8. SDK / 文档

- 重新生成 OpenAPI 与 SDK。
- 删除 `client.session.revert` / `client.session.unrevert`。
- `client.task.rewind` 输入包含 `anchor` 与必填 `resetWorktree`。
- docs baseline 同步。

## 9. 测试与 benchmark

### 单元测试

新增：

- `test/engine/rewind-multi-step.test.ts`
  - `message + resetWorktree:true`
  - `message + resetWorktree:false`
  - `cursorTime + resetWorktree:true`
  - `cursorTime + resetWorktree:false`
- `test/engine/rewind-clear.test.ts`
  - prior false：clear 后 cursor 为 null。
  - prior true：clear 后 cursor 为 null，文件不恢复。

删除：

- `test/session/revert-compact.test.ts`
- `test/session/revert-multi-step.test.ts`

### Benchmark

新增 `packages/opencorvus/script/benchmark/rewind-checkpoint-benchmark.ts`：

- 输入：N 步 message + PatchPart + 文件变更。
- 输出：4 矩阵下 cursor 与文件状态符合预期。
- 超时：使用“无活动真实超时”，每次日志/阶段进度刷新 deadline。
- 验收：全部矩阵通过，不允许跳过失败样本。

### 验收命令

- `bun test packages/opencorvus/test/engine/rewind-*.test.ts packages/opencorvus/test/snapshot/snapshot.test.ts`
- `bun packages/opencorvus/script/benchmark/rewind-checkpoint-benchmark.ts`
- `bun packages/opencorvus/script/benchmark/snapshot-benchmark.ts`
- pre-push hook：typecheck / api:routes-check / docs:check / overlay i18n

## 10. Memory

- 本仓库当前没有已落盘的 `MEMORY.md` 或 `feedback_*.md` 索引文件；不得为本次改造凭空新增第二套 Memory 目录。
- 本文件作为本轮长期约束记录：rewind 只能保留 `POST /task/:taskID/rewind` 单一入口，禁止恢复 session-level revert/unrevert。
- 如果后续项目恢复 `MEMORY.md` / `feedback_*.md` 文件索引，再新增 `feedback_single_rewind_entrypoint.md` 并把本约束加入索引。

## 11. 实施顺序

1. 后端核心：`rewind.ts` schema、patch 收集、worktree reset、事件字段、loop idle wait。
2. 删除旧 session revert：route、schema、Session methods、`session/revert.ts`、cleanup 调用点。
3. DB schema：删除 `session.revert`，加 message/part time 索引。
4. CLI/TUI：移除 session revert/redo，必要处改 task rewind。
5. Overlay：双按钮和新 API body。
6. SDK/OpenAPI/docs regen。
7. 测试与 benchmark。
8. Memory 更新。
9. 验收与二次 review。

## 12. 二次 review 必须 grep

在 `packages/opencorvus/src`、`packages/opencorvus/test`、`packages/sdk`、`packages/overlay/src`、`packages/opencorvus/src/cli` 中：

- `SessionRevert` 零命中。
- `session.revert` / `session.unrevert` API 零命中。
- `sdk.client.session.revert` / `sdk.client.session.unrevert` 零命中。
- `Session.Info.revert`、`setRevert`、`clearRevert` 零命中。
- `/session/.*revert` route 零命中。

允许 `Snapshot.revert`、git 文档中的普通英文 revert、历史说明文档出现。
