# Inline Interactive Artifact Protocol

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement                 | 在 Overlay 的 Conversation 消息卡片区域直接渲染由工具生成的动态内容，覆盖文档、K 线图、表格和通用 iframe/App；开始实施并做端到端测试；由测试模拟用户从消息输入框发送请求，确认真实触发和渲染。                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Acceptance criteria              | 用户从真实 composer 发送请求后，task message route 返回持久化 user message，选中任务 SSE 流发出真实 tool/message/part 事件；一个真实工具调用能发布 task-scoped interactive artifact，并在同一真实 assistant message 中持久化可见 part；Conversation 通过后端 artifact ID 读取唯一 payload；文档、表格、K 线和 MCP Apps HTML 使用明确 renderer 呈现在消息卡片；sandbox App 完成标准 JSON-RPC 初始化、尺寸同步和受控 Host bridge；Node/Playwright 页面覆盖四类内容、交互、刷新持久化和截图视觉复核；无裸 URL、Markdown iframe、右侧 Browser Preview 或客户端影子数据源。                                                                                                     |
| Hard constraints                 | 直接替换未落入真实 Session 持久化的旧 `embed`，不保留兼容分支；`engine_artifact` 是内容唯一事实源，message part 只保存 artifact identity，task identity 来自 Conversation route scope；业务动作必须走真实可见 tool/message 流；iframe 禁止 `allow-same-origin`，默认无 forms/popups/navigation/network 权限；使用成熟 renderer/协议，不手搓表格、K 线或 MCP Apps bridge；Playwright 只由 Node 启动；测试使用隔离服务，不重启、刷新或干预正在运行的 Overlay；不创建 worktree；保留无关未跟踪 `C:/`。                                                                                                                                                                        |
| Sources read                     | `AGENTS.md`; `specs/current/architecture/07-panel.md`; `specs/current/architecture/09-verification-evidence.md`; right-Dock/Browser Preview ownership与 E2E 记录；当前 `Message.Part`、Tool result、Session loop/processor、conversation projection、transport protocol、CardParts/EmbedPart、server route composition、engine artifact persistence；MCP Apps 2026-01-26 overview/API，JSON Schema 2020-12，Vega-Lite、Lightweight Charts、TanStack Table、Apache Arrow、PDF.js 官方资料；TradingView Datafeed API、Connecting Data、Financial Widgets Data FAQ 官方资料。                                                                                                 |
| Whole-repository search evidence | `ConversationEmbedMessagePart` / `EmbedPart` 只存在于 transport protocol、Conversation display validation、Overlay renderer 和测试；真实 `Message.Part` union、`VisiblePart`、Tool result attachment schema、Session persistence均没有 `embed`，也没有生产 tool 调用点。`EngineArtifactKind` 是 artifact kind 唯一枚举；`recordEngineArtifact` / `updateEngineArtifact` 是写入口；task-scoped routes 统一经 `AppRoutes` 与 project-directory middleware。`CardParts` 是消息正文 part 唯一 renderer dispatch；`InlineToolPart` 仅渲染 tool-state file attachments，不能形成顶层消息动态卡片。全仓没有 interactive artifact、MCP App host bridge 或 artifact update client。 |
| Independent agent feedback       | None；用户未要求子 Agent，当前 multi-agent 约束禁止自行委托。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Correction Recall (2026-07-19)

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User correction                  | 用户追问“chat/专家团模式的所有 agent 都支持吗”后，要求承认此前错误并继续实施；当前目标是 standalone Chat、Task、Mission Orchestrator、delegated/build worker 以及所有 active expert-squad user-visible agents 都能通过同一个真实工具协议发布消息卡片 artifact。title、summary、compaction、control 等内部角色不得获得该展示工具。                                                                                                                                                                                                                                                             |
| Corrected acceptance             | artifact 以 producing Session/assistant Message 为唯一 owner；工具仅依赖 `Tool.Context.sessionID/messageID`，不依赖 task；读取路由以 session + artifact identity 校验 ownership；Overlay 只使用 part 自带的 `sessionID/artifactID`，不依赖 active task；普通和专家团 agent 的真实 runtime tool projection 均包含 publisher；测试必须覆盖 registry → role/template/expert resolver → SessionLoop tool call → persisted message part → session artifact read。浏览器 fixture 测试只能称为 UI message-flow test，不能冒充真实 LLM runtime E2E。                                                  |
| Failure evidence                 | `publish_interactive_artifact` 虽在 `global-tools.ts` 注册，但不在 `GLOBAL_TOOL_IDS`、任何 `roleAssignments`/`runtimeTemplateAssignments` 或专家团可投影集合中；`ToolRegistry.runtimeTools` 和 `PromptProfileResolver` 会严格按这些集合裁剪，因此真实模型看不到它。工具执行还硬性读取 `ctx.extra.taskID`，而 standalone Chat 没有 task；Overlay 又读取全局 `activeTaskID()`，导致普通 Chat 消息即使有 part 也无法加载。原 Playwright 用 composer 发出真实 user POST，随后由 fixture 直接注入 assistant/tool/part SSE，未经过模型 registry 或 SessionLoop tool execution，不能证明工具可触发。 |
| Whole-repository search evidence | 写入/读取调用点仅为 `interactive-artifact/persist.ts`、publisher tool、artifact route 与其测试；客户端读取仅为 `InteractiveArtifactPart.tsx` 和 service。工具可见性唯一目录为 `tool-id-catalog.ts`，普通角色/运行模板唯一池为 `tool-pool-data.ts`，专家团唯一投影为 `PromptProfileResolver.expandedSchedulerBuiltInToolIDs/expandedWorkerBuiltInToolIDs`。Session/Message/Part 单一持久化表定义在 `session/session.sql.ts`，Tool Context 已原生提供 `sessionID/messageID`。                                                                                                                   |
| Hard constraints                 | 直接删除 task-scoped artifact 路径和 `engine_artifact.kind=interactive_artifact`，不保留兼容 route/fallback/双源；数据库 schema 直接按新范式定义；不向内部维护角色投影 publisher；不触碰当前运行中的 OpenCorvus/Overlay，所有运行验证使用隔离进程；保留无关 `C:/`。                                                                                                                                                                                                                                                                                                                           |

