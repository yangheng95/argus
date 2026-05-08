# PRD：生产级多模型 AI Chat Web 应用

版本：v1.0
产品形态：Web 应用
技术栈：Vite + React + TypeScript
目标平台：Chrome 桌面端优先，移动端 360px 以上可用
产品定位：对标 ChatGPT、Claude.ai、Poe 的现代化多模型 AI Chat 客户端

---

## 1. 产品概述

本产品是一款生产级多模型 AI Chat Web 应用，面向需要在单一界面中使用、管理和对比多个大模型的用户。产品支持 Deepseek、OpenAI、Anthropic 三类模型入口，其中 Deepseek 需要实现真实端到端 SSE 流式对话能力，OpenAI 与 Anthropic 在未配置 Key 或 v1 限制下可使用 mock 流式响应占位。

应用需要具备完整的账户登录、API Key 管理、会话管理、消息流式生成、多模态附件输入、Markdown 富文本渲染、全局搜索、设置面板、主题切换、语言切换、本地持久化等能力。产品启动后应可直接进入登录页，本地运行即可体验完整核心流程。

整体 UI/UX 需要达到现代专业 AI Chat 产品水准，视觉参考 ChatGPT、Claude.ai、Poe，要求交互顺滑、状态清晰、无明显占位感、无 lorem ipsum、无破损页面。

---

## 2. 产品目标

### 2.1 核心目标

1. 构建一个可真实运行的多模型 AI Chat Web 应用。
2. 完成 Deepseek 真实 SSE 流式对话链路。
3. 支持本地持久化账户、设置、API Keys、会话、消息与生成状态。
4. 支持刷新恢复登录态、会话状态与未完成流式生成内容。
5. 提供接近成熟 AI Chat 产品的 UI/UX 完成度。
6. 代码结构具备生产级可维护性，便于后续接入更多模型、文件解析、云同步与团队协作能力。

### 2.2 非目标

v1 不要求实现真实后端账户系统、真实支付订阅系统、真实云端同步、真实分享服务、真实代码沙箱执行环境。相关能力在 v1 中以本地 mock 或只读路由方式实现，但交互与数据结构需要为后续真实服务预留扩展空间。

---

## 3. 用户角色

### 3.1 普通用户

希望快速打开应用，与 AI 进行多轮对话，管理历史会话，上传文本或图片附件，使用 Markdown、代码、数学公式、Mermaid 等富文本输出能力。

### 3.2 高级用户

希望配置自己的模型 API Key，切换模型，调整 temperature、max_tokens、top_p、系统提示词、上下文截断策略，并使用快捷键、标签、导出、搜索等高级能力。

### 3.3 开发者用户

希望通过 API Key 接入 Deepseek，验证真实 SSE 流式输出，查看 token、耗时、模型标签，并对代码块进行复制、下载、mock 沙箱运行。

---

## 4. 成功指标

### 4.1 功能成功指标

1. 用户首次启动应用后可以完成登录。
2. 刷新页面后登录态可以自动恢复。
3. 用户可以保存 Deepseek API Key 并完成连通性测试。
4. 用户可以选择 deepseek-chat 或 deepseek-reasoner 发起真实流式对话。
5. 用户可以在生成中停止输出。
6. 用户刷新页面后，当前会话、消息与设置不丢失。
7. 用户可以上传图片、PDF、txt、md、代码文件并随消息发送。
8. 用户可以跨会话搜索消息并跳转定位。
9. 用户可以切换深色/浅色主题和中英文语言。
10. 用户可以导出会话为 Markdown 或 JSON。

### 4.2 体验成功指标

1. 首屏加载时间小于 5 秒。
2. 生成中状态、错误状态、空状态、加载状态均有明确 UI 表达。
3. 桌面端布局不拥挤，主内容区最大宽度 1280px。
4. 移动端 360px 以上宽度可完成核心聊天流程。
5. 页面中不得出现未处理异常、console.error 红字或破损占位内容。

---

## 5. 产品信息架构

应用整体由以下主要模块组成：

1. 登录页
2. Chat 主界面
3. 左侧会话列表
4. 顶部模型选择与用户菜单
5. New Chat 起始页
6. 消息流与消息操作区
7. 输入框与附件区
8. API Keys 页面
9. 设置面板
10. 全局搜索浮层
11. 快捷键说明浮层
12. 分享只读页面 `/s/:id`

---

## 6. 核心用户流程

### 6.1 首次登录流程

1. 用户打开本地应用。
2. 系统检测 localStorage 中无登录态。
3. 展示启动登录页。
4. 用户选择 Google 一键登录或邮箱密码登录。
5. 若选择 Google 登录，系统展示 800-1200ms mock 异步加载状态。
6. 登录成功后，将登录态写入 localStorage。
7. 用户进入 Chat 主界面。
8. 刷新页面后系统自动恢复登录态并进入上一次使用状态。

### 6.2 配置 Deepseek Key 并发起真实对话

1. 用户点击右上角头像菜单。
2. 进入 API Keys 页面。
3. 输入 Deepseek API Key。
4. 点击保存。
5. 系统使用 Web Crypto 加密后写入 IndexedDB。
6. 用户点击连通性测试。
7. 系统请求 Deepseek `/v1/models` 或等效模型列表接口验证 Key。
8. 验证成功后显示可用状态。
9. 用户返回 Chat 主界面。
10. 在模型选择器中选择 deepseek-chat 或 deepseek-reasoner。
11. 输入问题并发送。
12. 系统通过 SSE 渲染增量响应。
13. 用户可停止生成、重试失败请求、重新生成助手消息或编辑用户消息形成新分支。

### 6.3 生成中刷新恢复流程

