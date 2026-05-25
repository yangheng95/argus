# Spec 2：Assistant Right-Panel UI（v3，含 codex 三审修订）

> 日期：2026-05-25
> 修订：
> - v2 — 整合 codex 二审 must-fix（`_codex_spec_review_round2.log`）
> - v3 — 整合 codex 三审（3b）must-fix（`_codex_spec_review_round3b.log`）
> - **v3.1** — 整合 codex 四审 cleanup（`_codex_spec_review_round4.log`）：前置依赖指向 Spec 1 v3、events URL 加 `after_live_epoch`、§4.5 `interaction.resolved` 明确仅 GET events 来源
> 状态：**APPROVED**（codex 六轮独立复检：round-1/2/3b/4/5/6）
> 作者：Claude（基于 codex 一审 / 二审 / 三审 / 四审 / 五审 / 六审 APPROVE）
> 替代：`coding-assistant-right-panel-2026-05-25.md` 的 UI 部分
> **硬依赖**：`assistant-backend-foundation-2026-05-25.md`（v2）§5 全部完成并合并

## v3 修订摘要（相对 v2，整合 codex 三审 must-fix）

1. **§4.5 events URL 改 `?after=&after_live=&after_live_epoch=`**：v2 backend spec 只写 `after`，UI spec 写 `after=&after_live=`，协议不一致。v3 锁定与 task 端 `orchestrator.ts:446-462` 同形：`after` + `after_live` + `after_live_epoch`。
2. **§4.5 reducer 必须按 `interactionID` upsert**（去重）：POST stream 与 GET events 并存时会同时发同一 interaction。reducer 必须 idempotent。
3. **§4.8 删除无 target 的 `setChatAttachments(next)` 兼容入口**：v2 留了"默认 task"的兼容入口，等于 rule 7 fallback。v3 强制所有 caller 显式传 target，旧 setter 删除或改签。
4. **§4.9 interaction hydrate 单源锁定**：v2 留了"两种实现方式"是 rule 8 双源遗留。v3 锁定 **来自 `/coding/session/:id/messages` 响应的 `pendingInteractions` 字段**（Spec 1 §6.4 已锁），**不**新增 `/interactions` endpoint。
5. **§4.3 store/interactions selector 加 `upsertInteraction(id, ...)` 保证 idempotent**。
6. **§7 工作量**：删旧 setter + interaction hydrate 去重 + e2e 让本 spec 接近上沿 20 天（与 codex 三审一致）。

下方原 v2 内容保留，v3 改动在以下章节就地修订：§4.5、§4.8、§4.9、§6 改动表、§7 工作量。

---

## v2 修订摘要（相对 v1）

1. **§4.5** GET resume 客户端 handler 与 POST stream **共用同一份 reducer**——后端 Spec 1 v3+ §6.3 已约定 GET 输出形状 = POST 输出形状，前端不需要 adapter。
2. **§4.7 / §5** CardParts / InlineToolPart 参数化补全：`taskDirectory` 与现有 `depth: number` prop 并存；caller 全仓清单加入 `RequirementsPanel.tsx:58`、`Card.tsx:337/370`、`ChatBubble.tsx:67/462`（共 5 处现存调用点，每处都需补 taskDirectory）。
3. **§4.8 附件方案重写**：v1 推荐"附件 state 抬到 ChatComposer 内部"会回归 2026-04-29 修过的单源 bug——`composer.attach` host command 必须保留可见。改为 **target-aware 单源**：`messageStore.chatAttachments` 由 `{ target: "task"|"assistant" }` 标记按当前 active variant 路由 attach/clear；composer 通过 prop 知道 target 但不持有 state。
4. **§4.9 / §6** interactions 历史 hydrate 路径补全：`interactionsForSession` selector 数据来自 (a) `/coding/session/:id/messages` 响应可选附带（如果后端选择此模式）或 (b) 独立 `/coding/session/:id/interactions` endpoint。具体由 Spec 1 §5.4 决定，这里写两种 case 的客户端处理。
5. **§10** compaction 上限 UI 协议：消费 Spec 1 §5.10 暴露的 `metadata.limit` + `SessionStatus.Info` terminal reason，UI 显示 disabled composer + 文案。
6. **§7** 工作量 14-20 天（含 caller grep 与 target-aware 单源）。

---

## 1. 前置依赖（必须先满足）

按 Spec 1 v3 §9 全部验收，特别是：

- assistant 顶层 session 的 lifecycle/error/interaction events 通过 `aggregate='session'` 入 `protocol_event`
- message/part 仍只在 `message`/`part` 表（**不变式**：永不写 protocol_event）
- `GET /coding/session/:id/events?after=&after_live=&after_live_epoch=` 已实现，**形状与 POST stream 同**（Spec 1 v3 §6.3 已锁，与 task 端 `orchestrator.ts:446-462` 同形）
- `GET /coding/session/:id/messages` 响应含 `watermark.lastEventSequence` 与可选 `metadata.limit`
- `/coding/message/stream` 事件序列严格按 Spec 1 §6.2：user message 先于 user part，assistant message 先于 assistant delta，含 `error` 事件，含 Idle 状态
- `/session?kind=assistant&directory=...` 可列出 assistant session
- `POST /session/:id/abort` / `DELETE /session/:id` / `/interaction/:id/reply|reject` 单源
- `CodingInput.parts` schema 支持附件
- 三联校验生效（kind/parent/directory）
- `event-stream.ts` 共享模块在 task 与 session 两端都已切换

不满足任一条 → 本 spec **不要启动**，会被迫违反 rule 7/8/15。

---

## 2. 目标 & 非目标

### 2.1 目标（v1 UI）

