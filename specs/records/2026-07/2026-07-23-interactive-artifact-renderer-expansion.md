# Interactive Artifact Renderer Expansion

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 当前 `interactive_artifacts` 支持类型过少；在完成业界能力调查后，用户要求直接支持前述 features。 |
| Acceptance criteria | 保留 session/message-owned artifact 单一来源；用严格、版本化 renderer 覆盖通用声明式图表、图与流程图、代码、Diff、高级数据表，以及可由现有 attachment 单一来源安全承载的媒体、文件、地图和 Notebook 展示；任意应用界面继续由 MCP Apps 承担；真实 publisher 工具可声明全部类型；Overlay 对每种新增类型存在真实渲染与交互测试；前端改动通过隔离页面截图并亲自复核。 |
| Hard constraints | 不新增 raw URL iframe、任意 HTML fallback、客户端影子 payload、隐藏消息或不可见业务动作；不把 bar/line/pie 等拆成独立 renderer；成熟工具链优先；不干预正在运行的 OpenCorvus/Overlay；Playwright 只由 Node 启动；不创建 worktree；不覆盖当前工作区与本任务无关的 orchestrator/cancellation 修改；提交前缀使用 `dsw-33987` 并推送 `myhexin/v0.0.17beta`。 |
| Sources read | `AGENTS.md`；`specs/current/architecture/07-panel.md`；`specs/records/2026-07/2026-07-19-inline-interactive-artifact-protocol.md`；interactive-artifact schema/persist/tool/route；Overlay artifact dispatch、四个 renderer、styles、browser fixture；AttachmentStore、attachment route、resource URL resolver；SDK/OpenAPI generation scripts；Vega-Lite、Mermaid、CodeMirror、TanStack Table、Jupyter MIME bundle、MapLibre、PDF.js 和 MCP Apps 官方资料。 |
| Whole-repository search evidence | `InteractiveArtifactPayload` 的生产 schema 唯一位于 `packages/opencorvus/src/interactive-artifact/schema.ts`；唯一写入口为 `publishInteractiveArtifact` 和 `publish_interactive_artifact`；唯一读取路由为 session-scoped interactive-artifact route；唯一客户端读取 service 为 `packages/overlay/src/services/interactive-artifact.ts`；唯一 renderer dispatch 为 `InteractiveArtifactPart.tsx`；publisher 描述只在 `publish-interactive-artifact.ts` 两处重复字面量；现有 browser coverage 集中于 `inline-interactive-artifacts-browser.test.ts`；现有 attachment bytes 单一来源是 `AttachmentStore` 与 `/attachment/<projectID>/<name>`；Overlay 资源 URL 转换单一入口是 `resolveResourceUrl` / blob cache；SDK types 与 OpenAPI 为生成物。 |
| Independent agent feedback | None；用户未要求子 Agent，当前 multi-agent 约束禁止自行委托。 |
| Baseline | `637480e933556f4f86d5a5b49fd0eb6fd6f1c2db` 与 `myhexin/v0.0.17beta` 一致。工作区已有无关未提交修改，本任务只按路径精确暂存自己的变更。 |

## Root Cause

协议已经正确解决 ownership、持久化、消息 part 和安全 sandbox，但内容层仍停留在首版四个
renderer。缺口不是“少几个图表名字”，而是缺少三个业界常用的中层协议：

1. 一个声明式可视化语法覆盖常规统计图；
2. 一个图/流程图语法和一个代码编辑器/差异查看器覆盖开发与设计产物；
3. 一个 canonical attachment reference 让媒体与文件展示复用现有内容寻址 bytes，而不是把
   base64 或远程 URL 塞进 artifact JSON。

继续为 bar、line、pie、image、audio 等逐项手写行为会制造重复 schema 和 renderer。把这些内容
全部塞进 `mcp-app@1` 又会丢失可检查的数据契约、无障碍语义、导出能力和统一视觉。

## Single-Source Design

### Native typed renderers

- `document@1`: 保持安全 Markdown 文档。
- `table@1`: 在现有 TanStack Table 上增加全局搜索、分页、行计数和空结果语义；不创建平行
  `data-grid` renderer。
- `candlestick@1`: 保持金融 OHLCV 专用 renderer。
- `chart@1`: 使用自包含 Vega-Lite JSON spec；payload 只接受 inline values，不允许 renderer
  自行取远程数据。
- `diagram@1`: 使用 Mermaid source；Mermaid strict security、缩放和复制由 renderer 负责。
- `code@1`: 使用现有 CodeMirror 6；支持明确 language、filename、只读/可编辑展示和复制。
- `diff@1`: 使用 CodeMirror Merge；old/new source 是唯一差异输入。
- `map@1`: 使用 MapLibre GL 和内联 GeoJSON；首版无外部 basemap/tile/network source。
- `notebook@1`: Jupyter-style cells；Markdown、代码和 rich output 组合只复用上述 renderer 的
  数据模型，不包含 kernel 或隐藏执行。

### Attachment-backed renderers