1. 用户发送消息后，助手消息开始流式生成。
2. 每个 SSE 增量实时写入 IndexedDB。
3. 用户刷新页面。
4. 应用重启后读取最后会话、消息与未完成生成状态。
5. 系统尝试重连同一 SSE 通道或恢复生成任务。
6. 已写入的增量立即渲染，不丢字。
7. 若服务端无法续接，则展示可恢复失败状态，并提供 Retry 按钮。

### 6.4 附件输入流程

1. 用户拖拽或粘贴图片、PDF、txt、md、代码文件。
2. 输入框上方展示附件缩略卡片。
3. 用户可删除任一附件。
4. 图片附件随消息作为图片上下文发送。
5. PDF 与文本类附件提取纯文本。
6. 提取后的文本拼接到 prompt 末尾，作为本轮上下文。
7. 消息发送后，附件信息与解析文本摘要写入 IndexedDB。

### 6.5 会话搜索与跳转流程

1. 用户按 Cmd/Ctrl+K 打开全局搜索。
2. 输入关键词。
3. 系统跨所有会话标题与消息内容搜索。
4. 展示匹配结果、会话标题、消息片段、时间。
5. 用户点击结果。
6. 系统跳转到对应会话与消息。
7. 匹配内容高亮显示。

---

## 7. 功能需求

## 7.1 账户与权限

### 7.1.1 登录页

登录页需要支持两种入口：

1. Google 一键登录
2. 邮箱 + 密码登录

Google 登录为 mock 登录，点击后进入异步加载状态，延迟 800-1200ms 后登录成功。

邮箱密码登录不要求真实后端校验，但需要具备完整表单体验，包括：

1. 邮箱格式校验
2. 密码非空校验
3. 登录按钮 loading 状态
4. 错误提示区域
5. Enter 键提交
6. 登录成功后持久化登录态

### 验收标准

1. 用户点击 Google 登录后，按钮进入 loading 状态。
2. 800-1200ms 后进入 Chat 主界面。
3. 用户使用合法邮箱与非空密码可以登录。
4. 登录成功后刷新页面仍保持登录状态。
5. 用户退出登录后清除 localStorage 中的登录态。

---

### 7.1.2 登录态持久化

登录状态存储于 localStorage，至少包含：

```ts
{
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  loginProvider: "google" | "email";
  loggedInAt: number;
}
```

刷新页面后，应用应自动读取 localStorage 并恢复登录状态。

### 验收标准

1. 刷新页面后无需重新登录。
2. localStorage 缺失或格式损坏时，自动回到登录页。
3. 退出登录后刷新页面仍保持未登录状态。

---

### 7.1.3 右上角头像菜单

顶部右上角头像菜单包含：

1. 账户设置
2. API Keys
3. 订阅信息
4. 深浅色主题切换
5. 语言切换：中文 / 英文
6. 退出登录

订阅信息为 mock 展示，格式为：

```text
免费版 / 已用 X / Y 次
```

X 为当前本地统计的已发送请求次数，Y 为免费版 mock 限额。

### 验收标准

1. 点击头像后出现菜单。
2. 菜单项均可点击。
3. API Keys 可进入 API Key 管理页。
4. 主题切换即时生效并持久化。
5. 语言切换即时更新主要 UI 文案并持久化。
6. 退出登录后返回登录页。

---

## 7.2 API Keys 管理

### 7.2.1 支持的 Provider

API Keys 页面需要分别支持：

1. Deepseek
2. OpenAI
3. Anthropic

每个 Provider 均提供：

1. Key 输入框
2. 保存按钮
3. 删除按钮
4. 显示 / 隐藏 Key 按钮
5. 连通性测试按钮
6. 最近测试状态
7. 最近测试时间
8. 错误信息展示

---

### 7.2.2 加密存储

API Key 不得明文存储在 localStorage。所有 API Key 需要加密后存储到 IndexedDB 的 `api_keys` store。

加密建议使用 Web Crypto API：

1. AES-GCM 加密 Key 内容
2. 每条 Key 使用独立 iv
3. IndexedDB 中存储 provider、密文、iv、创建时间、更新时间、最近测试状态
4. 不在 UI 中完整展示 Key，仅展示脱敏结果，例如 `sk-****abcd`

前端本地加密无法抵御本机浏览器环境被完全控制的情况，但应避免普通存储层面的明文暴露。

---

### 7.2.3 连通性测试

每个 Provider 的连通性测试需要调用对应模型列表或等效接口：

1. Deepseek：`/v1/models` 或等效端点
2. OpenAI：`/v1/models` 或等效端点
3. Anthropic：模型列表或等效可验证端点

测试结果包括：

1. 测试中
2. 成功
3. 失败
4. 错误原因
5. HTTP 状态码
6. 测试时间

### 验收标准

1. 保存 Key 后刷新页面仍可恢复。
2. API Key 不出现在 localStorage 明文中。
3. 点击测试后按钮进入 loading 状态。
4. 测试成功展示绿色成功状态。
5. 测试失败展示明确错误原因。
6. 删除 Key 后对应 Provider 回到未配置状态。

---

## 7.3 模型与对话

### 7.3.1 模型选择器

顶部模型选择器为分组下拉菜单，按 Provider 分组展示。

Deepseek：

1. `deepseek-chat`
2. `deepseek-reasoner`

OpenAI：

1. `gpt-4o-mini`，v1 mock 占位

Anthropic：

1. `claude-3-5-sonnet`，v1 mock 占位

模型下拉需要显示：

1. Provider 名称
2. 模型名称
3. 是否已配置 Key
4. 是否真实可用
5. 是否 mock
6. 推理模型标记

### 验收标准

1. 下拉菜单按 Provider 分组。
2. 当前模型在顶部清晰显示。
3. 切换模型后新消息使用新模型。
4. Deepseek 模型配置 Key 后可真实调用。
5. OpenAI 与 Anthropic 在未配置 Key 时返回 mock 流式响应。

---

### 7.3.2 流式对话

对话生成必须使用 SSE 或兼容的流式增量渲染机制。