1. 右侧栏 header 出现 `<Tabs>`：Inspector / Coding Assistant；选择持久化到 settingsStore；折叠态隐藏 tab。
2. 切到 Coding Assistant：
   - 渲染 AssistantPanel（session picker + transcript + composer + interaction cards）。
   - 与 task 完全解耦：切 task、修改 board、task 切换 hydrate 不影响本面板任何状态。
   - SSE 断线自动 resume，无丢消息：messages hydrate + events cursor 双通道。
3. ChatComposer 提供 taskless variant：去掉 ExecutorSelector 的 task fallback、去掉 followup suggestion；保留附件（target-aware 单源）、stop、send。
4. 工具调用产生的 permission/question interaction 在面板内可见可应答（复用 `<InteractionCard>` + `/interaction/:id/reply|reject`）。
5. workspace 切换时给出明确 banner 提示当前 assistant 会话归属（不静默迁移）。
6. 历史 session 切换可用：list / 进入 / 删除。
7. compaction 上限达到时 composer disabled + 文案提示。
8. 全部新组件 / 改动 配测试（rule 36）。

### 2.2 非目标（v1 不做）

- 把 assistant 对话"提升"为 task（v2）。
- assistant 内嵌文件浏览 / 选区上下文（v2+）。
- 自定义 system prompt / 自定义工具白名单（v2+）。
- 多客户端实时协同（v2+）。
- 通知 / 桌面 toast（沿用 notify center 默认行为即可）。

---

## 3. 架构

```
┌──────────────────── 右侧栏 #sections ────────────────────┐
│ Header: <RightPanelTabs/>  ⏵collapse                       │
│   ├─ tab="inspector"   (现状)                              │
│   └─ tab="assistant"   (新)                                │
├──────────────────────────────────────────────────────────┤
│ data-panel-tab="inspector"   (data-active=true|false)      │
│   └─ <Board/>                                              │
│ data-panel-tab="assistant"   (data-active=true|false)      │
│   └─ <AssistantPanel/>                                     │
│        ├─ <AssistantSessionPicker/>                        │
│        ├─ <AssistantTranscript/>                           │
│        │    └─ AssistantMessageFrame × N                   │
│        │         └─ <CardParts parts={..} depth={..} taskDirectory={..}/> │
│        ├─ <InteractionCardList/>   (任务无关 list)         │
│        └─ <ChatComposer variant="assistant"/>              │
└──────────────────────────────────────────────────────────┘

   Service:  services/assistant.ts             ── 与 chat.ts 完全平行，禁互 import
   Store:    store/assistant.ts                ── messages, status, attachments, sessionID, watermark
                                                  互不污染 messageStore.{messages,..}
                                                  ✅ 附件 state 仍在 messageStore.chatAttachments，
                                                     但按 target 路由（§4.8）
   SSE:      services/assistant-sse.ts         ── 复用 event-stream-client（与 task 同模块）
```

---

## 4. 详细设计

### 4.1 RightPanelTabs（新组件）

**位置**：`packages/overlay/src/components/RightPanelTabs.tsx`

- 使用 `components/ui/Tabs.tsx` 原语（先补完 ARIA 与键盘导航，§4.10）。
- 两个 tab：i18n key `sections.tab.inspector` / `sections.tab.assistant`。
- 当前选中读自 `store/right-panel.ts::rightPanelTab()`；点击 → settings 持久化。
- 折叠态（`settingsStore.rightPanelCollapsed === true`）整个 Tabs 隐藏（沿用现有 `.sections[data-collapsed="true"]` CSS）。

**对 `index.html` 的改动**：

- `<span class="sections-title">` 替换为 `<div id="solidRightPanelTabs"></div>`
- `<div class="sections-tab-body" id="rightPanelInspector" ...>` 改成 `data-active` 由 Solid 控制
- 新增 `<div class="sections-tab-body" id="rightPanelAssistant" data-panel-tab="assistant" data-active="false">`
- main.tsx 挂载 `<AssistantPanel/>` 到 `#rightPanelAssistant`

### 4.2 store/right-panel.ts（新）

```ts
export const [rightPanelTab, setRightPanelTab] = createSignal<"inspector"|"assistant">(
  (settingsStore.rightPanelTab as any) ?? "inspector",
)
createEffect(() => {
  setSettingsStore("rightPanelTab", rightPanelTab())
  saveSettings()
})
createEffect(() => {
  const tab = rightPanelTab()
  const insp = document.getElementById("rightPanelInspector")
  const asst = document.getElementById("rightPanelAssistant")
  insp?.setAttribute("data-active", tab === "inspector" ? "true" : "false")
  asst?.setAttribute("data-active", tab === "assistant" ? "true" : "false")
})
```

### 4.3 store/assistant.ts（新）

```ts
export interface AssistantPart {
  type: "text" | "reasoning" | "tool" | "file" | "interaction" | ...
  // 完全沿用现有 CardParts 期望的 part 形状，禁止重新定义
  ...
}

export interface AssistantMessage {
  id: string                  // 来自 backend message.info.id —— 禁前端生成（rule 15）
  sessionID: string
  role: "user" | "assistant"
  parts: AssistantPart[]
  time: { created: number; updated?: number }
  finished: boolean
  tokens?: { in: number; out: number }
}

interface AssistantStore {
  sessionID: string | ""
  messages: AssistantMessage[]
  status: SessionStatusInfo | null   // 后端透传对象，不翻译（rule 13）
  watermark: number                  // protocol_event lastEventSequence；SSE resume 用
  limit: { kind: string; reached: boolean; message?: string } | null  // Spec 1 §5.10
  inFlight: AssistantInFlight | null
  workspaceDir: string
}
```

