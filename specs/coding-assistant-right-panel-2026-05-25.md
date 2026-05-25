# [SUPERSEDED] Coding Assistant 右侧栏（与 Inspector 切换）PRD v1

> ⚠️ **本文件已废弃，仅作为历史保留。**
>
> 替代方案（由 codex 独立审查后拆分）：
> - **后端基建**：`specs/assistant-backend-foundation-2026-05-25.md`
> - **右侧栏 UI**：`specs/assistant-right-panel-ui-2026-05-25.md`
>
> 废弃原因（codex 审查 2026-05-25，审查日志 `_codex_assistant_prd_review.log`）：
> 本 v1 把"已有路由 / 已有组件"误判为"端到端能力已就绪"，工作量从 3-5 天暴涨为 20-30 天。codex APPROVE 了用户与 Claude 共同识别的全部 4 个 fatal blocker（bridge 静默吞 assistant 事件、overlay 无非 task 容器、permission 不可见、SSE 不可恢复），并补出 6 个遗漏（事件契约不足以无合成渲染会违反 rule 15、CodingInput schema 拒附件、Session.list 无 kind filter、abort/delete 不应造 /coding alias 违反 rule 8、SessionStatus.Info 是对象而非字符串、Card/ChatBubble 也耦合 selectedTaskID）。
>
> **不要按本文档实施。** 阅读上述两份替代 spec。下方内容保留以便追溯当时的乐观假设与被推翻的论点。
>
> ---

# 历史草案（v1，已废弃）

> 日期：2026-05-25
> 状态：v1 草案（已 superseded，见顶部）
> 作者：Claude（基于全仓调查）
> 触发：opencorvus 目前以 task-workflow（planner → architect → build → deliver）为唯一对话入口，缺少"日常细粒度 coding 助手"出口。希望在不破坏现有 workflow 的前提下，加入一个 VSCode/Cursor 风格的轻量 coding agent，放在右侧栏，与现有 Inspector（Board）一键切换。

---

## 0. 一句话结论

90% 后端 + 70% 前端能力已就绪：

- 后端：`agent.coding` 已存在；路由 `POST /coding/message/stream` 已存在；`session.kind="assistant"` 已显式支持"MCP/Debug/Coding/Panel"独立会话。
- 前端：`<Tabs>` 原语、`ChatComposer` 完全可参数化、`CardParts/TextPart/InlineToolPart/ReasoningPart/FilePart` 均与 Board 解耦。

v1 真正要做的是：**右侧栏标签切换 + 一个独立 sessionID 的 mini-Conversation + 历史会话持久化**。坚决避免重新发明已有部件（rule 8 / rule 9）。

---

## 1. 问题与目标

### 1.1 问题

当前 opencorvus 的对话面板（中央 Conversation + 底部 ChatComposer）**唯一对话出口**就是 task workflow。用户输入会被 `panelMessage()` 路由进 task（planner/architect/build/deliver 全流程），导致：

- **粒度过粗**：要"读一下这个文件"、"改这一行注释"、"跑个 grep"也要走完整 workflow，分钟级延迟、生成 goal/plan/architect contract、占用 worktree。
- **无法并行**：当一个 task 跑着的时候，用户没有第二个出口跟模型对话——只能等或者新开 task。
- **无 IDE 内嵌体验**：用户期待的是 Cursor/Windsurf 那种"右侧栏快速问答 + 文件读写"，而不是"启动一个项目"。

### 1.2 目标（v1）

在右侧 `#sections` 面板增加 **Inspector / Coding Assistant** 二选一标签：

- 切到 Coding Assistant：右侧栏变成一个独立对话面板（消息列表 + 输入框 + Stop）。
- 后端使用 `agent.coding`（已存在）+ `session.kind="assistant"`（已存在），**完全不进 task workflow**。
- 共享当前 `activeDirectory()` 作为工作目录，权限走现有 `PermissionNext.ask()` 流程。
- 历史会话可在面板内切换（最近 N 条 assistant session）。

