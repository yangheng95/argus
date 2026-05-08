帮我做一个生产级的多模型 AI Chat Web 应用（Vite + React + TypeScript），整体定位对标 ChatGPT / Claude.ai / Poe，UI/UX 现代专业，深色/浅色主题切换，可在 Chrome 桌面端正常运行，本地启动后即可进入。

【账户与权限】
1. 启动页支持 "Google 一键登录"（mock 异步延迟 800-1200ms 后登录成功）和 "邮箱+密码" 登录两种入口，登录态持久化到 localStorage，刷新后自动恢复。
2. 顶部右上角头像菜单包含：账户设置、API Keys、订阅信息（mock 显示"免费版 / 已用 X / Y 次"）、深浅色主题、语言（中/英）、退出登录。
3. API Keys 页面分别支持 Deepseek、OpenAI、Anthropic 三家 Key 的填写、保存（加密存储到 IndexedDB）、连通性测试按钮（实际打 /v1/models 或同等端点验证可用性）。

【模型与对话】
4. 顶部模型选择器是分组下拉，按 provider 分组展示：Deepseek（deepseek-chat / deepseek-reasoner）、OpenAI（gpt-4o-mini mock 占位）、Anthropic（claude-3-5-sonnet mock 占位）。仅 Deepseek 走真实 SSE，其他在未配置 Key 时按 mock 流返回。
5. 流式对话使用 SSE，必须支持：发送中可中断（停止生成）、生成失败可一键 Retry、对任意助手消息可 "Regenerate"、对任意用户消息可 Edit 后从该点重新分支（保留旧分支可切换）。
6. 会话级断点续传：用户在生成中刷新页面，重新打开后能从最后一条增量继续渲染，不丢字（通过保存增量到 IndexedDB + 重连同一 SSE 通道实现）。
7. 推理类模型（如 deepseek-reasoner）需在助手气泡内显示可折叠的"思考过程"块，与最终回答分离。

【输入与多模态】
8. 输入框支持：粘贴/拖拽上传图片、PDF、txt、md、代码文件，附件展示为缩略卡片可删除；图片附件随消息发送，PDF/文本类附件提取纯文本拼接到 prompt 末尾。
9. 输入框支持斜杠命令：/clear 清空当前会话，/system 编辑系统提示词，/temp 调整 temperature，/model 快速切换模型，输入即弹出补全列表。
10. 支持 @ 引用历史消息：在输入框内 @ 可弹出当前会话消息列表，选中后将该消息作为上下文片段附加。

【消息渲染】
11. 助手消息渲染需支持：GitHub Flavored Markdown、代码块语法高亮（多语言）、行内 / 块级数学公式（KaTeX）、Mermaid 图表、表格、任务列表、链接预览。
12. 代码块右上角提供 复制 / 下载 / "Run in Sandbox"（mock 弹窗显示 stdout）按钮。
13. 每条消息底部展示 token 用量、生成耗时、模型标签；可复制全文、点赞/点踩反馈、分享单条（生成只读分享链接，路由 /s/:id）。

【会话管理】
14. 左侧会话列表分组：Pinned / Today / Yesterday / Last 7 days / Older，支持新建文件夹、拖拽分组、重命名、删除（带确认）、置顶、搜索（标题+内容全文）、导出（Markdown / JSON）。
15. 支持会话标签（多色），列表可按标签过滤；空状态有插图与 New chat 引导。
16. 全局搜索（Cmd/Ctrl+K）：跨会话搜索消息，结果可点击跳转并高亮匹配。

【New Chat 起始页】
17. 未发起对话时展示 "示例 Prompt 卡片网格"（写作 / 代码 / 数学 / 角色扮演 / 数据分析 5 类，每类 2-3 张卡），点击直接预填到输入框。
18. 起始页底部展示当日 Tips 与最近 3 条会话快捷入口。

【设置与高级】
19. 设置面板支持：默认模型 / temperature / max_tokens / top_p / 系统提示词模板（支持多套切换）、自定义快捷键、上下文窗口截断策略。
20. 提供 keyboard shortcut 浮层（按 ?）说明所有快捷键。

【数据与存储】
21. 所有会话与设置以 IndexedDB 持久化（schema 含 conversations / messages / settings / api_keys 四个 store），刷新无损；提供"清空所有数据"按钮（带二次确认）。

【非功能要求】
22. 整体响应：移动端宽度 360px 以上可用，桌面端居中最大宽度 1280px。
23. 真实可跑：使用真实 Deepseek API 完成至少一次端到端 streaming 对话；UI 完成度对标 chatgpt.com/claude.ai 视觉水平（无占位文字、无 lorem ipsum）。
24. 代码质量：TypeScript strict、组件分层清晰（features / components / hooks / lib / store）、无 console.error 红字、初次加载 < 5s。