- `media@1`: payload 只携带 canonical `/attachment/<projectID>/<name>`、MIME（Multipurpose
  Internet Mail Extensions，多用途互联网邮件扩展类型）、alt/caption；支持 image/audio/video。
- `file-preview@1`: 同一 canonical attachment ref；首版覆盖 PDF（Portable Document Format，
  便携式文档格式）和 text。服务器 metadata/bytes 仍由 AttachmentStore 唯一拥有。
- publisher 必须验证 attachment URL 的 project ownership、metadata MIME 和 bytes；客户端只通过
 现有 resource resolver/blob cache 读取。

### Generic application surface

`mcp-app@1` 继续是表单、审批、Dashboard、实时面板和 3D/领域应用的唯一通用扩展面。本任务不新增
第二套 form/dashboard schema，也不开放不可见工具动作。未来 App mutation 必须先设计成真实可见
user/tool/result 消息流。

## Call-Site Disposition

| Call site | Disposition |
| --- | --- |
| `packages/opencorvus/src/interactive-artifact/schema.ts` | 扩展唯一 discriminated union；抽取可复用 scalar、attachment ref、chart/diagram/code/diff/map/notebook schema。 |
| `packages/opencorvus/src/interactive-artifact/persist.ts` | 发布 attachment-backed payload 前校验 canonical project attachment；保持唯一 DB writer。 |
| `packages/opencorvus/src/tool/publish-interactive-artifact.ts` | 单一描述列出新增 renderer 的选择规则；不按标题/扩展名猜测。 |
| `packages/opencorvus/test/interactive-artifact/interactive-artifact.test.ts` | 每种 payload 正反例、attachment ownership/corruption、持久化和 route 回放。 |
| `packages/overlay/src/components/InteractiveArtifactPart.tsx` | 为 union 中每个 renderer 增加穷尽 dispatch；未知 renderer 不静默空白。 |
| `packages/overlay/src/components/interactive-artifact/**` | 新增成熟库驱动 renderer；抽取 code view 和 attachment loading；增强现有 Table。 |
| `packages/overlay/src/styles/surfaces/messages.css` | 为工具栏、过滤、分页、图表、图、代码、媒体、文件、地图、Notebook 增加响应式消息卡片样式。 |
| `packages/overlay/package.json` / `bun.lock` | 添加 Vega-Lite、Mermaid、CodeMirror Merge、MapLibre 和 PDF.js 所需依赖；不引入平行 UI primitive。 |
| `packages/overlay/test/browser/inline-interactive-artifacts-browser.test.ts` | 从真实 composer message-flow fixture 覆盖新增 renderer、交互、刷新和 region screenshot。 |
| `packages/overlay/test/**` | renderer source/security contract 和组件行为回归。 |
| `packages/sdk/openapi.json` / `packages/sdk/js/src/gen/**` | 通过既有生成命令同步，不手改生成物。 |
| `specs/current/architecture/07-panel.md` | 将 living architecture 的四-renderer陈述更新为完整 typed renderer contract。 |
| `specs/README.md` / `specs/records/2026-07/README.md` | 索引本记录并运行文档健康测试。 |

## Verification

1. Interactive-artifact schema/persistence/tool/route focused tests。
2. Overlay renderer unit/source-contract tests、typecheck、Vite production build。
3. Node 启动的 Playwright 隔离 browser suite，覆盖所有新增交付面与交互。
4. 查看绑定当前 conversation card region 的 light/dark screenshots；发现视觉问题继续修复并复测。
5. SDK/OpenAPI generation check、route/docs/i18n/document-health、`git diff --check`。
6. 二次代码与视觉复核；只暂存本记录列出的本任务文件；commit 后推送 `myhexin/v0.0.17beta`。

## Progress

- [x] Baseline、远端、无关脏文件和所有现有调用面已确认。
- [x] 扩展方案与单一来源边界已落盘。
- [x] Schemas、publisher 和 attachment validation。
- [x] Overlay renderers 与交互。
- [x] Browser/visual acceptance。
- [x] SDK generation、route inventory、document-health、focused tests、Overlay/root typecheck 和 production build。
- [ ] `docs:check`：当前工作区另一项 Task Run 删除尚未同步 API reference，差异仅涉及 `/run/*` 路由；本变更没有新增或删除 route。
- [ ] Commit and git-cc push。

## Verification Evidence

- `bun packages/sdk/js/script/build.ts`：通过；`InteractiveArtifactPayload` OpenAPI Specification（开放式应用程序编程接口规范）和 TypeScript 生成物同步。
- `bun test packages/opencorvus/test/interactive-artifact/interactive-artifact.test.ts`：6 passed，覆盖全部 renderer、tool materialization、owner、cascade、attachment project/MIME/digest 和 route replay。
- `bun test packages/overlay/test/message-interactive-artifact.test.ts packages/overlay/test/theme-host-scope.test.ts`：10 passed。
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/inline-interactive-artifacts-browser.test.ts`：通过；由 Node 启动真实 browser，覆盖 composer message flow、十二类 artifact、交互、刷新回放和 light/dark region screenshot。
- `bun run typecheck`：根级 9 个 package typecheck 全部通过。
- `bun run api:routes-check`：32 files、6 rules 通过。
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`：21 passed。
- `git diff --check`：通过。