发送消息后需要进入以下状态流转：

```text
idle -> sending -> streaming -> completed
idle -> sending -> failed
streaming -> stopped
streaming -> failed
```

生成中 UI 需要表现：

1. 助手气泡实时增量出现
2. 输入框或消息底部出现停止生成按钮
3. 顶部或消息区域显示当前模型
4. 失败后展示错误卡片与 Retry 按钮

### 验收标准

1. Deepseek 请求以真实 streaming 方式逐字或分块显示。
2. 用户可在生成中点击停止生成。
3. 停止后保留已生成内容。
4. 失败时显示错误状态。
5. 点击 Retry 可重新请求当前失败消息。
6. 生成完成后展示 token、耗时、模型标签。

---

### 7.3.3 Retry

当助手消息生成失败时，消息底部显示 Retry 操作。点击后：

1. 保留原用户消息。
2. 清空失败助手消息内容或创建新的助手消息版本。
3. 使用相同模型、参数、上下文重新发起请求。
4. 新结果替换失败状态。

### 验收标准

1. 只有失败消息显示 Retry。
2. Retry 后错误状态消失。
3. Retry 使用同一上下文。
4. Retry 成功后消息状态变为 completed。

---

### 7.3.4 Regenerate

任意助手消息都支持 Regenerate。点击后：

1. 从该助手消息对应的上一条用户消息开始重新生成。
2. 使用当前选中的模型和参数，或允许用户选择“沿用原模型”。
3. 原助手消息作为旧版本保留。
4. 新助手消息作为新分支或新版本展示。
5. 用户可在分支之间切换。

### 验收标准

1. 助手消息底部有 Regenerate 操作。
2. 重新生成不会删除旧结果。
3. 多个结果可通过版本切换控件查看。
4. 当前活跃分支在 UI 中有明确标记。

---

### 7.3.5 用户消息编辑与分支

任意用户消息支持 Edit。用户编辑历史消息后：

1. 从该消息节点重新生成后续对话。
2. 原后续分支保留。
3. 新内容形成新分支。
4. 用户可切换旧分支和新分支。
5. 分支切换后上下文与消息流同步变化。

### 验收标准

1. 用户消息底部有 Edit 操作。
2. 编辑后可保存或取消。
3. 保存后从该点生成新分支。
4. 旧分支不丢失。
5. 分支切换后消息列表正确变化。

---

### 7.3.6 会话级断点续传

生成过程中，每个 SSE 增量必须持续写入 IndexedDB。刷新后应用需要：

1. 读取当前会话未完成消息。
2. 渲染已保存的增量文本。
3. 尝试重连同一 SSE 通道。
4. 继续追加后续增量。
5. 若不能重连，则保留已生成内容并提供 Retry。

数据层需要记录：

1. `streamId`
2. `requestId`
3. `conversationId`
4. `messageId`
5. `lastDeltaIndex`
6. `partialContent`
7. `streamStatus`
8. `updatedAt`

### 验收标准

1. 生成中刷新不丢失已出现内容。
2. 刷新后能继续显示最后一条增量。
3. 可恢复时继续生成。
4. 不可恢复时展示明确提示与 Retry。
5. IndexedDB 中可找到对应 partial 内容记录。

---

### 7.3.7 推理过程展示

对于推理类模型，例如 `deepseek-reasoner`，助手消息气泡中需要区分：

1. 思考过程
2. 最终回答

思考过程展示为可折叠块，默认可按产品策略设置为折叠或展开。最终回答始终正常展示。

### 验收标准

1. deepseek-reasoner 输出中思考内容进入独立区域。
2. 思考块可展开、折叠。
3. 最终回答与思考内容视觉上分离。
4. 非推理模型默认不显示思考块。

---

## 7.4 输入与多模态

### 7.4.1 输入框基础能力

输入框需要支持：

1. 多行输入
2. Enter 发送
3. Shift + Enter 换行
4. 输入为空时禁用发送
5. 生成中支持停止生成
6. 自动高度增长
7. 粘贴文本
8. 粘贴图片
9. 拖拽上传文件

### 验收标准

1. 输入长文本时输入框高度自然增长。
2. 空内容不可发送。
3. Enter 与 Shift + Enter 行为正确。
4. 生成中发送按钮切换为停止按钮。

---

### 7.4.2 附件上传

支持的附件类型：

1. 图片：png、jpg、jpeg、webp、gif
2. PDF：pdf
3. 文本：txt、md
4. 代码文件：ts、tsx、js、jsx、py、java、go、rs、cpp、c、cs、json、yaml、yml、html、css、sql、sh 等

附件卡片需要展示：

1. 文件名
2. 文件类型
3. 文件大小
4. 缩略图或类型图标
5. 删除按钮
6. 解析状态

### 验收标准

1. 拖拽文件到输入区可添加附件。
2. 粘贴图片可生成图片附件卡片。
3. 点击删除可移除附件。
4. 不支持的文件类型需要显示错误提示。
5. 附件随消息保存到 IndexedDB。

---

### 7.4.3 文本提取

PDF 与文本类附件需要提取纯文本，并拼接到 prompt 末尾。拼接格式应清晰标记来源，例如：

```text
用户问题：

{user_input}

以下是用户上传附件的内容：

[附件 1: example.pdf]
{extracted_text}

[附件 2: notes.md]
{extracted_text}
```

### 验收标准

1. txt、md、代码文件可直接读取文本。
2. PDF 可提取纯文本。
3. 提取失败时展示错误状态，用户仍可删除附件。
4. 发送时 prompt 中包含附件文本。
5. 附件内容不会破坏用户原始输入。

---

### 7.4.4 斜杠命令

输入框支持斜杠命令。输入 `/` 后弹出补全列表。

v1 支持：

1. `/clear`：清空当前会话
2. `/system`：编辑当前会话系统提示词
3. `/temp`：调整 temperature
4. `/model`：快速切换模型

