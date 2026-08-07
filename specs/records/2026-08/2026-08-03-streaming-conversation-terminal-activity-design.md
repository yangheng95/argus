# 流式对话末端活动反馈与工具详情设计

## Recall

- 用户原始要求：修复工具展开详情格式错乱；移除工具行右侧的“正在执行”文字，改由工具本身呈现自然流畅的波浪；消息生成中保留“正在生成”文字并加同样动效；对话流最后仍在等待的内容都必须具有可感知的活动样式；先给方案与 HTML 样稿确认。
- 验收指标：运行工具没有独立右侧状态词；仅真正运行的末端工具有波浪；末端文本带“正在生成”与波浪；JSON/多行输出不会重叠并有固定高度滚动；历史完成内容无动效。
- 硬约束：本轮不改生产渲染；复用现有对话 part 与 disclosure 状态；不新增 UI 自动化测试；最终实施以真实客户端人工截图验收。
- 已读取资料：`specs/README.md`、`specs/records/2026-08/README.md`、`InlineToolPart.tsx`、`CardParts.tsx`、`messages.css`。
- 全仓 grep：`showPlainOutput`、`msg-tool-output`、`msg-streaming-status`、`ExecutionDisclosureRun`、`InlineToolPart`，调用点集中于 `Card.tsx`、`CardParts.tsx`、`ChatBubble.tsx`、`InlineToolPart.tsx` 与 `messages.css`。
- 独立 agent 反馈：未委托；本轮为用户请求的方案与 mock 评审。

## 现状与直接原因

`InlineToolPart` 在工具完成后遇到普通输出时，把 `state.output` 交给 `StaticTextPart`。密集 JSON 随后按 Markdown 文本参与普通段落布局；连续工具输出和换行不再拥有数据区边界，正是截图中多段 JSON 相互回流、重叠的直接原因。

`ExecutionDisclosureRun` 还在工具名称右侧额外渲染“正在执行”，同时 CSS 又对工具名称、详情和这个文字分别动画，造成活动状态从一个语义被拆成多个视觉对象。

## 方案对比

1. 推荐：**末端所有权 + 结构化数据区**。最后一个可展示的活动 part 唯一拥有活动提示；运行工具让图标、名称、摘要同步流过柔和高光；生成文本只追加一个“正在生成”。JSON 及原始输出在独立 `pre` 数据区展示。这与现有 part 投影匹配，视觉信息最少。
2. 状态角标：在每一条工具或消息右侧加加载徽标。实现小，但会重现目前“正在执行”抢占行尾的问题，且多 Agent 并行时噪声最大。
3. 整行闪烁/骨架：能强提示运行，但破坏内容可读性，且用户已明确不希望不丝滑的闪烁。

采用方案 1。

## 交互与视觉规范

- **唯一活动归属**：以当前 conversation/Agent 自己最后一个可渲染 part 为准，不能从父任务、兄弟子任务或历史 part 推导。末端为 `text` 时显示“正在生成”；末端为 `tool` 且 `running/pending` 时工具本身动画；结束、错误、前序消息均静态。
- **波浪**：使用约 6% 行宽的单次高光从左到右匀速经过，峰值两侧保留短而柔和的过渡，避免整行泛亮或速度突变；周期约 5.6 秒（非闪烁、非光标）。图标、工具名、工具摘要的相位错开很小，视觉上像一条波；`prefers-reduced-motion` 下回退为强调色静态文字。
- **生成提示位置**：`正在生成` 永远放在活动文本块的最后，独占下一行并与正文左边缘对齐；它不是行尾标签，也不会因上一行长度变化而跳动。
- **工具折叠行**：只保留图标、名称、摘要和紧随文本的展开箭头；移除单独的“正在执行”。
- **工具详情**：输入、实时输出、完成输出各自为语义数据区；JSON 保留缩进和换行，不再经 Markdown 解析；每个数据区固定最大阅读高度并独立纵向滚动。命令、代码、todo、文件 diff 和浏览器证据继续使用其已有专用视图，不与普通 JSON 混排。

## 未来实施边界

| 位置 | 改动 |
| --- | --- |
| `packages/overlay/src/components/CardParts.tsx` | 移除右侧运行状态节点，将运行属性只传给工具行。 |
| `packages/overlay/src/components/TextPart.tsx`、`ChatBubble.tsx` | 保留且统一末端文本的“正在生成”归属，避免非末端重复标记。 |
| `packages/overlay/src/components/InlineToolPart.tsx` | 为普通 JSON/原始工具输出提供语义化、预格式化的数据输出视图，取代 `StaticTextPart` 的普通 Markdown 路径。 |
| `packages/overlay/src/styles/surfaces/messages.css` | 合并成同一条温和活动波 token；移除工具行右侧状态波；增加数据区高度与滚动样式。 |

## 样稿

[`streaming-conversation-live-activity-prototype.html`](../../artifacts/streaming-conversation-live-activity-prototype.html) 可直接打开。它包含浅色/深色切换、工具折叠展开、历史完成工具、唯一的运行工具、以及唯一的生成中文本。

## 确认点

用户确认这版样稿后，再进入生产实施和真实客户端视觉验收。本轮没有修改应用代码或程序包。