**核心不变式**：

- `messages[].id` 全部来自 backend `Message.Event.Updated` info；禁前端 randomUUID（rule 15）。
- SSE 必须先发 `message(role=user, info)` → 前端 append；再发 `part` 增量。Spec 1 §6.2 已保证。
- `status` 字段是 `SessionStatus.Info` 对象引用，禁翻译成自定义枚举（rule 13）。
- `inFlight` 是 AbortController 生命周期对象，不是替代 status 的业务状态（codex 二审已认可）。

**附件 state 注意**：assistantStore **不**持有 attachments；附件通过 `messageStore.chatAttachments` 共用，按 target 路由（§4.8）。这是为了保持 `composer.attach` host command 的单源不变。

### 4.4 services/assistant.ts（新）

```ts
// 物理隔离规约：禁 import boardStore / messageStore.messages / cardTreeStore / services/chat
// 允许：messageStore.chatAttachments 经 target 路由（§4.8）
import { apiJson, apiRequest } from "./api"
import { activeDirectory } from "./workspace"
import { assistantStore, ... } from "../store/assistant"
import { attachmentsForTarget, clearAttachmentsForTarget } from "../store/messages"

export async function sendAssistantMessage(text: string, attachments: AttachmentDraft[]): Promise<void>
//   ↳ POST /coding/message/stream { text, sessionID?, parts: [text + attachments] }
//   ↳ 解析 SSE → assistant-sse.ts 共用 reducer 写 store
//   ↳ 完成后 clearAttachmentsForTarget("assistant")
//   ↳ 失败：notifyError；inFlight 释放

export async function abortAssistantStream(): Promise<void>
//   ↳ POST /session/:sessionID/abort （Spec 1 单源）
//   ↳ AbortController.abort() in-flight POST stream

export async function newAssistantSession(): Promise<void>
//   ↳ 清空 store：sessionID="", messages=[], watermark=0, status=null
//   ↳ 不发请求；session 由后端 lazy-create

export async function selectAssistantSession(sessionID: string): Promise<void>
//   ↳ GET /coding/session/:id/messages → 重置 store 写入 messages + watermark + metadata.limit
//   ↳ 启动 events cursor: 见 assistant-sse.ts

export async function deleteAssistantSession(sessionID: string): Promise<void>
//   ↳ DELETE /session/:sessionID （Spec 1 单源）

export async function listAssistantSessions(): Promise<AssistantSessionMeta[]>
//   ↳ GET /session?kind=assistant&directory=<activeDirectory()>&limit=50
```

**关键约束**（rule 7 / 8 / 15）：

- 不读 `boardStore.selectedTaskID`、不调 `currentTaskSessionID()`、不写 `messageStore.messages`。
- 所有 messages 写入只发生在 SSE 事件 handler 内，禁 send 前 push 乐观 user message（rule 15）。
- 若用户 send 时没 sessionID：直接 POST，让后端 `Session.create({kind:"assistant"})` 返回；第一个 SSE 事件 `session` 携带 id，第二个 `message(user)` 才出现，前端按序写入。

### 4.5 services/assistant-sse.ts（与 task 端共用 reducer）

**目标**：与 `services/sse.ts` 共用 connection-machinery；reducer 与 POST stream 共用一份（codex 二审 must-fix）。

```ts
// 抽出 services/event-stream-client.ts (rule 9)：
//   - 通用 SSE 长连接 + reconnect + cursor 维护（after/after_live/after_live_epoch 三参）
//   - 由 task 端 sse.ts 与 assistant-sse.ts 同时接入
//
// events URL（v3 锁定与 task 端同形）：
//   GET /coding/session/:id/events?after=<seq>&after_live=<liveSeq>&after_live_epoch=<epoch>
//
// POST stream 与 GET events 共用 reducer（**必须 idempotent**，按 interactionID/messageID upsert）：
//   reduceAssistantEvent(store, event: AssistantEvent)
//     type=session              → setAssistantSessionID(id)             [POST only]
//     type=message              → upsertMessage(info)                   [POST only，按 id upsert]
//     type=part                 → upsertPart(messageID, part)           [POST only，按 partID upsert]
//     type=delta                → appendDelta(messageID, partID, ...)   [POST only]
//     type=interaction          → upsertInteraction(id, ...)            [POST & GET 都发；按 id dedupe]
//     type=interaction.resolved → markInteractionResolved(id, status)   [GET events 唯一来源；POST stream 不转发]
//     type=status               → setAssistantStatus(info)              [POST & GET 都发；幂等]
//     type=error                → notifyError + 释放 inFlight            [POST & GET 都发]
//     type=done                 → 结束 in-flight                         [POST only]
//   显式 switch 所有 9 个 case，禁默认分支（rule 13）。
```

**断线策略**：

- POST 流中断（send 后突然断网）：
  1. inFlight 标记为 error，notifyError。
  2. 调 `selectAssistantSession(current)` 重新 hydrate messages + watermark。
  3. events cursor 自动接续（从新 watermark 起）。
  4. **不**自动 retry POST——因为半途的 LLM 输出已被后端 SessionPrompt 流程接管；用户可选择"继续等"或"重发"（v1 不强制选项，等待 status terminal）。
- events 流断（页面切到后台等）：自动 reconnect，cursor 单调递增；与 task 端 `boardStore.taskSequence` 等价。
- workspace 切换：当前 events 流主动 abort，新 workspace 不自动 attach（用户从历史选）。

### 4.6 AssistantPanel.tsx（新）