## Root Cause

当前 `embed` 看似已经能在消息中显示 iframe，但它只定义在独立 transport
protocol 和 Overlay 测试夹具中。真实 Session 消息进入 `Message.Part` Zod union 时没有
`embed`，工具结果也只能返回 file attachments；因此生产 Tool 无法生成、持久化或重放
这种 part。即使强行插入，当前契约也只保存任意 HTTP URL 与由消息自行声明的 iframe
权限，没有 task ownership、artifact identity、内容校验、Host bridge、动态尺寸、主题或
可追溯更新。

最初实现把根治路径错误地收窄为 task-scoped artifact。修正后的唯一协议是
session/message-scoped interactive artifact：工具使用其真实 Tool Context，把 payload
绑定到 producing assistant message；同一消息中的 `interactive-artifact` part 只保存
artifact identity。Overlay 永远按 part 自带的 session identity 读取 artifact，并由 payload
中的明确 renderer 选择成熟实现。

## Single-Source Contract

### Persisted message part

```json
{
  "type": "interactive-artifact",
  "artifactID": "art_..."
}
```

Part 不保存 URL、HTML、表格 rows、图表 series、renderer 配置或权限。

### Session message artifact

专用 session artifact row 以 `session_id`、`message_id` 外键绑定 producing message，payload
使用严格 discriminated union：

- `document@1`: Markdown 文档，由 Overlay 已有安全 Markdown parser 渲染。
- `table@1`: columns/rows，由 TanStack Solid Table 渲染。
- `candlestick@1`: OHLC（Open、High、Low、Close，开高低收）和可选 Volume（成交量），由 Lightweight Charts 渲染。
- `mcp-app@1`: `text/html;profile=mcp-app` 资源与声明式 CSP（Content Security Policy，内容安全策略），由 `@modelcontextprotocol/ext-apps` AppBridge 和 sandboxed iframe 渲染。

同一 artifact 只有一个 renderer 和一份 payload。客户端不得按扩展名、标题或内容猜测。

## Call-Site Disposition