### 1.3 非目标（v1 不做）

- 不与 task 联动（不允许把 coding 对话"转换"为 task；那是 v2 的事）。
- 不引入新 agent 类型（rule 8：直接复用 `agent.coding`）。
- 不实现自定义 system prompt 配置（v1 用 `PROMPT_CODING` 默认）。
- 不引入文件树/编辑器（侧栏仍是对话面板；文件浏览/编辑沿用已有 Workspace 面板）。
- 不引入 streaming voice / inline completion / 选区上下文（v2+）。

---

## 2. 现状映射（reuse 清单）

> 全部基于实际 grep 结果，**任何一处遗漏视为违反 rule 35**。

### 2.1 后端

| 能力 | 现存位置 | v1 复用方式 |
|---|---|---|
| Coding agent 定义 | `packages/opencorvus/src/agent/agent.ts`（role=`coding`，prompt=`PROMPT_CODING`，工具白名单含 read/edit/write/bash/glob/search_code/lsp） | 直接传 `agent: "coding"` |
| 流式入口 | `POST /coding/message/stream`（`packages/opencorvus/src/server/routes/coding.ts:86-223`） | **已能用**——SSE 输出 `session/delta/part/message/status/error/done` |
| 历史回放 | `GET /coding/session/:sessionID/messages`（同上 :224-246） | 直接调用，启动时 hydrate |
| Session 模型 | `Session.create({ kind: "assistant", ... })`；`session.parent_id` 可空 | 创建顶层独立 session，**不挂 task** |
| 工作目录 | `Instance.directory` 通过 `x-opencorvus-directory` header 传入（现有 API client 已自动注入） | 无改动 |
| 权限请求 | `PermissionNext.ask()` → `POST /permission/:requestID/reply`（route 在 `permission.ts`） | 直接复用，前端复用 `InteractionCard` |
| LLM 活动监控 | `withLLMActivity()`（first-byte/idle/total 超时已统一） | 无改动 |

### 2.2 前端

| 能力 | 现存位置 | v1 复用方式 |
|---|---|---|
| Tab 原语 | `packages/overlay/src/components/ui/Tabs.tsx` + `styles/primitives/tabs.css`（role=tab, data-active, data-size sm/md） | 直接用 |
| 右侧栏壳 | `index.html` 的 `<div class="sections">`；CSS 已支持 `.sections-tab-body[data-active="false"]{display:none}`，**且已在 `inspector.css` 预留 `data-panel-tab` 选择空间** | 在 header 加 tab strip，body 再加一个 `<div data-panel-tab="coding-assistant">` |
| 消息渲染 | `CardParts.tsx` / `TextPart.tsx` / `ReasoningPart.tsx` / `InlineToolPart.tsx` / `FilePart.tsx` | 全部无任务/无 stage 耦合，可直接复用 |
| 输入框 | `ChatComposer.tsx`（`onSubmit`/`onStop`/`busy`/`pendingSuggestion` 均为 prop） | 第二份实例，传不同 `onSubmit` |
| 工作目录信号 | `services/workspace.ts::activeDirectory()` 响应式 | 直接 `createMemo` 读 |
| 持久化 | `store/settings.ts::settingsStore` + `saveSettings()` | 新增 `rightPanelTab` / `assistantSessionID` 字段 |
| 权限交互卡 | `components/InteractionCard.tsx` 已能独立渲染 + 应答 | 嵌入新面板 |
| 错误通知 | `services/notify.ts` | 直接复用 |

### 2.3 已知耦合（必须解开）

1. **`services/chat.ts::currentTaskSessionID()`** 把 sessionID 绑死在 `boardStore.board?.task?.sessionID`。 *不要改它*；新面板**走独立 service**（见 §3.3），物理隔离。
2. **`services/conversation.ts`** + **`store/card-tree.ts`** 是 task-scoped 单例。 *不要参数化*——v1 走 §3.4 的"独立 mini store"路线（理由：单线程聊天根本不需要 card-tree 的多 stage / 多 agent 层级；强行复用会拖累 task 渲染路径，且违反 rule 5/6）。