```tsx
export function AssistantPanel() {
  const dirMismatch = createMemo(() => {
    const sessDir = assistantStore.workspaceDir
    const curDir = activeDirectory()
    return sessDir && curDir && sessDir !== curDir
  })

  const noWorkspace = createMemo(() => !activeDirectory())

  // compaction / 其他 limit 已达上限（Spec 1 §5.10）
  const limited = createMemo(() => !!assistantStore.limit?.reached)

  return (
    <div class="assistant-panel" data-ui="assistant-panel">
      <AssistantSessionPicker />
      <Show when={dirMismatch()}>
        <div class="assistant-banner" data-tone="warn">
          {t("assistant.workspace_mismatch", { sess: shortPath(assistantStore.workspaceDir), cur: shortPath(activeDirectory()) })}
        </div>
      </Show>
      <Show when={limited()}>
        <div class="assistant-banner" data-tone="info">
          {assistantStore.limit?.message ?? t(`assistant.limit.${assistantStore.limit?.kind}`)}
        </div>
      </Show>
      <Show when={noWorkspace()}>
        <div class="assistant-empty">{t("assistant.workspace_required")}</div>
      </Show>
      <Show when={!noWorkspace()}>
        <AssistantTranscript />
        <InteractionCardList
          interactions={interactionsForSession(assistantStore.sessionID)}
        />
        <ChatComposer
          variant="assistant"
          enabled={!dirMismatch() && !limited()}
          busy={!!assistantStore.inFlight}
          stopping={!!assistantStore.inFlight?.stopping}
          onSubmit={(text, attachments) => sendAssistantMessage(text, attachments)}
          onStop={() => abortAssistantStream()}
        />
      </Show>
    </div>
  )
}
```

### 4.7 AssistantTranscript.tsx + AssistantMessageFrame.tsx（新）

`ChatBubble` 强耦合 `boardStore.selectedTaskID`（rewind/cancel 按钮）— `ChatBubble.tsx:189-221`、`Card.tsx:139-183` 已确认。**不复用**。

**AssistantMessageFrame.tsx**：

```tsx
interface Props {
  message: AssistantMessage
  taskDirectory: string  // 传给 CardParts；assistant 上下文为空字符串
}
export function AssistantMessageFrame(props: Props) {
  return (
    <div class="assistant-message" data-role={props.message.role}>
      <div class="assistant-message-meta">
        <span class="assistant-message-role">{t(`assistant.role.${props.message.role}`)}</span>
        <span class="assistant-message-time">{formatTime(props.message.time.created)}</span>
        <Show when={props.message.tokens}>
          <span class="assistant-message-tokens">↑{props.message.tokens.in} ↓{props.message.tokens.out}</span>
        </Show>
      </div>
      <CardParts
        parts={props.message.parts}
        depth={0}                          // ✅ 必传：CardParts 现有签名 (parts, depth, streaming?)
        taskDirectory={props.taskDirectory}  // 新增 prop（§5 前置改动）
        streaming={!props.message.finished}
      />
    </div>
  )
}
```

**AssistantTranscript.tsx**：

```tsx
export function AssistantTranscript() {
  return (
    <div class="assistant-transcript" data-ui="assistant-transcript">
      <For each={assistantStore.messages}>
        {(m) => <AssistantMessageFrame message={m} taskDirectory="" />}
      </For>
      <Show when={assistantStore.messages.length === 0}>
        <div class="assistant-empty">{t("assistant.empty_hint")}</div>
      </Show>
    </div>
  )
}
```

### 4.8 ChatComposer.tsx 变体 + 附件 target-aware 单源（v2 重写）

**位置**：`packages/overlay/src/components/ChatComposer.tsx` + `packages/overlay/src/store/messages.ts` + `packages/overlay/src/services/composer-attach.ts`

**目标**：去掉 task 隐性耦合，但**保留** `composer.attach` host command 的单源（2026-04-29 已修过的设计，不能回归）。

**改动**：

1. **`ChatComposer` 加 `variant` prop**：`"task" | "assistant"`，默认 `"task"`。
   - `variant === "assistant"`：
     - **不**渲染 `<ExecutorSelector/>`（它读 `rootTaskSessionID()` 是 task 专属；未来 assistant 若需 model 切换，应**重做** SessionModelChip，**禁** 给 ExecutorSelector 加 if 分支 rule 13）。
     - **不**消费 `pendingSuggestion`（task followup 专属；不传此 prop 即可）。
   - drag-drop / paste 保留。
   - composer 内部读 attachments 时调 `attachmentsForTarget(variant)`，不直接读 `messageStore.chatAttachments`。

2. **`store/messages.ts` 改造**（保留 `messageStore.chatAttachments` 为单源；**v3 删除无 target 的旧 setter**）：
   - state 形状从 `chatAttachments: Attachment[]` 改为 `chatAttachments: Record<"task"|"assistant", Attachment[]>`。
   - 公开 selector / setter（**仅** target-aware）：
     ```ts
     export function attachmentsForTarget(target: "task"|"assistant"): Attachment[]
     export function setAttachmentsForTarget(target: "task"|"assistant", next: Attachment[]): void
     export function clearAttachmentsForTarget(target: "task"|"assistant"): void
     ```
   - **v3 强制**：删除原 `setChatAttachments(next)` 无 target 入口（rule 7：不留"默认 task" fallback）。现有调用点全仓 grep 必须**全部**改成显式 target：
     - `services/chat.ts`：所有 setChatAttachments → `setAttachmentsForTarget("task", next)`
     - `services/composer-attach.ts`：改为读 `rightPanelTab()` 决定 target（见第 3 条）
     - `components/ChatComposer.tsx`：内部 add/remove → `setAttachmentsForTarget(props.variant, next)`
   - **TS 测试**（rule 36）：旧 `setChatAttachments` 调用点编译应失败（被删除符号），断言 "默认 task fallback" 路径已铲除。