| Surface                                                     | Current evidence                                           | Disposition                                                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/transport-protocol/src/index.ts`                  | 独立 `embed` URL schema                                    | 删除旧契约，新增 artifact-reference part parser。                                                                                    |
| `packages/opencorvus/src/session/message.ts`                | Part/VisiblePart 无 embed                                  | 新增严格 `InteractiveArtifactPart`，并允许 tool result 返回待持久化 display part。                                                   |
| `packages/opencorvus/src/tool/tool.ts`                      | Tool result 只支持 file attachments                        | 新增 `display` part 输出；不把 UI payload复制进 Tool state。                                                                         |
| `packages/opencorvus/src/session/loop.ts` 与 `processor.ts` | registry/extra tool wrapper 与 tool-result terminalization | loop stamp display identity；processor 在真实 tool part 之后幂等持久化 sibling part；模型重放只读 tool 文本摘要。                    |
| `packages/opencorvus/src/conversation/view.ts`              | 仅用 transport parser 验证裸 embed                         | 验证 interactive artifact ref，Conversation 保留真实 part identity/order。                                                           |
| `packages/opencorvus/src/engine/engine.sql.ts`              | 错误新增 task artifact kind                                | 删除 `interactive_artifact` kind，防止 task/session 双源。                                                                           |
| `packages/opencorvus/src/session/session.sql.ts`            | Session/Message/Part 是 conversation ownership 单一来源    | 新增 message-owned artifact row，外键级联跟随 Session/Message 生命周期。                                                             |
| `interactive-artifact` backend module                       | 当前强制 taskID                                            | 改为严格 session/message ownership 与 session-scoped JSON response。                                                                 |
| new generic publish tool                                    | absent                                                     | 一个公开 registry tool 接收 renderer discriminated union，持久化 artifact 并返回 display part。                                      |
| `packages/opencorvus/src/server/routes/app.ts`              | 当前装载 task artifact route                               | 只保留 session-scoped artifact read route，并纳入 OpenAPI reset。                                                                    |
| `packages/overlay/src/components/CardParts.tsx`             | embed dispatch                                             | 替换为 `InteractiveArtifactPart`。                                                                                                   |
| `packages/overlay/src/components/EmbedPart.tsx`             | raw URL iframe                                             | 删除；内置 renderer 和 MCP App renderer 共同读取同一 artifact service。                                                              |
| `packages/overlay/src/services/**`                          | 当前读取 active task                                       | 改为 session/directory-scoped read URL；不保存客户端副本。                                                                           |
| tool catalog/pools/expert resolver                          | publisher 注册但对真实 agent 不可见                        | 普通 user-visible roles/templates 明确投影；专家团通过 resolver 的同一 mandatory conversational host capability 投影；内部角色排除。 |
| Overlay CSS/i18n                                            | 固定 520px embed                                           | 替换为消息宽度内响应式 artifact surface、明确 loading/error/empty semantics。                                                        |
| existing tests/fixtures                                     | transport/conversation/embed browser fixture               | 直接改写为 interactive artifact；新增真实 backend route/tool/session与 Node/Playwright 四-renderer E2E。                             |
| docs                                                        | panel architecture未描述内联动态 artifact                  | 实现完成后更新当前架构与本记录验证结果。                                                                                             |

## Security And Message-Flow Boundary

- MCP App HTML 只存在于 message-owned artifact payload，不接受消息中的远程 URL。
- iframe 使用 `sandbox="allow-scripts"`，不开放 same-origin、forms、popups、top navigation。
- Overlay 为 Blob document 注入 `default-src 'none'` 的 CSP；脚本只允许 artifact 内联 code，connect/img/font 全部禁用，style 只允许 inline。
- Host bridge 校验具体 `iframe.contentWindow`，使用 MCP Apps `PostMessageTransport` 和 `AppBridge`，不实现私有消息格式。
- 首版 Host capability 只开放初始化、主题/容器 context 和 size change。App 发出的 tool/message/resource 请求没有真实 OpenCorvus 可见执行路径时明确返回不支持，不隐式执行或制造隐藏消息。
- 展示态 hover、zoom、sort 留在 renderer；任何未来数据 mutation 必须先接入真实 visible tool result/message 流。

## Market Data Boundary

- `candlestick@1` 是数据源无关的 OHLCV（Open、High、Low、Close、Volume，开高低收成交量）展示协议。renderer 不直接访问交易所、TradingView 或任意隐藏网络；负责取数的真实 tool/agent 在后端取得 bars 后，通过 `publish_interactive_artifact` 发布同一份 message-owned payload。
- TradingView Lightweight Charts 和 Advanced Charts 是图表库，不附带可导出的市场数据；TradingView 官方也不提供获取其行情/指标的公共数据 API。不得抓取 `demo_feed.tradingview.com` 或 TradingView 页面私有接口充当生产数据源。
- TradingView 官方 Widget 可以显示 TradingView 托管的数据，但它是第三方 iframe 产品，不是可写入本 artifact series 的数据源；实时权限仍由交易所决定。若产品选择 Widget，必须作为独立 provider-specific renderer 和网络/CSP 权限面建模，不能偷偷放宽当前自包含 MCP App sandbox。
- 当前真实数据接入的正确路径是交易所或获授权的第三方 provider → task-scoped backend tool → 规范化 OHLCV → `candlestick@1`。数据 provider、市场、symbol、interval、延迟与时间戳的产品选择应在接入具体 provider 时成为显式协议字段和可见 provenance（来源）信息。

## Implementation And Verification Plan

1. 落盘 message-owned schema、artifact persistence/read、generic publish tool 和 Session display-part persistence。
2. 实现 session-scoped JSON route 与 SDK/OpenAPI 同步。
3. 用 `marked`、TanStack Solid Table、Lightweight Charts、MCP Apps AppBridge 实现四个 renderer，删除旧 EmbedPart。
4. 覆盖 schema 正反例、foreign-session 404、Chat runtime registry、普通 role/runtime-template 矩阵、strict expert projection、SessionLoop tool execution、Session display-part roundtrip、Conversation projection与 renderer source contracts。
5. runtime integration 通过 mock model tool-call 驱动真实 SessionLoop publisher 和持久化；另用隔离 browser fixture 从 composer 模拟用户发送消息并注入 UI 消息流。后者只验证文档、表格排序、K 线 canvas、MCP initialize/input/resize/sandbox、刷新与截图，不再称为 runtime E2E。
6. 截图绑定当前 conversation card region，亲自查看实际页面并修复布局。
7. 跑 focused suites、Overlay/transport/opencorvus typecheck、Vite build、route/docs/i18n/document health、`git diff --check`，二次 review 后 commit/push `myhexin/v0.0.10beta`。

## Progress

- [x] Baseline fetched, verified, hook-tested and confirmed pushed to git-cc.
- [x] Existing call sites, package compatibility and standards evidence enumerated.
- [x] Correct session/message-owned runtime protocol and publisher implemented.
- [x] Four renderers implemented.
- [x] Real registry/SessionLoop-to-persisted-message integration passed; browser UI message-flow test remains separately classified.
- [x] Visual screenshots reviewed; artifact width, candlestick scale margins and full MCP App visibility after transcript scroll corrected and re-tested.
- [x] Corrected second review completed; the final commits are ready for git-cc push.

## Verification Evidence

| Surface                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol, schema, ownership, publisher, Session and Conversation | Corrected focused suite: 81 passed, 0 failed across runtime matrix, strict expert resolver, registry execution, SessionLoop execution, Session processor, route ownership and transport protocol. A standalone Chat registry test executes the publisher without task context; a SessionLoop test persists the payload and sibling display part from the wrapped runtime tool. |
| Overlay regressions, typecheck and production build              | The official isolated full Overlay unit runner passed every file; root Turbo typecheck passed all 9 package tasks; `bun run --cwd packages/overlay build:vite` passed.                                                                                                                                                                                                                                                                            |
| Simulated-send four-renderer browser UI test                     | Node-launched Playwright used the real composer and task message POST, then fixture-injected selected-task SSE tool/message/part events. It proves renderer/message-flow behavior only; it did **not** exercise runtime tool discovery or SessionLoop execution and is explicitly revoked as runtime E2E evidence.                                                                                                                                |
| Existing message disclosure browser regression                   | Node-launched Playwright passed with the artifact reference replacing the removed embed fixture.                                                                                                                                                                                                                                                                                                                                                  |
| Visual review                                                    | `packages/overlay/.scratch/overlay-inline-interactive-artifacts-light.png` reviewed at 820×1146 for the complete message body; `packages/overlay/.scratch/overlay-inline-mcp-app-light.png` reviewed after scrolling the transcript to the actual bottom. The four surfaces use the full message width, table order is visibly updated, the highest candlestick price label stays inside the chart, and the complete 210px MCP App iframe sits above the fixed composer. |
| Generated contracts and static checks                            | OpenAPI/JavaScript Software Development Kit regenerated; docs check passed for 274 operations in 23 groups; route, internationalization, historical document health and `git diff --check` passed.                                                                                                                                                                                                                                                |