补全列表需要展示：

1. 命令名称
2. 命令说明
3. 参数提示
4. 键盘上下选择
5. Enter 确认
6. Esc 关闭

### 验收标准

1. 输入 `/` 出现命令列表。
2. 输入 `/mo` 可过滤到 `/model`。
3. 选择 `/clear` 后触发清空确认。
4. 选择 `/system` 后打开系统提示词编辑。
5. 选择 `/temp` 后允许输入或选择 temperature。
6. 选择 `/model` 后打开模型快速切换。

---

### 7.4.5 @ 引用历史消息

输入框支持 `@` 引用当前会话历史消息。输入 `@` 后弹出消息列表。

列表展示：

1. 角色：user / assistant
2. 消息摘要
3. 时间
4. 模型标签，若为助手消息
5. 搜索过滤能力

选中后，将该消息作为上下文片段附加到当前 prompt。

### 验收标准

1. 输入 `@` 后出现当前会话消息列表。
2. 可通过关键词过滤消息。
3. 选中消息后输入框中出现引用 chip。
4. 发送时引用内容被拼接进上下文。
5. 用户可删除已选引用。

---

## 7.5 消息渲染

### 7.5.1 Markdown 渲染

助手消息需支持 GitHub Flavored Markdown，包括：

1. 标题
2. 段落
3. 加粗、斜体、删除线
4. 有序列表、无序列表
5. 引用块
6. 表格
7. 任务列表
8. 链接
9. 图片链接
10. 分割线

### 验收标准

1. Markdown 内容渲染准确。
2. 表格在小屏幕可横向滚动。
3. 链接可点击并在新标签打开。
4. 任务列表复选框正确展示。

---

### 7.5.2 代码块

代码块需要支持：

1. 多语言语法高亮
2. 语言标签显示
3. 复制按钮
4. 下载按钮
5. Run in Sandbox 按钮

Run in Sandbox 为 mock 弹窗，点击后展示模拟 stdout，例如：

```text
Running in sandbox...

stdout:
Hello from sandbox
```

下载按钮应根据语言生成合理扩展名，例如：

1. ts -> `.ts`
2. tsx -> `.tsx`
3. python -> `.py`
4. javascript -> `.js`
5. json -> `.json`

### 验收标准

1. 代码块语法高亮正常。
2. 点击复制后有成功反馈。
3. 点击下载可保存文件。
4. 点击 Run in Sandbox 打开 mock 弹窗并展示 stdout。
5. 未识别语言时仍以纯文本代码块展示。

---

### 7.5.3 数学公式

消息渲染需支持 KaTeX：

1. 行内公式：`$...$`
2. 块级公式：`$$...$$`

### 验收标准

1. 行内公式不破坏段落排版。
2. 块级公式居中或以清晰数学块展示。
3. 公式渲染失败时显示原始文本或错误 fallback。

---

### 7.5.4 Mermaid 图表

消息渲染需要支持 Mermaid 图表，例如：

````markdown
```mermaid
graph TD
A --> B
````

````

### 验收标准

1. Mermaid 图表可以渲染。
2. 渲染失败时展示错误提示。
3. 图表容器在小屏幕可滚动或缩放。
4. 不影响其他代码块展示。

---

### 7.5.5 链接预览

消息中的链接需要支持预览卡片。预览卡片至少包含：

1. 标题
2. URL 域名
3. 简短描述，若可用
4. 缩略图，若可用
5. 打开链接按钮

v1 可使用 mock metadata 或前端解析基础 URL 信息。

### 验收标准

1. 消息中出现链接时展示预览卡片。
2. 点击卡片可打开链接。
3. 链接解析失败时不影响消息渲染。

---

### 7.5.6 消息元信息与操作

每条消息底部展示：

1. token 用量
2. 生成耗时
3. 模型标签
4. 复制全文
5. 点赞
6. 点踩
7. 分享单条消息
8. Retry，失败消息显示
9. Regenerate，助手消息显示
10. Edit，用户消息显示

分享单条消息需要生成只读分享链接，路由格式：

```text
/s/:id
````

v1 可将分享内容写入本地 IndexedDB，并通过本地路由读取。

### 验收标准

1. 消息生成完成后展示 token、耗时、模型。
2. 点击复制可复制完整消息文本。
3. 点赞点踩状态可切换并持久化。
4. 点击分享生成 `/s/:id` 链接。
5. 打开分享链接进入只读消息页。

---

## 7.6 会话管理

### 7.6.1 左侧会话列表

左侧会话列表按时间分组：

1. Pinned
2. Today
3. Yesterday
4. Last 7 days
5. Older

每条会话展示：

1. 标题
2. 最近消息摘要
3. 更新时间
4. 模型标记
5. 标签
6. 置顶状态
7. 所属文件夹，若有

### 验收标准

1. 新会话自动出现在 Today。
2. 置顶会话出现在 Pinned。
3. 昨日会话出现在 Yesterday。
4. 7 天内非今日、昨日会话出现在 Last 7 days。
5. 更早会话出现在 Older。

---

### 7.6.2 会话操作

会话支持：

1. 新建
2. 重命名
3. 删除
4. 删除二次确认
5. 置顶 / 取消置顶
6. 拖拽分组
7. 移动到文件夹
8. 导出 Markdown
9. 导出 JSON

### 验收标准

1. 新建会话后主区域进入 New Chat 起始页。
2. 重命名后标题立即更新并持久化。
3. 删除前出现确认弹窗。
4. 删除后消息与会话从列表中移除。
5. 置顶状态刷新后保留。
6. 导出的 Markdown 内容包含完整消息。
7. 导出的 JSON 包含会话元数据与消息数组。

---

### 7.6.3 文件夹

支持新建文件夹，并将会话拖拽至文件夹中。

文件夹支持：