3. **`composer-attach.ts` 改造**（**关键**，避免单源回归）：
   - 当前实现 (`services/composer-attach.ts:20-44`) 写 `messageStore.chatAttachments`，host attach 始终落到全局。
   - 改为**读当前 `rightPanelTab()`**（store/right-panel）决定 target：
     - tab=inspector → attach 落 `"task"`（保持现有行为，task composer 看到）。
     - tab=assistant → attach 落 `"assistant"`（assistant composer 看到）。
   - 这样**外部 host attach 仍走单一入口**（rule 8 单源），但被路由到当前用户可见的 composer——**用户体验单源**而非 store 物理单源。
   - 写入完成后 emit 一个 toast / log："Attached to {target} composer"，提升可见性。

4. **附件 state 不抬到组件内部**（v1 错误，撤销）：避免 host attach 写入用户看不见的位置。

5. **测试**：
   - host attach 当 tab=inspector → task composer 增加附件，assistant composer 不变。
   - host attach 当 tab=assistant → assistant composer 增加附件，task composer 不变。
   - 切 tab 不丢附件（每个 target 独立 state）。
   - clearAttachmentsForTarget 不互相影响。

**严禁**：在 composer 内部读 `boardStore.selectedTaskID` / `currentTaskSessionID()` 决定 variant；variant 必须来自 prop。

### 4.9 InteractionCard / InteractionCardList 复用 + interactions 数据源

**位置**：
- `packages/overlay/src/components/InteractionCard.tsx`（不动）
- `packages/overlay/src/services/interaction-reply.ts`（不动，已是 `/interaction/:id/*` 单源）
- `packages/overlay/src/store/interactions.ts` 加 selector

**做法**：

- codex 二审确认：reply / reject 走 `/interaction/:id/reply|reject`（非 task scope）。Spec 1 §5.2 修了 interaction 入库；engine 内 hooks 按 scope 路由刷新（task → `syncTask`，session → `syncSession`）。
- AssistantPanel 内 `<InteractionCardList interactions={interactionsForSession(sessionID)}/>`。
- `interactionsForSession(sessionID)` selector 数据来源（**v3 锁定单源**）：
  - **Hydrate**：`GET /coding/session/:id/messages` 响应里的 `pendingInteractions: InteractionRecord[]` 字段（Spec 1 §6.4 已锁）；客户端在 `selectAssistantSession()` 时调 `upsertInteraction(id, ...)` 写入 store。
  - **Live**：与 Spec 1 §6.3 事件 union 表对齐——
    - `type=interaction`：POST stream 与 GET events 都发（reducer 调 `upsertInteraction(id, ...)`，按 id 去重）。
    - `type=interaction.resolved`：**仅 GET events 发**（POST stream 不转发；reducer 调 `markInteractionResolved(id, status)`）。
  - **去重保证**：所有写入路径都按 `interactionID` upsert / mark，自然 idempotent。POST 与 GET 同时发同一条 `interaction` 不会出现重复卡片。
  - **禁** 新增 `/coding/session/:id/interactions` 独立 endpoint（rule 8 双源）。
- store 形状不需要扩字段；按 sessionID 索引（**v3 加 upsert 接口保证 idempotent**）：
  ```ts
  store/interactions.ts:
    interactions: Record<string, Record<string, InteractionRecord>>
      // outer key: sessionID 或 taskID
      // inner key: interactionID  → 天然 dedupe
    interactionsForSession(sessionID): InteractionRecord[]   // 按 time_created asc 拍平
    interactionsForTask(taskID): InteractionRecord[]
    upsertInteraction(scope: {sessionID}|{taskID}, record: InteractionRecord): void
    markInteractionResolved(scope, interactionID, status): void
  ```
  v1 已有 `interactionsForTask` 概念，v3 加 `interactionsForSession` 对称版本 + `upsertInteraction` 入口；selector 形态保持一致。

### 4.10 `<Tabs>` ARIA + 键盘导航补完

**位置**：`packages/overlay/src/components/ui/Tabs.tsx`

- 加 `role="tablist"`（确认已有）、`aria-controls` 指向对应 tab body id。
- 键盘：Arrow Left/Right 在 tablist 内切换；Home/End 跳首尾。
- `<Tab>` 选中 `tabIndex=0`，未选中 `tabIndex=-1`。
- 测试：keyboard event simulation。

不能再"由 caller 自己实现"——assistant + 任何后续都会复用，原语必须自洽。**注意**：codex 二审提到 `ExecutorSelector` 当前是自己实现 tab 行为（`ExecutorSelector.tsx:421-447`）；本 spec 不动它，等本次 Tabs a11y 落实后再迁移（**避免** 一次 PR 触碰太多 caller）。

### 4.11 settings 字段新增

`packages/overlay/src/store/settings.ts:25-65` `OverlaySettings`：

```ts
+ rightPanelTab?: "inspector" | "assistant"   // 默认 "inspector"
+ assistantSessionID?: string                  // 跨刷新恢复
```

`DEFAULT_SETTINGS` (L149+) / `sanitize` (L218+) / `normalizeOptional` (L317+) 同步处理。

### 4.12 i18n

`packages/overlay/src/i18n/en-US.json` + `zh-CN.json`：

