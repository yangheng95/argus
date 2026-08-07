# Zapier MCP 安全凭证接入与真实验收

> 日期：2026-08-07
>
> 状态：实施中

## Recall

### 用户原始要求

- 在 OpenCorvus 中真正配置并测试 Zapier，而不是只在 Zapier 后台创建服务器。
- 明确 Model Context Protocol（MCP，模型上下文协议）token 面向用户还是软件，并把软件凭证按正确边界集成。
- 完成 Gmail 等实际应用授权、OpenCorvus 连接、真实调用和交互式结果呈现验证。
- 交付必须经过二次复审。

### 验收指标

1. 项目 MCP 配置不保存 Zapier token、带 token 的 Uniform Resource Locator（URL，统一资源定位符）或密钥请求头。
2. 用户级 MCP 认证所有者以项目身份和服务器名称隔离保存静态凭证，文件权限沿用现有 `0600` 原子写入契约。
3. 远程 MCP 配置只声明凭证放置方式；运行时从唯一认证所有者读取密钥并注入查询参数或请求头。
4. Overlay（覆盖层用户界面）的 Add MCP 表单可以输入静态凭证，密码输入框不回显，后端响应和项目配置均不返回密钥。
5. Zapier 服务器在 OpenCorvus 的 MCP Connections 中真实显示为 connected，并能列出、调用一个已授权 Gmail 工具。
6. 若 Zapier 工具声明真实 `ui://` 应用资源，则复用既有 `mcp-app@1`；否则结构化多项结果按既有 Prompt 选择原生 Interactive Artifact，不伪造 MCP App。
7. 非 User Interface（UI，用户界面）契约测试、类型检查、真实页面截图人工复核和第二遍源码/安全复审全部通过。

### 硬约束

- `McpAuth` 继续作为 MCP OAuth（Open Authorization，开放授权）和静态凭证的唯一持久化所有者；禁止新增第二套 vault、环境变量或项目本地 secret 文件。
- 项目配置只保存非秘密的凭证描述符；静态凭证自然引用精确的 `projectID:mcpName` 认证身份。
- 不使用 provider 名称、URL 关键字或 fallback 判断 Zapier；查询参数、Bearer（持有者）和自定义 Header（请求头）是通用数据契约。
- 静态凭证配置与 OAuth 自动发现互斥，避免同一服务器存在双认证来源。
- 不新增、修改或运行 UI 自动化测试；UI 只通过真实应用操作、截图和人工视觉复核验收。
- 保留工作区中 `packages/opencorvus/src/mcp/computer/backend.ts` 与 `packages/opencorvus/test/mcp/computer-contract.test.ts` 的既有未提交改动，不纳入本任务提交。
- 提交 subject 以 `dsw-33987` 开头，并推送到 legacy remote 的当前交付分支。

### 已读取的落盘资料

- `specs/records/2026-08/2026-08-06-mcp-integration-platform-research-and-plan.md`
- `specs/records/2026-08/2026-08-07-mcp-structured-result-interactive-artifact-prompt.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/17-code-work-agent-platform.md`
- `packages/opencorvus/src/config/mcp-schema.ts`
- `packages/opencorvus/src/mcp/auth.ts`
- `packages/opencorvus/src/mcp/index.ts`
- `packages/opencorvus/src/server/routes/mcp.ts`
- `packages/overlay/src/services/mcp.ts`
- `packages/overlay/src/components/settings/SkillMarketPanel.tsx`

### 全仓 grep 结果

对 `McpRemote`、`headers`、`mcp-auth`、`StreamableHTTPClientTransport`、`MCP.configure`、`MCP Connections`、`mcp-app@1` 和 `ui://` 的搜索证明：