1. 新建
2. 重命名
3. 删除
4. 展开 / 收起
5. 拖拽会话进入
6. 从文件夹移出

### 验收标准

1. 用户可创建文件夹。
2. 会话可拖入文件夹。
3. 文件夹展开后展示内部会话。
4. 删除文件夹前需要确认。
5. 删除文件夹不应默认删除内部会话，除非用户明确选择同时删除。

---

### 7.6.4 会话标签

支持多色标签。每个会话可拥有多个标签。

标签能力包括：

1. 创建标签
2. 修改标签名称
3. 修改标签颜色
4. 删除标签
5. 给会话添加标签
6. 从会话移除标签
7. 按标签过滤列表

### 验收标准

1. 会话可添加多个标签。
2. 标签颜色在列表中展示。
3. 点击标签过滤后列表只展示匹配会话。
4. 清除过滤后恢复全部会话。

---

### 7.6.5 会话搜索

左侧列表支持搜索，搜索范围包括：

1. 会话标题
2. 消息内容全文

搜索结果需要高亮关键词。

### 验收标准

1. 输入关键词后实时过滤会话。
2. 匹配标题和消息内容均可命中。
3. 清空关键词后恢复原列表。
4. 搜索性能在本地 1000 条消息以内保持流畅。

---

### 7.6.6 空状态

当没有会话时，左侧和主区域需要展示空状态。

空状态包含：

1. 插图
2. 简短引导文案
3. New chat 按钮
4. 示例 Prompt 入口

### 验收标准

1. 首次进入无会话时不出现空白页。
2. 点击 New chat 可以创建新会话。
3. 空状态视觉与整体 UI 风格一致。

---

## 7.7 全局搜索

按 Cmd/Ctrl+K 打开全局搜索浮层。

搜索范围：

1. 所有会话标题
2. 所有用户消息
3. 所有助手消息
4. 标签
5. 文件夹名称

结果项展示：

1. 会话标题
2. 匹配消息摘要
3. 匹配关键词高亮
4. 更新时间
5. 所属标签
6. 点击跳转

### 验收标准

1. Cmd/Ctrl+K 可打开搜索。
2. Esc 可关闭。
3. 输入关键词后展示跨会话结果。
4. 点击结果跳转到对应会话。
5. 对应消息被滚动定位并高亮。

---

## 7.8 New Chat 起始页

### 7.8.1 示例 Prompt 卡片

未发起对话时展示示例 Prompt 卡片网格，分为 5 类：

1. 写作
2. 代码
3. 数学
4. 角色扮演
5. 数据分析

每类 2-3 张卡片。卡片包含：

1. 标题
2. 简短描述
3. Prompt 内容
4. 分类图标
5. 点击预填输入框

示例：

写作：

1. 帮我润色一封商务邮件
2. 把这段文字改成更有说服力的版本
3. 生成一个产品发布公告

代码：

1. 解释这段 TypeScript 代码
2. 帮我设计一个 React 组件
3. 给这个函数补充单元测试

数学：

1. 分步解释一道概率题
2. 推导一个公式
3. 检查我的计算过程

角色扮演：

1. 扮演产品经理帮我评审需求
2. 扮演面试官问我前端问题
3. 扮演英语教练纠正我的表达

数据分析：

1. 帮我分析一组 CSV 字段
2. 总结这份实验结果
3. 设计一个指标看板

### 验收标准

1. New Chat 页面展示 5 类卡片。
2. 每类至少 2 张卡片。
3. 点击卡片后 Prompt 进入输入框。
4. 不自动发送，用户可编辑后再发送。

---

### 7.8.2 Tips 与最近会话

起始页底部展示：

1. 当日 Tips
2. 最近 3 条会话快捷入口

Tips 可从本地预设列表按日期轮换。

### 验收标准

1. 每天展示一个 Tip。
2. 最近 3 条会话按更新时间排序。
3. 点击最近会话可跳转。

---

## 7.9 设置与高级能力

### 7.9.1 设置面板

设置面板支持：

1. 默认模型
2. temperature
3. max_tokens
4. top_p
5. 系统提示词模板
6. 自定义快捷键
7. 上下文窗口截断策略
8. 主题
9. 语言
10. 清空所有数据

### 验收标准

1. 设置变更后即时生效或在下一轮对话生效。
2. 设置持久化到 IndexedDB。
3. 刷新后设置不丢失。
4. 设置项有合理默认值。

---

### 7.9.2 系统提示词模板

支持多套系统提示词模板。每个模板包含：

1. 模板名称
2. 模板内容
3. 是否默认
4. 创建时间
5. 更新时间

用户可：

1. 新建模板
2. 编辑模板
3. 删除模板
4. 设置为默认模板
5. 在当前会话中切换模板

### 验收标准

1. 用户可保存多套模板。
2. 默认模板用于新会话。
3. 当前会话可覆盖默认模板。
4. 删除默认模板时需要选择新的默认模板或回退系统默认模板。

---

### 7.9.3 上下文窗口截断策略

支持以下策略：

1. 最近消息优先
2. 保留系统提示词 + 最近消息
3. 保留置顶消息 + 最近消息
4. 摘要旧消息 + 最近消息，v1 可 mock 摘要
5. 手动选择上下文片段

每种策略需要展示说明。

### 验收标准

1. 用户可在设置中选择策略。
2. 发送请求时按策略构造上下文。
3. 超出 max_tokens 或模型上下文限制时有提示。
4. 不同策略切换后可持久化。

---

### 7.9.4 快捷键说明浮层

按 `?` 打开快捷键说明浮层。

快捷键至少包括：

| 快捷键           | 功能         |
| ------------- | ---------- |
| Cmd/Ctrl + K  | 全局搜索       |
| Cmd/Ctrl + N  | 新建会话       |
| Cmd/Ctrl + B  | 折叠 / 展开侧边栏 |
| Enter         | 发送消息       |
| Shift + Enter | 换行         |
| Esc           | 关闭浮层或取消输入  |
| ?             | 打开快捷键说明    |
| /             | 打开斜杠命令     |
| @             | 引用历史消息     |