```jsonc
"sections.tab.inspector": "Inspector" / "检查器",
"sections.tab.assistant": "Coding Assistant" / "Coding 助手",
"assistant.title": "Coding Assistant" / "Coding 助手",
"assistant.role.user": "You" / "你",
"assistant.role.assistant": "Assistant" / "助手",
"assistant.new_session": "New chat" / "新建对话",
"assistant.history": "History" / "历史",
"assistant.delete_confirm": "Delete this coding session?" / "删除该 Coding 会话？",
"assistant.empty_hint": "Ask the coding agent anything about this workspace." / "向 Coding agent 提问关于该 workspace 的任何问题。",
"assistant.workspace_required": "Select a workspace to start chatting." / "请先选择 workspace。",
"assistant.workspace_mismatch": "Session belongs to {sess}; you're currently in {cur}." / "当前会话归属 {sess}，工作目录已切换为 {cur}。",
"assistant.stop": "Stop" / "停止",
"assistant.limit.compaction_unsupported": "Session reached its history limit. Please start a new chat." / "会话已达历史长度上限，请新建对话。"
```

---

## 5. CardParts / InlineToolPart 参数化（**前置改动，全仓 caller 必更新**）

**位置**：
- `packages/overlay/src/components/CardParts.tsx:54` — 现签名 `(props: { parts: any[]; depth: number; streaming?: boolean })`
- `packages/overlay/src/components/InlineToolPart.tsx:159,209` — 调 `selectedTaskDirectory()`
- `packages/overlay/src/components/CardParts.tsx:32, 89` — 同上

**问题**：两者都直接调 `selectedTaskDirectory()`；无 task 时返回 ""，已经形成隐性 fallback（rule 7）。

**改法**：

- **CardParts 签名扩展**为 `(props: { parts: any[]; depth: number; taskDirectory: string; streaming?: boolean })`——`taskDirectory` 必传（无默认值），TS 强制 caller 显式传。
- **InlineToolPart 签名同样扩展**。
- **caller 全仓更新清单**（grep `CardParts parts={` 在 packages/overlay/src 现有 4 处 + 实例化处）：

| Caller | 当前文件 | 改法 |
|---|---|---|
| `Card.tsx:337` | `<CardParts parts={bodyParts()} depth={props.depth} streaming={...}/>` | 加 `taskDirectory={selectedTaskDirectory()}` |
| `Card.tsx:370` | 同 | 同 |
| `ChatBubble.tsx:67` | `<CardParts parts={child().parts} depth={props.depth + 1} streaming={...}/>` | 加 `taskDirectory={selectedTaskDirectory()}` |
| `ChatBubble.tsx:462` | 同 | 同 |
| `RequirementsPanel.tsx:58` | `<CardParts parts={orderedMessageParts(msg())} depth={1} streaming={props.isGenerating === true}/>` | 加 `taskDirectory={selectedTaskDirectory()}` |
| `AssistantMessageFrame.tsx` (新) | — | 传 `taskDirectory=""`（assistant 上下文无 task scope） |
| `InlineToolPart` 同步：所有 `<InlineToolPart .../>` 调用点 | grep `InlineToolPart` | 加 `taskDirectory` |

- **禁** 在 CardParts / InlineToolPart 内部加 `taskDirectory ?? selectedTaskDirectory()` 兜底（rule 7）。
- **TS 测试**：构造一个不传 `taskDirectory` 的调用点（注释 expect-error），断言 TS 报错（防止后续被人加默认值）。

---

## 6. 文件改动清单（实施时按此 grep 复核 rule 35）

### 新文件

```
packages/overlay/src/components/RightPanelTabs.tsx
packages/overlay/src/components/AssistantPanel.tsx
packages/overlay/src/components/AssistantTranscript.tsx
packages/overlay/src/components/AssistantSessionPicker.tsx
packages/overlay/src/components/AssistantMessageFrame.tsx
packages/overlay/src/store/right-panel.ts
packages/overlay/src/store/assistant.ts
packages/overlay/src/services/assistant.ts
packages/overlay/src/services/assistant-sse.ts
packages/overlay/src/services/event-stream-client.ts   ← 抽出（与 task 端共用）
packages/overlay/src/styles/surfaces/assistant.css
```

### 改动

```
packages/overlay/src/index.html
  - sections-header: sections-title 替换为 #solidRightPanelTabs
  - 新增 data-panel-tab="assistant" tab-body
  - 引入 surfaces/assistant.css

packages/overlay/src/main.tsx
  - 新增 RightPanelTabs / AssistantPanel render() 挂载
  - 调用 services/assistant 初始化（hydrate last sessionID）

packages/overlay/src/components/ChatComposer.tsx
  - 增 variant prop（"task" | "assistant"）
  - assistant variant 不渲染 ExecutorSelector / 不读 suggestion
  - 内部 attachments 读取改为 attachmentsForTarget(variant)
  - 内部 attachment add/remove 调用 setAttachmentsForTarget(variant, next)

packages/overlay/src/components/CardParts.tsx
  - taskDirectory 改必传 prop（删除 selectedTaskDirectory() 内部调用）

packages/overlay/src/components/InlineToolPart.tsx
  - taskDirectory 改必传 prop

packages/overlay/src/components/Card.tsx           ← 必改 caller
  - <CardParts ... taskDirectory={selectedTaskDirectory()}/>  × 2 处
  - 同步 InlineToolPart 调用点

packages/overlay/src/components/ChatBubble.tsx     ← 必改 caller
  - <CardParts ... taskDirectory={selectedTaskDirectory()}/>  × 2 处

packages/overlay/src/components/RequirementsPanel.tsx  ← 必改 caller
  - <CardParts ... taskDirectory={selectedTaskDirectory()}/>  × 1 处

packages/overlay/src/components/ui/Tabs.tsx
  - 键盘导航 + ARIA 补完

packages/overlay/src/store/settings.ts
  - 新增 rightPanelTab / assistantSessionID 字段 + 默认值 + sanitize

packages/overlay/src/store/messages.ts
  - chatAttachments 改为 by-target 形状
  - 新 selector/setter: attachmentsForTarget / setAttachmentsForTarget / clearAttachmentsForTarget
  - **v3 强制**：删除原 setChatAttachments(next) 无 target 入口（rule 7 不留 fallback）
  - 现有 setChatAttachments 调用点全仓 grep 改 target-aware：
    - services/chat.ts → setAttachmentsForTarget("task", next)
    - services/composer-attach.ts → 按 rightPanelTab() 决定 target
    - components/ChatComposer.tsx → setAttachmentsForTarget(variant, next)

packages/overlay/src/services/composer-attach.ts
  - 改为读 rightPanelTab() 决定 target；写 attachmentsForTarget(target, next)
  - 加 toast / log 提示 "Attached to {target} composer"

packages/overlay/src/services/sse.ts
  - 抽出 connection-machinery 到 event-stream-client.ts
  - task 端切换到共享 client（一次完成，避免双轨）

packages/overlay/src/store/interactions.ts
  - state 形状改 by-interactionID 内 Map（保证 upsert 幂等，v3 锁）
  - 加 interactionsForSession(sessionID) selector
  - 加 upsertInteraction(scope, record) 与 markInteractionResolved(scope, id, status) 入口（POST + GET + hydrate 共用）
  - 现有 interactionsForTask(taskID) 保持不动

packages/overlay/src/i18n/en-US.json
packages/overlay/src/i18n/zh-CN.json

packages/overlay/src/styles/surfaces/inspector.css
  - 确认 .sections-tab-body[data-active="false"] { display: none } 显式（如缺）
```