---

## 3. 设计

### 3.1 整体架构

```
┌─────────────────────────── 右侧栏 #sections ──────────────────────────┐
│  Header:  [ Inspector | Coding Assistant ]  ⏵collapse                  │
├──────────────────────────────────────────────────────────────────────┤
│  data-panel-tab="inspector"   (data-active=true|false)                 │
│    └─ <Board/>           （现状）                                       │
│  data-panel-tab="coding-assistant"  (data-active=true|false)           │
│    └─ <AssistantPanel/>  （新）                                         │
│         ├─ <AssistantSessionPicker/>  (最近会话切换 + 新建)             │
│         ├─ <AssistantTranscript/>     (复用 CardParts 渲染)             │
│         ├─ <InteractionCardList/>     (权限 / Question 工具)            │
│         └─ <ChatComposer/>            (复用，传独立 onSubmit/onStop)    │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 标签切换

**位置**：`index.html` 的 `<header class="sections-header">` 内，把当前的静态 `<span class="sections-title">` 换成一个挂载点 `<div id="solidRightPanelTabs"></div>`，由 Solid 渲染 `<Tabs>`。

**状态**：

```ts
// store/right-panel.ts (新)
export const [rightPanelTab, setRightPanelTab] = createSignal<"inspector"|"assistant">(
  (settingsStore.rightPanelTab as any) ?? "inspector",
)
createEffect(() => {
  setSettingsStore("rightPanelTab", rightPanelTab())
  saveSettings()
})
```

**body 切换**：用 createEffect 写 `data-active` 到两个 `.sections-tab-body`（保持现有 CSS 契约）。

**i18n**：新增

```jsonc
// en-US.json
"sections.tab.inspector": "Inspector",
"sections.tab.assistant": "Coding Assistant",
// zh-CN.json
"sections.tab.inspector": "检查器",
"sections.tab.assistant": "Coding 助手",
```

### 3.3 前端 service：独立、不污染 chat.ts

新文件 `packages/overlay/src/services/assistant.ts`：

```ts
// 单 service 管理：
//  - 当前 assistantSessionID（可空 = 未开始过会话）
//  - 最近会话列表（localStorage 持久化 + 后端 list 校验）
//  - sendAssistantMessage(text, attachments?)
//      → POST /coding/message/stream，SSE 解析进 assistantStore
//  - stopAssistantStream()  → AbortController.abort()
//  - newAssistantSession()  → 清空 sessionID + transcript
//  - selectAssistantSession(id) → GET /coding/session/:id/messages → hydrate
```

**关键约束（rule 8）**：assistant.ts 与 chat.ts **完全平行**，禁止互相 import；禁止共享 `messageStore.chatRequest`（assistant 有自己的 in-flight handle）。

### 3.4 前端 store：独立 mini transcript（不进 cardTreeStore）

新文件 `packages/overlay/src/store/assistant.ts`：

```ts
// 结构有意压扁——不重建 cardTree 的多 agent/多 stage 层级。
// 单线程会话只需要：messages[] (role + parts[])
export interface AssistantMessage {
  id: string
  role: "user" | "assistant"
  parts: AssistantPart[]   // text / reasoning / tool / file / interaction
  time: number
  finished: boolean
  tokens?: { in: number; out: number }
}
```

`parts` 形状**完全沿用** `CardParts` 期望的 part 协议（type='text'|'reasoning'|'tool'|...），这样渲染层无需新写。

`SSE 事件` → 写入策略：

| SSE 事件 | store 动作 |
|---|---|
| `session` | `setAssistantSessionID(id)` |
| `delta` (field=text) | 累加最近 assistant message 的对应 text part |
| `delta` (field=reasoning) | 同上，写 reasoning part |
| `part` (tool / file / interaction) | upsert 到当前 message 的 parts |
| `message` (role=assistant, finished=true) | 标记 finished + 收集 tokens |
| `status` | `setAssistantStreamStatus(status)`（busy/idle/retry） |
| `error` | `notifyError()` + 释放 in-flight |
| `done` | 关流 |

**理由（rule 5/6）**：复用 cardTree 需要支撑"多 agent / 多 stage / boundary 切段"等 task 专属概念，对单线程聊天是死代码。压扁的 store 是这个场景的**第一性方案**。

### 3.5 后端：补缺的轻量端点

`/coding/message/stream` + `/coding/session/:id/messages` 已存在。v1 还缺：

**新增 `GET /coding/sessions`**（位置：`packages/opencorvus/src/server/routes/coding.ts`）：

```
入参：?directory=<workspaceDir>  (header 已有，复用)
        ?limit=20