### 验收标准

1. 按 `?` 可打开浮层。
2. Esc 可关闭。
3. 快捷键在输入框聚焦时不误触，除必要快捷键外。
4. 用户自定义快捷键后浮层内容同步更新。

---

## 7.10 数据与存储

### 7.10.1 IndexedDB Store

所有会话与设置使用 IndexedDB 持久化。至少包含四个 store：

1. `conversations`
2. `messages`
3. `settings`
4. `api_keys`

建议扩展 store：

1. `folders`
2. `tags`
3. `attachments`
4. `message_branches`
5. `shares`
6. `stream_states`

---

### 7.10.2 conversations schema

```ts
interface Conversation {
  id: string;
  title: string;
  folderId?: string;
  tagIds: string[];
  pinned: boolean;
  archived?: boolean;
  activeBranchId?: string;
  systemPrompt?: string;
  model: string;
  provider: "deepseek" | "openai" | "anthropic";
  temperature: number;
  maxTokens: number;
  topP: number;
  createdAt: number;
  updatedAt: number;
}
```

---

### 7.10.3 messages schema

```ts
interface Message {
  id: string;
  conversationId: string;
  branchId: string;
  parentMessageId?: string;
  role: "system" | "user" | "assistant";
  content: string;
  reasoningContent?: string;
  status: "pending" | "streaming" | "completed" | "failed" | "stopped";
  model?: string;
  provider?: "deepseek" | "openai" | "anthropic";
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs?: number;
  error?: {
    code?: string;
    message: string;
    status?: number;
  };
  attachmentIds?: string[];
  referencedMessageIds?: string[];
  feedback?: "like" | "dislike";
  createdAt: number;
  updatedAt: number;
}
```

---

### 7.10.4 settings schema

```ts
interface Settings {
  id: "global";
  theme: "light" | "dark" | "system";
  language: "zh" | "en";
  defaultProvider: "deepseek" | "openai" | "anthropic";
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  systemPromptTemplates: SystemPromptTemplate[];
  defaultSystemPromptTemplateId?: string;
  shortcuts: Record<string, string>;
  contextTruncationStrategy:
    | "recent_only"
    | "system_plus_recent"
    | "pinned_plus_recent"
    | "summary_plus_recent"
    | "manual";
  usage: {
    used: number;
    limit: number;
  };
  createdAt: number;
  updatedAt: number;
}
```

---

### 7.10.5 api_keys schema

```ts
interface ApiKeyRecord {
  id: string;
  provider: "deepseek" | "openai" | "anthropic";
  encryptedValue: string;
  iv: string;
  maskedValue: string;
  testStatus?: "untested" | "testing" | "success" | "failed";
  lastTestedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}
```

---

### 7.10.6 清空所有数据

设置面板提供“清空所有数据”按钮，点击后必须二次确认。

清空范围：

1. conversations
2. messages
3. settings
4. api_keys
5. attachments
6. folders
7. tags
8. shares
9. stream_states
10. localStorage 登录态，可按弹窗选项决定是否同时退出登录

### 验收标准

1. 点击清空后出现二次确认。
2. 用户确认后删除 IndexedDB 数据。
3. 清空完成后回到初始状态。
4. 操作不可误触。

---

## 8. UI/UX 要求

### 8.1 整体视觉

产品视觉需现代、专业、克制，参考 ChatGPT、Claude.ai、Poe 的成熟体验。

要求：

1. 深色 / 浅色主题完整适配。
2. 使用一致的 spacing、radius、shadow、border。
3. 主内容区在桌面端居中，最大宽度 1280px。
4. 左侧会话栏、顶部栏、输入区层级清晰。
5. 消息气泡阅读舒适。
6. 空状态、错误状态、加载状态完整。
7. 不得出现 lorem ipsum、测试占位文字或明显半成品 UI。

---

### 8.2 响应式

最低支持宽度 360px。

桌面端：

1. 左侧固定会话栏
2. 中间主聊天区
3. 顶部模型选择器
4. 右上角头像菜单

移动端：

1. 左侧会话栏可抽屉展开
2. 输入框固定底部
3. 消息区可滚动
4. 顶部操作不拥挤
5. 文件附件卡片可横向滚动

### 验收标准

1. 360px 宽度下可登录、发消息、查看会话。
2. 桌面端内容最大宽度不超过 1280px。
3. 横向滚动只允许出现在表格、代码块、附件列表等局部区域。

---

## 9. 技术要求

### 9.1 项目结构

推荐目录结构：

```text
src/
  app/
    App.tsx
    router.tsx
    providers.tsx
  components/
    ui/
    layout/
    markdown/
    modals/
  features/
    auth/
    chat/
    conversations/
    api-keys/
    settings/
    search/
    attachments/
    shortcuts/
    sharing/
  hooks/
  lib/
    db/
    crypto/
    llm/
    markdown/
    file-parsers/
    stream/
    export/
  store/
  types/
  styles/
  test/
```

### 9.2 TypeScript

要求：

1. 启用 `strict: true`
2. 不使用隐式 any
3. 关键领域模型有完整类型定义
4. API 响应与错误有类型封装
5. Provider adapter 有统一接口

示例接口：

```ts
interface LLMProviderAdapter {
  provider: "deepseek" | "openai" | "anthropic";
  listModels(apiKey: string): Promise<ModelInfo[]>;
  streamChat(input: StreamChatInput): AsyncIterable<StreamChatDelta>;
  abort(streamId: string): Promise<void>;
}
```

---

### 9.3 状态管理

状态层至少需要覆盖：

1. 当前用户
2. 当前会话
3. 当前模型
4. 消息列表
5. 流式生成状态
6. 设置
7. API Key 状态
8. 搜索状态
9. UI 状态，例如主题、侧边栏、浮层