## Chat Agent Usage Guidance Addendum

### Recall

| Item | Detail |
| --- | --- |
| User requirement | 在 Chat Agent 内介绍 interactive artifacts 的用法。 |
| Acceptance criteria | Chat 的真实 runtime prompt 说明何时发布 artifact、如何选择全部 renderer、attachment 与网络/执行安全边界、发布后的回复行为，并给出最小工具调用示例；Coding、Control 和 Mission 不继承 Chat 专属教程；原生 Tool 与 AI SDK（Artificial Intelligence Software Development Kit，人工智能软件开发工具包）Tool 继续共享同一工具说明。 |
| Hard constraints | 教程必须进入 Chat Agent 的真实最终 system prompt，不能只改界面文案；renderer 选择规则只能有一个文案来源；不增加路由 gate、兼容逻辑、隐藏消息或第二套 artifact schema；保留当前工作区无关的 Task Run 重构。 |
| Sources read | `packages/opencorvus/src/agent/primary-assistant-registry.ts`；`packages/opencorvus/src/tool/publish-interactive-artifact.ts`；`packages/opencorvus/src/agent/tool-pool-data.ts`；`packages/opencorvus/test/agent/primary-assistant-registry.test.ts`；`packages/opencorvus/test/session/prompt-final-input.test.ts`；`packages/opencorvus/test/agent/runtime-template-registry.test.ts`。 |
| Whole-repository search evidence | `CHAT_RUNTIME_PROMPT` 只有 `primary-assistant-registry.ts` 一个定义并由 `nativeDefaultPrompt("chat")` 投影到最终 system prompt；`publish_interactive_artifact` 已在 Chat tool pool 中；publisher description 只在 `publish-interactive-artifact.ts` 内被原生 Tool 与 AI SDK Tool 复用；prompt materialization 的直接回归入口是 `primary-assistant-registry.test.ts`，最终输入等值回归入口是 `prompt-final-input.test.ts`。 |
| Independent agent feedback | None；用户未要求子 Agent，当前 multi-agent 约束禁止自行委托。 |

### Call-Site Disposition

| Call site | Disposition |
| --- | --- |
| `packages/opencorvus/src/prompt/fragments/interactive-artifact-guidance.ts` | 新增唯一 renderer 选择文案，分别组合成精简 Tool description 与 Chat 专属完整教程。 |
| `packages/opencorvus/src/agent/primary-assistant-registry.ts` | 只把完整教程加入 `CHAT_RUNTIME_PROMPT`；其他 primary assistant prompt 不变。 |
| `packages/opencorvus/src/tool/publish-interactive-artifact.ts` | 删除本地重复说明并导入共享 description；发布执行路径不变。 |
| `packages/opencorvus/test/agent/primary-assistant-registry.test.ts` | 断言 Chat 含完整教程、全部 renderer、安全约束和示例，并断言 Coding 不含 Chat 专属教程。 |

### Verification

1. 运行 Primary Assistant Registry focused test，证明真实 materialized Chat prompt 包含教程。
2. 运行 final prompt input regression，证明教程经过现有 observable narrative 组合进入模型最终输入。
3. 运行 interactive artifact focused test，证明共享 Tool description 未改变 schema、持久化与发布行为。
4. `git diff --check` 与相关 TypeScript typecheck；若全仓检查被当前无关 Task Run 重构阻塞，记录精确证据而不修改其文件。

### Verification Evidence

- `bun test packages/opencorvus/test/agent/primary-assistant-registry.test.ts packages/opencorvus/test/session/prompt-final-input.test.ts`：16 passed；materialized Chat prompt 包含完整教程与全部 renderer，Coding、Control、Mission 均不含 Chat 专属 heading，两个最小输入均通过真实 `InteractiveArtifactPayload` schema。
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`：21 passed。
- `bunx prettier --check <本任务四个 TypeScript 文件>`：通过。
- `git diff --check -- <本任务四个 TypeScript 文件>`：通过。
- `bun test packages/opencorvus/test/interactive-artifact/interactive-artifact.test.ts`：测试加载前被无关 Task Run 重构阻塞；`engine/agent-coordination.ts` 不再导出 `resolveAgentCoordinationSessionOwnership`，而并行修改中的 `orchestrator/tools.ts` 仍在导入它。
- `bun run typecheck`（`packages/opencorvus`）：被同一无关重构阻塞；错误只位于 `engine/tool-ownership.ts`、`engine/writer.ts`、`orchestrator/tools.ts` 和 `task-api/index.ts`，包括未同步的 `orchestrator_tool_ownership` artifact kind、ownership 导出与符号。Chat guidance 的四个 TypeScript 文件没有出现在诊断中。