### 测试新增（rule 36）

```
packages/overlay/test/right-panel-tabs.test.ts
  - tab 切换持久化、折叠态隐藏、Arrow/Home/End 键盘导航
packages/overlay/test/assistant-sse-store.test.ts
  - 模拟 SSE 序列：session → message(user) → part → message(assistant) → delta → part → message(finished)
  - 断言：store 不创建 placeholder；messages[].id 全部来自后端 info
  - 断言：interaction 事件 push 到 interactionsForSession(sessionID)
  - 断言：error 触发 notifyError、释放 inFlight
  - 断言：status 对象直接写入，不翻译
packages/overlay/test/assistant-resume.test.ts
  - 模拟断线：POST 流中断后调 selectAssistantSession() 重新 hydrate；events stream 从新 watermark 接续；无重复
  - 模拟 events 流断线 + reconnect：cursor 单调
packages/overlay/test/assistant-isolation.test.ts
  - 切 task 不影响 assistantStore
  - 切 workspace 触发 banner，session 不迁移
  - 删除 assistant session：UI 不残留卡片
packages/overlay/test/assistant-composer-variant.test.ts
  - variant=assistant 不渲染 ExecutorSelector
  - 附件 add 走 setAttachmentsForTarget("assistant", ...)，task composer 看不到
packages/overlay/test/composer-attach-target-routing.test.ts
  - rightPanelTab=inspector → composer.attach 写 target=task
  - rightPanelTab=assistant → composer.attach 写 target=assistant
  - 切 tab 不丢任一 target 附件
packages/overlay/test/card-parts-required-directory.test.ts
  - 不传 taskDirectory 时 TS 报错（type-level）
  - 传不同值快照差异
  - 所有现有 caller (Card/ChatBubble/RequirementsPanel) 都显式传
packages/overlay/test/event-stream-client-shared.test.ts
  - task 端 sse 与 assistant 端 sse 走同一 client；reconnect、cursor 行为对称
playwright (e2e):
  - 切到 Assistant tab → 发"读 package.json 前 30 行" → 看到流式输出 + Read 工具卡片
  - 发"运行 ls" → 看到 InteractionCard 权限弹 → 应答 → bash 输出
  - 中途 throttle offline → 重连 → 流恢复 → 内容完整
  - host composer.attach 在 Assistant tab 下出现在 assistant composer
  - compaction 上限：mock metadata.limit.reached → composer disabled + banner 显示
```

---

## 7. 工作量（v3）

| 阶段 | 工时 |
|---|---|
| `<Tabs>` ARIA + 键盘导航 | 0.5 天 |
| settings 字段 + RightPanelTabs + 切换 wiring | 0.5 天 |
| **CardParts / InlineToolPart 参数化 + 5 处 caller 更新**（v1 估 1 天） | 1-1.5 天 |
| store/right-panel + store/assistant + services/assistant 基础 | 1.5 天 |
| services/assistant-sse + **抽出 event-stream-client + task 端切换** | 2-3 天 |
| AssistantPanel + Transcript + MessageFrame + SessionPicker | 2 天 |
| **ChatComposer variant + messageStore by-target + composer-attach target-aware + 删旧 setter caller 全切**（v3 强制单源）| 2.5-3 天 |
| InteractionCardList 集成 + interactionsForSession selector + upsertInteraction 入口 + hydrate 单源 + 去重测试 | 1.5 天 |
| workspace 切换 banner / compaction limit banner / 空态 / 错态 | 1 天 |
| 单元测试 | 2-3 天 |
| Playwright e2e | 1-2 天 |
| 视觉对齐 / 设计 token / inspector.css | 0.5-1 天 |
| **总计** | **15-21 工作日**（v2 是 14-20，v3 删旧 setter + 去重 + hydrate 单源 +0.5-1 天）|

---

## 8. 验收（rule 24 / 28b）

硬标准——任一不满足即 v1 未交付：