可使用轻量状态库或 React Context + hooks，但需保持模块边界清晰。

---

### 9.4 Deepseek SSE

Deepseek 真实对话需要满足：

1. 支持 `stream: true`
2. 正确解析 SSE delta
3. 增量写入消息内容
4. 增量写入 IndexedDB
5. 支持 AbortController 停止
6. 支持错误捕获与 Retry
7. 支持 deepseek-reasoner 的 reasoning 内容分离

### 验收标准

1. 使用 Deepseek Key 可完成至少一次端到端 streaming 对话。
2. 生成内容逐步显示。
3. 停止生成不会导致页面异常。
4. 网络失败时 UI 有明确错误。

---

### 9.5 Mock Stream

OpenAI 与 Anthropic 在未配置 Key 时使用 mock 流式返回。mock 流需要：

1. 模拟真实逐步输出
2. 支持停止
3. 支持 Retry
4. 支持 token 与耗时 mock 统计
5. 明确显示 mock 标签

### 验收标准

1. 未配置 Key 时仍可体验 OpenAI / Anthropic 模型。
2. mock 输出以流式方式出现。
3. UI 明确标记 mock，避免误导用户。

---

### 9.6 错误处理

需要统一错误处理机制，覆盖：

1. API Key 缺失
2. API Key 无效
3. 网络失败
4. SSE 中断
5. 请求超时
6. 文件解析失败
7. IndexedDB 写入失败
8. Markdown 渲染失败
9. Mermaid 渲染失败

错误 UI 要求：

1. 错误信息清晰
2. 提供可执行操作，例如 Retry、重新配置 Key、删除附件
3. 不出现空白页
4. 不出现 console.error 红字

---

## 10. 导出与分享

### 10.1 Markdown 导出

会话可导出为 Markdown。

内容包含：

1. 会话标题
2. 创建时间
3. 更新时间
4. 模型信息
5. 系统提示词，若有
6. 所有消息
7. 附件名称
8. token 与耗时元信息

---

### 10.2 JSON 导出

会话可导出为 JSON。

内容包含完整会话对象、消息数组、标签、分支信息与附件元数据。

---

### 10.3 单条消息分享

每条消息可生成只读分享链接：

```text
/s/:id
```

分享页要求：

1. 只读
2. 展示消息内容
3. 展示模型、耗时、token
4. 支持复制
5. 不展示编辑、重试、重新生成等操作

v1 可基于本地 IndexedDB 实现本机分享路由。

---

## 11. 订阅与用量

订阅信息为 mock。右上角头像菜单中展示：

```text
免费版 / 已用 X / Y 次
```

用量规则：

1. 每次成功发送用户消息后 X + 1。
2. Retry 可按产品策略计入或不计入，v1 建议计入。
3. Regenerate 建议计入。
4. Y 为本地 mock 固定值，例如 100。
5. 达到上限后展示升级提示，但不要求真实支付。

### 验收标准

1. 发送消息后用量增加。
2. 刷新后用量不丢失。
3. 菜单中显示当前用量。
4. 达到上限后有清晰提示。

---

## 12. 国际化

支持中文与英文。

范围包括：

1. 登录页
2. 菜单
3. 设置
4. API Keys
5. 会话操作
6. 空状态
7. 错误提示
8. 快捷键说明
9. 按钮文案
10. Toast 文案

### 验收标准

1. 切换语言后主要 UI 文案立即更新。
2. 刷新后保留语言设置。
3. 未翻译内容不得出现混乱 key，例如 `settings.default_model`。

---

## 13. 安全与隐私

### 13.1 本地数据

所有用户数据默认保存在本地浏览器，包括：

1. 登录态
2. API Keys
3. 会话
4. 消息
5. 设置
6. 附件元数据
7. 解析后的文本内容

### 13.2 API Key

要求：

1. API Key 不明文写入 localStorage。
2. API Key 加密后写入 IndexedDB。
3. UI 只显示脱敏 Key。
4. 删除 Key 后不可继续调用对应真实模型。
5. 发起请求时只在内存中解密使用。

### 13.3 外部请求

v1 真实外部请求主要用于：

1. Deepseek 模型列表测试
2. Deepseek Chat SSE
3. OpenAI / Anthropic Key 连通性测试，若用户配置 Key

需要在 UI 中明确提示用户：API 请求会发送到对应模型服务提供商。

---

## 14. 性能要求

1. 初次加载小于 5 秒。
2. 路由切换无明显卡顿。
3. 100 个会话、1000 条消息内搜索流畅。
4. 流式输出期间输入区域仍可响应。
5. 大代码块、表格、Mermaid 渲染不得阻塞主线程过久。
6. 附件解析需要展示 loading 状态。
7. IndexedDB 读写失败需要 fallback 提示。

---

## 15. 可访问性要求

1. 所有按钮有可读 label。
2. 浮层支持 Esc 关闭。
3. 下拉菜单支持键盘上下选择。
4. 命令菜单支持键盘操作。
5. 颜色对比度满足基本可读性。
6. focus 状态清晰。
7. 图标按钮需要 tooltip。

---

## 16. 路由设计

推荐路由：

```text
/login
/chat
/chat/:conversationId
/api-keys
/settings
/s/:id
```

路由规则：

1. 未登录访问 `/chat` 自动跳转 `/login`。
2. 已登录访问 `/login` 自动跳转 `/chat`。
3. `/s/:id` 为只读分享页，可不要求登录。
4. 无效会话 ID 展示 404 或回到 New Chat。
5. 无效分享 ID 展示分享不存在状态。

---

## 17. 验收清单

### P0 必须完成

