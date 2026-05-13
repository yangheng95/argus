# Agent File Changes Under Message Cards

> 2026-05-13 / 用户要求：把所有 agent 的文件改动显示在消息卡片下方，先分析影响面再设计方案。

> 2026-05-13 修订：用户要求“用 diff 的形式展示每个 agent 的修改文件”。附件条不再只显示横向 chip，改为每个文件一张 compact diff row：文件路径 + 状态 + 增删统计 + `DiffView` 内容预览。该展示仍属于对应 `ChatBubble`，折叠消息正文时也必须保留在气泡 foot 上方，方便扫描 agent 产出。

## 影响面

### 现有数据源

- `packages/overlay/src/components/ChatBubble.tsx` 是 `kind="agent"` 与 `kind="message"` 的统一消息卡片入口。
- `packages/overlay/src/components/CardParts.tsx` 会把 `tool` part 渲染成工具卡。文件写入类工具的结构化 diff 目前只在展开工具卡后通过 `InlineToolPart` 展示。
- `packages/overlay/src/components/InlineToolPart.tsx` 内部已有 `metadata.files` / `metadata.filediff` / `input.path` 等解析逻辑，但解析函数是组件局部函数，无法被消息卡片页脚复用。
- `part.type === "patch"` 已有 `part.files`，当前只作为正文中的 `msg-patch` chip 渲染。
- goal step 的交付文件改动在 `CardNode.stepPayload.changedFiles`，用于 step/goal 维度，不是 agent message 维度；本需求不把 goal 级结果反塞到每个 agent 消息里。

### UI owner surface

文件改动属于某个 agent 消息卡片的产出，不是窗口级控制，也不是 titlebar 能力。展示位置应在 `ChatBubble` 的消息卡片下方、foot 上方或 bubble 外紧贴下方，作为该消息的附件/摘要区。

### 不改范围

- 不改 `workbench/board.ts`、OpenAPI、SDK 类型。已有协议已经带足信息。
- 不新增后端 SSE 事件。
- 不新增全局文件改动聚合状态，避免与右侧 Files panel 形成双源。
- 不把所有 goal 的 `changedFiles` 强行复制到 agent 卡片，避免 goal 级和 agent 级语义混淆。

## 设计

### 单一收集器

新增 `packages/overlay/src/utils/file-change-summary.ts`，作为唯一前端收集器：

- 从 `CardNode.parts`、`childIDs`、transient `children` 递归收集。
- 支持 `patch.files`。
- 支持 tool part 的 `state.metadata.files` 与 `state.metadata.filediff`。
- 支持 write/edit/applypatch 类工具的输入路径。
- 以标准化后的 path 去重；同一文件多次出现时保留更强信息（status、additions、deletions）。
- 不读取全局 Files panel 数据，不从后端另查。

### 展示组件

新增 `AgentFileChanges` 组件：

- 只接收 `CardNode`，内部调用收集器。
- 只在 `node.kind === "agent"` 且有文件改动时渲染。
- 显示为紧凑 diff 附件区：顶部文件数与增删统计，下方每个文件一张 compact diff row。
- 单个文件 row 使用 monospace path、状态 tone、`+/-` 统计，并复用 `DiffView` 展示可用的 before/after diff；缺少内容预览时显示明确空态，不伪造 diff。
- 文件路径使用 `selectedTaskDirectory()` 做相对显示；无法相对化时显示原始 path，不用第二套短路径兜底。

### ChatBubble 接入

`ChatBubble` 在 bubble 主体后方渲染：

```tsx
<Show when={normalizedRole() !== "user"}>
  <AgentFileChanges node={props.node} />
</Show>
```

该位置属于消息卡片本身的下方信息，位于 expanded body 之后、foot 之前，不进入 body 折叠内容，也不进入 titlebar。用户折叠消息时仍能看到文件改动摘要，满足扫描需求。

## 验收标准

1. agent 消息卡片下方显示该 agent 子树内所有文件改动。
2. user 消息卡片不显示 agent 文件改动条。
3. 工具 metadata diff、patch part、write/edit/applypatch 输入路径都能被同一个收集器识别。
4. 相同文件去重，不重复刷屏。
5. 样式不使用硬编码颜色，使用现有 token，移动端不溢出。
6. 测试覆盖收集器和 ChatBubble 接入源码守护。