出参：[{ sessionID, title, timeCreated, timeUpdated, lastMessagePreview }]
实现：Session.list({ kind: "assistant", directory: Instance.directory, limit })
```

**新增 `DELETE /coding/session/:sessionID`**：

```
作用：删除 assistant session 历史。
实现：Session.delete(sessionID)（已存在的方法）。
```

**新增 `POST /coding/session/:sessionID/abort`**：

```
作用：中断当前流（用户点 Stop）。
实现：复用 Session.abort(sessionID)（已存在）；route 体单行调用。
```

> 不引入新 `/assistant/*` 命名空间——同语义聚合到 `/coding/*`（rule 8/9）。

### 3.6 工作目录与 task 关系

- assistant session 在 *创建时* 绑定到 `Instance.directory`（即用户当前选中的 workspace）。
- 切 workspace → assistant 当前 session 不自动迁移（**显示 banner 提示用户**：当前会话属于 workspace X，已切换到 Y）。
- 用户切 task → assistant 面板**不响应**（assistant 与 task 解耦是 v1 的核心隔离原则）。

### 3.7 权限与安全

- 沿用 `agent.coding` 现有 permission ruleset（已含 `question: allow`, `webfetch: allow`，写文件/bash 走 ask）。
- `PermissionNext.Event.Asked` → 由 assistant SSE 的 `part` 事件中嵌入的 `interaction` part 渲染 → 复用 `<InteractionCard/>`。
- 不引入新的"全自动放行"开关（rule 6.1：教育模型应该走哪条路只能通过 prompt，不能 host 端绕过 ask）。

### 3.8 状态机问题（rule 13）

新面板**禁止**任何 step / phase / state enum。唯二允许的状态信号：

1. `rightPanelTab()`：`"inspector" | "assistant"` —— 纯 UI 切换，不是 LLM 流程状态。
2. `assistantStreamStatus()`：直接转发后端 `SessionStatus.Event.Status` 的字符串（busy/idle/retry/error），UI 仅做"是否显示 Stop 按钮"判定，不做任何状态转换决策。

---

## 4. UI 细节

### 4.1 Header（与 Inspector 视觉对齐）

```
┌──────────────────────────────────────────────┐
│  [Inspector] [Coding Assistant]    ▾ collapse │  ← 40px (--ui-panel-header-height)
└──────────────────────────────────────────────┘
```

- `<Tabs size="sm">`，被选中的 tab `data-active="true"`（沿用 tabs.css）。
- collapse 按钮位置不变（`#solidRightPanelHeaderCollapseControl`）。
- 折叠态：两个 tab 都隐藏，只剩竖排 collapse 按钮——沿用现有 `.sections[data-collapsed="true"]` 规则，不新增 CSS。

### 4.2 Assistant 面板布局

```
┌───────────── data-panel-tab="assistant" ─────────────┐
│  ┌── session-picker (24px) ──────────────────────┐   │
│  │  ⌄  当前会话标题…           [+ 新建] [⋯历史]   │   │
│  └─────────────────────────────────────────────────┘  │
│  ┌── transcript (flex 1, overflow-y) ───────────┐    │
│  │   <CardParts/> for each AssistantMessage      │    │
│  │   <InteractionCardList/>                       │    │
│  └─────────────────────────────────────────────────┘  │
│  ┌── ChatComposer (auto) ────────────────────────┐    │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### 4.3 历史会话切换

- session-picker 折叠下拉（参考已有 `.recent-dir-panel` 模式）。
- 显示最近 20 条 assistant session，按 timeUpdated DESC。
- 行内右侧"×" 删除（confirm 后 DELETE /coding/session/:id）。
- 点击行：切到对应 session，GET /coding/session/:id/messages → 重置 assistantStore → 渲染。

### 4.4 空状态

- 无会话时：transcript 区显示空态卡（参考 `surfaces/empty-state.css`），鼓励用户输入第一条消息。
- workspace 未选时：禁用 composer + 提示"请先选择 workspace"。

### 4.5 i18n key

```jsonc
"assistant.title": "Coding Assistant" / "Coding 助手"
"assistant.new_session": "New chat" / "新建对话"
"assistant.history": "History" / "历史"
"assistant.empty_hint": "Ask the coding agent anything about this workspace."
"assistant.workspace_required": "Select a workspace to start chatting."
"assistant.delete_confirm": "Delete this coding session?"
"assistant.stop": "Stop"
```

---

## 5. 文件改动清单（实施时按此 grep 复核 rule 35）

### 新文件

```
packages/overlay/src/store/assistant.ts              (~120 行)
packages/overlay/src/services/assistant.ts           (~200 行，SSE parse + 历史 CRUD)
packages/overlay/src/components/AssistantPanel.tsx   (~150 行)
packages/overlay/src/components/AssistantTranscript.tsx (~80 行)
packages/overlay/src/components/AssistantSessionPicker.tsx (~100 行)
packages/overlay/src/components/RightPanelTabs.tsx   (~40 行)
packages/overlay/src/store/right-panel.ts            (~30 行)
packages/overlay/src/styles/surfaces/assistant.css   (~80 行，仅与 inspector 不同的局部样式)
```

### 改动

```
packages/overlay/src/index.html
  - sections-header: 把 sections-title 替换为 #solidRightPanelTabs 挂载点
  - sections 下新增第二个 data-panel-tab="assistant" 容器
  - 引入 surfaces/assistant.css
packages/overlay/src/main.tsx
  - 新增 <RightPanelTabs/> + <AssistantPanel/> 的 render() 挂载
packages/overlay/src/store/settings.ts
  - 新增字段 rightPanelTab?: "inspector"|"assistant"
  - 新增字段 assistantSessionID?: string  (最近一次活跃 session，跨刷新恢复)
packages/overlay/src/i18n/en-US.json
packages/overlay/src/i18n/zh-CN.json
packages/overlay/src/styles/surfaces/inspector.css
  - 把已预留的 data-panel-tab 选择空间显式化（如果当前是注释占位）
packages/opencorvus/src/server/routes/coding.ts
  - 新增 GET /coding/sessions
  - 新增 DELETE /coding/session/:sessionID
  - 新增 POST /coding/session/:sessionID/abort
```

### 测试（rule 36）

```
packages/overlay/test/right-panel-tabs.test.ts
  - tab 切换持久化到 settingsStore
  - 折叠态下 tab 隐藏
packages/overlay/test/assistant-sse-store.test.ts
  - 模拟 SSE 事件序列，断言 store 正确累加 text/reasoning/tool/file/interaction parts
  - 断言 done 后 finished=true、tokens 写入
  - 断言 error 事件触发 notifyError 且 in-flight 释放
packages/overlay/test/assistant-session-isolation.test.ts
  - 切 task 不会影响 assistant store
  - 切 workspace 触发 banner（不自动迁移会话）
packages/opencorvus/test/server/coding-sessions.test.ts
  - GET /coding/sessions 按 directory 过滤
  - DELETE /coding/session/:id 真删（断言再 GET 返回 404）
  - POST /coding/session/:id/abort 释放流
```

---

## 6. 风险与 CLAUDE.md 对照

| Rule | 风险点 | 缓解 |
|---|---|---|
| **5/6 过度工程** | 重复实现一份 cardTree | 选择压扁 store（§3.4 已论证） |
| **7 禁 fallback** | 切 workspace 时是否"兜底找最近 session" | 显式 banner 让用户决定，不静默迁移 |
| **8 禁双源** | 复用 `/coding/*` 而非新开 `/assistant/*` 命名空间 | 端点全部聚合到 coding.ts |
| **9 抽象设计模式** | 复用 `<Tabs>`、`ChatComposer`、`CardParts` | 不重写 |
| **10 禁硬编码** | tab 字面量 / i18n / SSE 事件名 | 所有 tab key、i18n key、SSE 事件类型走 const |
| **11 拦截错误指令** | 若有人提议"复用 panelMessage()" | reviewer 必须拒——见 §2.3 |
| **13 禁状态机** | UI 仅响应 SSE 状态字符串，不做转换判定 | §3.8 已硬性约束 |
| **15 禁合成消息** | assistant 流必须全部走真实 SSE 事件，禁止前端伪造 part | §3.4 写入策略一一对应后端事件 |
| **17 禁死代码** | 替换 sections-title 时把原 static span 删干净 | 实施时 grep `sections.title` 看是否还有引用 |
| **24 二次复核** | 实施后必须用 codex / 独立 agent review | 作为完成门槛 |
| **35 调用点穷举** | grep `sections-title` / `rightPanelInspector` / `sectionsWidth` 列出全部调用点再改 | 实施 PR 描述里列表 |
| **36 测试** | §5 已列 4 类测试 | PR 必须含 |

---

## 7. 验收（rule 24/28b）

v1 完成的硬标准：

1. 右侧栏 header 显示两个 tab，点击切换，刷新后保持上次选择。
2. 切到 Coding Assistant、输入"读 packages/overlay/src/main.tsx 前 50 行总结"：
   - SSE 正常流式回显
   - tool call（read）卡片渲染
   - 完成后 tokens 显示
3. 输入"运行 ls"触发 bash 工具：
   - 出现权限 InteractionCard
   - 应答后命令执行
4. 切到 Inspector：原 Board 完整展示当前 task，零回归（与现状 diff 为 0）。
5. 中间面板（Conversation）和 task workflow 完全不受影响（task 仍能正常 plan/build/deliver）。
6. 切换 workspace：banner 提示当前 assistant 会话归属（不自动迁移）。
7. 删除一条历史 session：后端确实 DELETE，刷新后不再出现。
8. 任一接口异常时，UI 走 `notifyError` 不静默吞错。

不达到上述任一条 = v1 未交付（rule 28b）。

---

## 8. v2 + 候选（不在 v1 范围）

- "@当前选中文件"上下文（需 IDE 端配合）。
- 一键"把这段对话提升为 task"（assistant ↔ task 桥）。
- 多 workspace 同时挂多个 assistant session 的总览。
- inline completion / @符号补全。
- 自定义 system prompt / 自定义 tool 白名单 per session。

---

## 9. 开放问题（v1 落地前需用户确认）

1. **历史会话**保留策略：永久 / 30 天 / N 条？v1 默认按 timeUpdated 显示最近 20 条，不主动删除。
2. **会话标题**：默认用首条 user 消息前 40 字符，还是调用 `agent.title`（已存在）异步生成？建议：首消息派发后立即调 `agent.title`，与 task 路径一致。
3. **token / cost 显示**：v1 是否显示？建议显示，复用 ChatBubble 现有 tokens chip 样式。
4. **CodingCLI 复用**：目前 `coding.ts` 同时承载"启动外部 coding CLI"（cli/profiles, cli/open）和"内嵌 assistant"。是否要拆分文件？建议**不拆**（rule 9 主题一致），只在文件内分 section。