1. 右侧栏 header 显示 Inspector / Coding Assistant 标签；切换 < 100ms；刷新后保持；折叠态自动隐藏；键盘导航通过。
2. 切到 Coding Assistant + workspace 已选 → 空态提示；发"读 packages/overlay/src/main.tsx 前 50 行总结"：
   - 流式回显每个 delta 即时显示。
   - Read 工具卡片渲染（CardParts 经 InlineToolPart）。
   - tokens 显示在 frame meta。
3. 发"运行 ls"：
   - InteractionCard 弹出权限请求（assistant scope）。
   - 应答后 bash 执行并显示输出。
4. 中途断网 → 恢复网络 → assistant 流自动 resume；最终输出与不断网一致；events watermark 单调、无重复。
5. 切 task：assistantStore 完全不变；任务侧 Board 正常。
6. 切 workspace：banner 提示 session 归属；composer 禁用。
7. 历史 picker：列出当前 workspace 下所有 assistant session（不混 task root）；切换、删除有 confirm 且真删。
8. **附件 target-aware**：rightPanelTab=inspector 时 host composer.attach 落 task composer；切到 assistant 后再 attach 落 assistant composer；切 tab 不丢；测试覆盖。
9. compaction limit reached：composer disabled + banner 文案（消费 Spec 1 §5.10 字段）。
10. 测试：§6 全部通过；既有 task 端 0 回归（含 messageStore by-target 改造）。
11. 视觉：assistant 面板与 Inspector header/padding/radius/font 无可见差异（设计 token 复用，不 hardcode）。
12. 代码 grep：
    - `services/assistant.ts` 不 import `boardStore` / `messageStore.messages`（messages 部分不依赖；attachments 经 attachmentsForTarget 间接读，OK）/ `cardTreeStore` / `services/chat`。
    - 没有 `boardStore.selectedTaskID ?? "fallback"` 形式。
    - `messages[].id` 无 `crypto.randomUUID()` / `Date.now()` / `Math.random()` 来源（rule 15）。
    - `CardParts` / `InlineToolPart` 内部无 `selectedTaskDirectory()` 调用（必传 prop）。

---

## 9. 风险与 CLAUDE.md 对照（v2）

| 风险 | Rule | 缓解 |
|---|---|---|
| 复用 messageStore.messages 全局单例 → 污染 task | rule 8 | 独立 assistantStore.messages；grep 验证 |
| 附件 state 抬升内部 → host composer.attach 看不见（v1 错误） | rule 8 | v2 改 messageStore.chatAttachments 按 target；composer-attach 读 tab 决定 target |
| 给 ChatComposer 加 task fallback 分支 | rule 7 / 13 | variant prop 决定分支；未来 model chip 是独立组件 |
| 给 message 造 placeholder id | rule 15 | §4.3 不变式 + §6 测试 |
| SSE resume copy from sse.ts | rule 8 / 9 | 抽 event-stream-client，task 与 assistant 同时切换 |
| CardParts 加 taskDirectory fallback | rule 7 | 改必传 prop；TS type 强制 + 反向测试 |
| Tabs 留空键盘导航 | a11y 基线 | §4.10 必做 |
| 删除 sections-title 残留 i18n key 引用 | rule 17 | grep `sections.title` 全仓清理 |
| 测试只 mock 不 e2e | rule 24 / 36 | Playwright 至少 5 条 happy path |
| 二审遗漏 | rule 24 | spec 落盘后第三轮 codex review |
| 调用点遗漏（特别 CardParts 5 处） | rule 35 | §5 表格逐项贴 grep 证据 |
| messageStore.chatAttachments 改 by-target 影响 task 路径 | rule 35 | 现有 setChatAttachments 调用点穷举，全部传 target="task" |

---

## 10. 与 Spec 1 的握手（v2）

- 本 spec **不启动**直到 Spec 1 v3 §9 全部验收通过。
- Spec 1 §6.3 完整事件 union 表 = §4.5 reducer 输入集合：POST stream 8 类（`session/message/part/delta/interaction/status/error/done`）+ GET events 4 类（`status/error/interaction/interaction.resolved`，**`interaction.resolved` 仅 GET 来源**）。reducer 对 9 个 type 都 idempotent upsert / mark。
- Spec 1 §6.3 GET events 输出形状 = POST stream 同形（§4.5 共用 reducer）。
- Spec 1 §6.4 `metadata.limit` 字段 = §4.6 / §4.12 显示来源。
- Spec 1 §5.10 terminal reason enum 扩展（若需）= §4.3 store.status.type==="terminal" 时读 reason 决定 banner。
- 共享 `event-stream-client` 抽取：本 spec 完成；同 PR 切换 task 端 sse.ts，避免双轨。

---

## 11. 待用户 / 二审确认

1. ChatComposer 加 `variant` prop vs 拆出 `AssistantChatComposer`：本 spec 倾向前者（rule 9 抽象），但若 variant 分支超过两处条件就拆。
2. `messageStore.chatAttachments` 改 `Record<target, Attachment[]>` vs 拆两份 store：本 spec 倾向前者（更少 wiring），需后端 SQL 模板/dashboard 无依赖。
3. `composer-attach.ts` 读 `rightPanelTab()` 决定 target：是否需要额外 host command（如 `composer.attach { target: "task"|"assistant"}` 显式传）作为高级用法？v1 仅按 UI 当前态路由。
4. `<Tabs>` 键盘导航：自治 vs caller 自治（ExecutorSelector 不动）—— v1 选自治 + 不迁移 ExecutorSelector，避免一次 PR 触碰过多 caller。
5. interactions hydrate 走 `/coding/session/:id/messages` 附带 vs 单独 `/interactions` endpoint：本 spec 倾向附带（少一个网络请求），需 Spec 1 §5.4 实现确认。