1. 登录页：Google mock 登录、邮箱密码登录。
2. 登录态 localStorage 持久化。
3. 头像菜单。
4. API Keys 页面。
5. Deepseek Key 加密存储。
6. Deepseek Key 连通性测试。
7. 模型选择器。
8. Deepseek 真实 SSE 对话。
9. mock OpenAI / Anthropic 流式响应。
10. 停止生成。
11. Retry。
12. Regenerate。
13. 用户消息 Edit 与分支。
14. 生成中刷新不丢字。
15. deepseek-reasoner 思考块。
16. 附件上传与文本提取。
17. 斜杠命令。
18. @ 引用历史消息。
19. Markdown、代码高亮、KaTeX、Mermaid。
20. 消息复制、反馈、分享。
21. 会话列表分组。
22. 会话重命名、删除、置顶、搜索、导出。
23. 标签过滤。
24. New Chat 示例卡片。
25. 设置面板。
26. 快捷键浮层。
27. IndexedDB 持久化。
28. 清空所有数据。
29. 深浅色主题。
30. 中英文语言。
31. 响应式 360px 以上可用。
32. TypeScript strict。
33. 初次加载小于 5 秒。
34. 无 console.error 红字。

### P1 可增强

1. 更完整的真实 OpenAI / Anthropic 对话适配器。
2. 更强 PDF 解析能力。
3. 更完善链接预览。
4. 本地全文索引优化。
5. 会话摘要。
6. Prompt 模板市场。
7. 多设备同步。
8. 真实分享服务。
9. 真实沙箱代码执行。
10. 真实订阅与用量系统。

---

## 18. 里程碑

### Milestone 1：项目基础与登录

交付内容：

1. Vite + React + TypeScript 项目初始化
2. strict TypeScript 配置
3. 路由系统
4. 基础布局
5. 登录页
6. localStorage 登录态
7. 深浅色主题
8. 中英文语言框架

验收结果：用户可以登录、刷新恢复、进入主界面。

---

### Milestone 2：数据层与会话基础

交付内容：

1. IndexedDB 初始化
2. conversations store
3. messages store
4. settings store
5. api_keys store
6. 会话新建、切换、删除、重命名
7. 消息基础展示
8. New Chat 起始页

验收结果：用户可以创建会话、发送本地 mock 消息、刷新不丢失。

---

### Milestone 3：API Keys 与 Deepseek 真实流式链路

交付内容：

1. API Keys 页面
2. Web Crypto 加密存储
3. Deepseek Key 测试
4. Deepseek SSE adapter
5. 流式渲染
6. 停止生成
7. 错误处理
8. Retry

验收结果：用户可以使用真实 Deepseek API 完成端到端 streaming 对话。

---

### Milestone 4：高级对话能力

交付内容：

1. Regenerate
2. 用户消息 Edit
3. 分支管理
4. 生成中刷新恢复
5. deepseek-reasoner 思考块
6. token、耗时、模型标签
7. 反馈与复制

验收结果：对话体验达到成熟 AI Chat 产品的核心水平。

---

### Milestone 5：输入、多模态与渲染

交付内容：

1. 附件上传
2. 图片、PDF、文本、代码文件支持
3. PDF / 文本提取
4. 斜杠命令
5. @ 引用历史消息
6. GFM Markdown
7. 代码高亮
8. KaTeX
9. Mermaid
10. 链接预览
11. 代码块复制、下载、Run in Sandbox

验收结果：用户可进行复杂输入，并获得高质量富文本输出。

---

### Milestone 6：会话管理、搜索、设置与收尾

交付内容：

1. 会话时间分组
2. 文件夹
3. 标签
4. 左侧搜索
5. 全局搜索
6. 导出 Markdown / JSON
7. 分享路由
8. 设置面板
9. 快捷键浮层
10. 清空所有数据
11. 响应式优化
12. 性能与错误清理

验收结果：产品达到完整可用、可演示、可扩展状态。

---

## 19. 风险与注意事项

### 19.1 浏览器直连 API 风险

前端直连模型 API 可能存在 CORS、Key 暴露与请求限制问题。v1 为本地运行产品，可支持前端直连；生产部署时建议增加轻量后端或 API proxy。

### 19.2 断点续传复杂度

真正的 SSE 通道续接依赖服务端能力。若 Provider 不支持按 offset 恢复，则 v1 需要保证“不丢已生成文本”，并在无法续接时提供 Retry，而不是承诺一定从服务端精确续流。

### 19.3 API Key 加密边界

浏览器本地加密可以避免 IndexedDB 明文存储，但无法防御用户本机环境或恶意浏览器扩展完全受控的情况。UI 与文档中应避免过度承诺绝对安全。

### 19.4 PDF 解析质量

PDF 纯文本提取可能受扫描件、复杂排版、图片型 PDF 影响。v1 不要求 OCR，但需要对提取失败提供清晰提示。

### 19.5 Mermaid 与 Markdown 安全

Markdown、Mermaid、链接预览需要防止 XSS。渲染层必须进行 HTML sanitize，默认不执行不可信脚本。

---

## 20. 最终交付标准

最终应用必须满足：

1. 本地安装依赖后可启动。
2. Chrome 桌面端可完整使用。
3. 首次启动进入登录页。
4. 登录后进入 Chat 主界面。
5. Deepseek API Key 可保存、测试并用于真实 SSE 对话。
6. 会话、消息、设置、API Key 刷新后不丢失。
7. 消息支持停止、Retry、Regenerate、Edit 分支。
8. 输入支持附件、斜杠命令、@ 引用。
9. 输出支持 Markdown、代码、数学公式、Mermaid、表格、任务列表、链接预览。
10. 会话支持分组、搜索、标签、文件夹、导出。
11. 设置支持模型参数、系统提示词模板、快捷键、上下文策略。
12. UI 达到现代 AI Chat 产品水准。
13. TypeScript strict 通过。
14. 无 console.error 红字。
15. 初次加载小于 5 秒。
16. 360px 以上移动端宽度可用。
