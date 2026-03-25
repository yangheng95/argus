# Overlay 渲染层迁移方案：Solid.js + Vite

## 现状

- **架构**: 单文件 `app.js`（11500 行），纯 vanilla JS，innerHTML 序列化渲染
- **构建**: 无打包器，Tauri 直接加载 `src/` 下的静态文件
- **渲染**: `renderConversation()` 每次全量重建 HTML 字符串 → `replaceWith` 替换 DOM
- **问题**: delta 事件无法增量渲染，每 16ms 全量重建 = 不是流式刷新

## 框架选型：Solid.js

| 维度 | Solid.js | Preact | Lit | 当前 vanilla |
|------|----------|--------|-----|-------------|
| 更新粒度 | **DOM 节点级** | 组件级 | 属性级 | 组级（整个 turn） |
| 单行文本更新 | **~0.3ms** | ~8ms | ~3ms | ~15ms+ |
| 流式追加 | **信号 → text node** | VDOM diff | 模板重渲染 | innerHTML 重建 |
| 内存 | 低（无 VDOM） | 中 | 低 | 低 |
| 对齐 OpenCode | **完全一致** | 不一致 | 不一致 | — |

**选 Solid.js 的理由**：
1. 流式文本追加是核心场景，信号级更新是量级碾压
2. 直接对齐 OpenCode 技术栈，未来共享组件零摩擦
3. Vite 是一次性成本，Solid 的长期性能收益远超配置投入

## 分阶段计划

### Phase 0: Vite 工具链 + 回退 hack（1天）

**目标**: 搭建 Vite 构建环境，回退临时 DOM patch

#### 0a. Vite + Solid 配置

```
packages/overlay/
  vite.config.ts
  tsconfig.json            (仅用于 JSX 类型提示，不强制 TS)
  src/
    main.tsx               (Solid 入口)
    legacy/
      app.js               (原 11500 行文件，暂时保留)
      workspace.js
      interactions.js
    index.html             (改为 Vite 入口)
```

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
```

```json
// package.json 新增
{
  "devDependencies": {
    "vite": "^6",
    "vite-plugin-solid": "^2",
    "solid-js": "^1.9"
  }
}
```

#### 0b. 回退 DOM hack

回退 Phase A 的临时补丁：
- patchPartDOM / patchDeltaDOM
- renderTextPart 的 data-part-id
- applyMessageEvent 返回 "delta"/"structure"

恢复 flushEvents 为简单版（有变化就 renderConversation）。

#### 0c. Tauri 构建集成

修改 `script/build.ts`：先 `vite build` 产出 `dist/`，再用 dist 文件喂给 Tauri。

**验收**: `bun run dev` 能热更新，`bun run build` 产出可用的 overlay exe。

### Phase 1: Solid.js 消息组件（2天）

**目标**: 用 Solid 组件替换消息面板渲染，实现真正的流式输出

#### 1a. 状态层：createStore

```tsx
// src/store/messages.ts
import { createStore, produce } from "solid-js/store";

export const [messageStore, setMessageStore] = createStore({
  messages: [] as Message[],
  parts: {} as Record<string, Part[]>,   // messageID → Part[]
  agentEvents: [] as AgentEvent[],
});

// 从 applyMessageEvent 改造而来
export function applyEvent(event: SSEEvent) {
  const type = event.type;
  const p = event.payload || {};

  if (type === "message.updated") {
    setMessageStore("messages", produce((msgs) => {
      const idx = msgs.findIndex((m) => m.id === p.info.id);
      if (idx >= 0) msgs[idx] = p.info;
      else msgs.push(p.info);
    }));
    return;
  }

  if (type === "message.part.updated") {
    setMessageStore("parts", p.part.messageID, produce((parts = []) => {
      const idx = parts.findIndex((x) => x.id === p.part.id);
      if (idx >= 0) parts[idx] = p.part;
      else parts.push(p.part);
    }));
    return;
  }

  if (type === "message.part.delta") {
    // 直接 produce 修改 text 字段 — Solid 信号追踪到 part.text 变化
    // 只有引用了 part.text 的 DOM 节点更新
    setMessageStore("parts", p.messageID, produce((parts = []) => {
      const part = parts.find((x) => x.id === p.partID);
      if (part && p.field === "text") part.text = (part.text || "") + p.delta;
      if (part && p.field === "raw" && part.state) part.state.raw = (part.state.raw || "") + p.delta;
    }));
    return;
  }
}
```

#### 1b. 组件层

```tsx
// src/components/TextPart.tsx
import { createMemo } from "solid-js";

export function TextPart(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text));
  return <div class="msg-text" innerHTML={html()} />;
}

// src/components/ToolPart.tsx
export function ToolPart(props: { part: ToolPartData }) {
  return (
    <div class="msg-tool">
      <span class="tool-name">{props.part.tool}</span>
      <Show when={props.part.state?.status === "pending" && props.part.state?.raw}>
        <div class="msg-tool-input">{props.part.state.raw}</div>
      </Show>
      <Show when={props.part.state?.status === "completed" && props.part.state?.output}>
        <div class="msg-tool-output">{props.part.state.output}</div>
      </Show>
    </div>
  );
}

// src/components/MessageView.tsx
import { For, Switch, Match } from "solid-js";