- 远程 MCP 当前可把任意 `headers` 和完整 URL 明文写入项目配置。
- `McpAuth` 已按项目和服务器名隔离 OAuth token，并绑定服务器 URL 与 credential identity，适合扩展为单一 MCP 凭证所有者。
- 远程 transport 目前同步读取项目配置构造 URL 和请求头；尚未从认证存储物化静态凭证。
- Add MCP 表单只支持名称、transport 和 URL，没有秘密输入或认证类型。
- 自动 `mcp-app@1` 已由真实工具 `_meta.ui.resourceUri` 单一驱动，本任务无需新 renderer。

### 独立 Agent 反馈

用户要求复审，但未明确要求子 Agent 或并行 Agent。本任务按当前委托边界不启动子 Agent；实现完成后由主 Agent 重新读取 staged diff、认证数据流、测试证据和真实页面截图执行独立第二遍复审。

## 根因

先前工作只完成 Zapier 侧服务器准备和 Prompt 呈现规则，没有把服务器定义写入 OpenCorvus。直接把 Zapier 提供的 `?token=...` URL 填入现有表单，又会把软件凭证持久化到项目配置，可能进入版本控制。缺口不是 Zapier 专用按钮，而是远程 MCP 静态凭证缺少单一、安全的持久化与运行时物化协议。

## 单一实现方案

1. 在 `McpRemote` 增加严格的静态 `credential` 描述符：`query`、`bearer` 或 `header`。描述符只含放置方式和公开名称，不含 secret；配置静态凭证时必须显式关闭 OAuth 自动发现。
2. 在 `McpAuth.Entry` 增加静态 secret。它与 OAuth token 共用同一作用域、URL/identity 绑定、修订和原子 mode `0600` 文件写入。
3. `MCP.configure` 接收可选 secret，在连接前写入认证所有者；配置失败时恢复精确旧认证条目。运行时构造 transport 前读取并校验绑定的 secret，再把它加入 URL 查询参数或请求头。
4. HTTP（Hypertext Transfer Protocol，超文本传输协议）路由和 Overlay service 发送 `credentialSecret`，但配置响应、状态、日志和项目 JSON 永不返回它。
5. Add MCP 表单使用现有 TextField/SelectField/Button primitives 增加认证类型、凭证名称和 password 输入。Zapier 使用基础 URL `https://mcp.zapier.com/api/v1/connect`、`query`、参数名 `token`。
6. 通过已登录 Zapier 页面生成 token、完成 Gmail connection/tool 配置，然后在真实 OpenCorvus 页面添加并连接。调用只选择可逆的 Gmail 读取类工具，避免发送、删除等外部副作用。

## 验证与复审

- 正向测试覆盖 schema、认证存储、静态凭证物化、configure 路由/服务 payload、重启后连接和删除清理。
- 运行目标非 UI 测试、类型检查、API route/document health 检查。
- 启动真实应用，截图查看 Add MCP 表单、connected 状态和真实工具结果；不落盘 UI 测试或截图基线。
- 第二遍复审检查项目配置、staged diff 和日志中不存在 token，确认 OAuth/静态凭证没有双源，并复跑关键契约。

## 实施记录

- 静态凭证描述符、用户级认证存储、运行时查询参数/Bearer/Header 注入、单一配置路由和 Overlay Add MCP 表单已实现。
- `bun test packages/opencorvus/test/mcp/static-credential-contract.test.ts --timeout=0` 通过 4 项正向契约；`bun test packages/overlay/test/mcp-service.test.ts --timeout=0` 通过 5 项 service payload 契约。
- `bun run --cwd packages/opencorvus typecheck` 与 `bun run --cwd packages/overlay typecheck` 均通过。
- 在真实 `http://127.0.0.1:5173/` OpenCorvus 页面打开 Settings -> MCP Connections -> Add MCP，选择 URL query parameter 后，1280 x 760 截图确认表单完整显示 Authentication、Credential name 和 Credential secret；密钥字段实际为 `type=password`，页面控制台无 warning/error。
- 本轮没有输入或传输真实 Zapier token，也没有对第三方 Gmail 账户执行调用；该外部账户验收仍属于原计划的未完成项，不能把上述本地契约与真实页面验收表述成 Zapier Gmail 已连通。