export function MessageView(props: { message: Message; parts: Part[] }) {
  return (
    <article class="turn msg" data-role={props.message.role}>
      <div class="msg-head">
        <span class="msg-role">{roleLabel(props.message.role)}</span>
      </div>
      <div class="msg-bubble">
        <For each={props.parts}>
          {(part) => (
            <Switch>
              <Match when={part.type === "text"}>
                <TextPart text={part.text} />
              </Match>
              <Match when={part.type === "tool"}>
                <ToolPart part={part} />
              </Match>
              <Match when={part.type === "reasoning"}>
                <ReasoningPart part={part} />
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </article>
  );
}

// src/components/AgentCard.tsx
export function AgentCard(props: { stage: string; status: string; messages: Message[]; round: number }) {
  const [expanded, setExpanded] = createSignal(props.status === "running");
  return (
    <article class="turn msg agent-card" classList={{ "agent-card--expanded": expanded() }}>
      <div class="agent-card-header" onClick={() => setExpanded(!expanded())}>
        <StatusBadge status={props.status} />
        <span class="agent-card-label">{agentStageLabel(props.stage)}</span>
        <Show when={props.round > 0}>
          <span> #{props.round}</span>
        </Show>
      </div>
      <Show when={expanded()}>
        <div class="agent-card-body">
          <For each={props.messages}>
            {(msg) => <MessageView message={msg.info} parts={messageStore.parts[msg.info.id] || []} />}
          </For>
        </div>
      </Show>
    </article>
  );
}

// src/components/Conversation.tsx
export function Conversation() {
  // 从 store 派生分类（main vs agent channels）
  const classified = createMemo(() => classifyMessages(messageStore.messages, messageStore.parts, messageStore.agentEvents));

  return (
    <div class="chat-scroll" ref={scrollRef}>
      <For each={classified().mainMessages}>
        {(msg) => <MessageView message={msg.info} parts={messageStore.parts[msg.info.id] || []} />}
      </For>
      <For each={classified().agentCards}>
        {(card) => <AgentCard {...card} />}
      </For>
    </div>
  );
}
```

#### 1c. 桥接层：legacy app.js → Solid 组件

```tsx
// src/main.tsx
import { render } from "solid-js/web";
import { Conversation } from "./components/Conversation";

// Solid 接管 #chatScroll
const dispose = render(() => <Conversation />, document.getElementById("chatScroll")!);

// 暴露给 legacy app.js 的接口
window.__solidBridge = {
  applyEvent,          // SSE 事件 → store
  syncMessages,        // 全量加载 → store
  clearMessages,       // 切换 task → 清空 store
};
```

legacy `app.js` 的 `flushEvents` 改为：
```javascript
function flushEvents() {
  for (const event of batch) {
    window.__solidBridge.applyEvent(event);
  }
  // 无需手动 render — Solid 信号自动触发 DOM 更新
}
```

**验收**: delta 到达 → store 更新 → Solid 信号触发 → 只有变化的 text node 更新。用户看到逐字追加。

### Phase 2: Board + 侧边栏迁移（2天）

- `src/components/Board.tsx` — task board 面板
- `src/components/TaskList.tsx` — 左侧 task 列表
- `src/components/ExecutorLog.tsx` — executor 事件日志
- `src/components/InteractionPanel.tsx` — 权限/问答交互

legacy app.js 的 `renderBoard`、`renderTaskList` 等逐个替换为 Solid render。

### Phase 3: 完全脱离 legacy app.js（2天）

**目标**: app.js 的所有逻辑迁移到 Solid + TypeScript 模块

```
src/
  main.tsx                 (入口)
  App.tsx                  (根组件)
  store/
    messages.ts            (消息 store + applyEvent)
    board.ts               (board store)
    settings.ts            (overlay 设置)
  services/
    sse.ts                 (SSE 连接管理)
    api.ts                 (HTTP API 封装)
    sync.ts                (syncTask / loadBoard)
  components/
    Conversation.tsx
    MessageView.tsx
    TextPart.tsx
    ToolPart.tsx
    AgentCard.tsx
    Board.tsx
    TaskList.tsx
    ExecutorLog.tsx
    ChatComposer.tsx
  utils/
    markdown.ts
    i18n.ts
    time.ts
  legacy/                  (待删除)
    app.js                 → 逐步清空
```

**验收**: `legacy/app.js` 可以删除，所有功能由 Solid 组件 + TypeScript 模块承载。

### Phase 4: 性能优化（1天）

- 消息虚拟滚动（`@solid-primitives/virtual`）— 只渲染可见区域的消息
- Markdown 渲染 Web Worker 化 — 不阻塞主线程
- Agent card body 懒渲染 — 折叠时不创建 DOM

## Tauri 构建集成

当前 `script/build.ts` 直接复制 `src/` 文件到 Tauri。改为：

```typescript
// script/build.ts 修改
async function buildOverlay() {
  // 1. Vite 构建
  await $`bun run vite build`;
  // 2. 复制 dist/ 到 Tauri
  copyDir("dist", tauriUIDir);
}
```

开发模式：`vite dev` 热更新 + Tauri dev server。

## 验收标准

1. delta 到达后只更新一个 DOM text node（Chrome DevTools 闪烁检查）
2. 1000+ delta/s 不卡顿（Performance tab 无长帧）
3. Agent card 展开状态下文本逐字追加可见
4. 切换 task 不闪烁、不丢消息
5. SSE 断线重连后恢复正常
6. 现有功能不回归（board、交互、权限、i18n 等）
7. `bun run build` 产出的 overlay exe 正常工作
