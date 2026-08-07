# MCP 接入平台调研与集成方案

> 日期：2026-08-06
>
> 状态：已完成官方资料调研与第二轮架构、安全、运维复审；待按阶段实施
>
> 适用范围：OpenCorvus 的通用外部 SaaS（Software as a Service，软件即服务）能力接入，重点覆盖 Gmail 与 TradingView 类金融信号源

## 结论摘要

OpenCorvus 不应自建一个覆盖数千 SaaS 的连接器市场，也不应把多个聚合平台同时挂到同一业务动作上做 fallback。建议采用以下单一职责方案：

1. **通用连接器首选 Pipedream MCP。** 对当前单用户桌面产品，先接 `https://mcp.pipedream.net/v2`。它使用标准远程 MCP（Model Context Protocol，模型上下文协议）和浏览器 OAuth（Open Authorization，开放授权），官方声明覆盖 3,000+ API（Application Programming Interface，应用程序编程接口）与 10,000+ tools，和 OpenCorvus 已有 Streamable HTTP、OAuth 2.0、PKCE（Proof Key for Code Exchange，授权码交换证明密钥）及动态客户端注册能力直接相容。
2. **Gmail 作为首个专用业务包，不把聚合平台的原始工具直接暴露给模型。** Work package 只投影 `gmail.read`、`gmail.draft`、`gmail.send`、`gmail.modify`、`gmail.delete` 等 typed package actions；每个动作映射到 Pipedream 中一个精确 Gmail tool，并继续走现有通用 permission-and-MCP invocation adapter。认证成功不等于挂载成功，挂载成功也不等于获得动作授权。
3. **TradingView 不按“官方 MCP Server”建模。** 截至本次官方资料核证，未发现 TradingView 发布的官方 MCP Server。可依赖的官方集成面是 alert webhook；TradingView Advanced Charts / Trading Platform 的 Datafeed API 是“把自己的行情接入 TradingView 图表”，并不提供 TradingView 行情数据。正确方案是 TradingView webhook 作为唯一信号入口，持牌行情源/券商 API 或其官方 MCP 作为唯一查询和交易执行来源。
4. **企业客户不是再叠一层通用平台。** 若必须满足 SSO（Single Sign-On，单点登录）、SCIM（System for Cross-domain Identity Management，跨域身份管理系统）、DLP（Data Loss Prevention，数据防泄漏）、区域驻留或私有部署，应通过采购评审把默认连接器平台整体替换为 Merge Agent Handler、StackOne 或 Workato 中的一个，而不是并行挂载。
5. **官方 MCP Registry 只用于发现，不是信任来源。** Registry 仍处于 preview，官方条款也要求使用者自行评估服务器；生产安装必须绑定明确发布者、版本、transport、权限说明和复审证据。

## 术语

- **MCP**：Model Context Protocol，模型上下文协议。
- **SaaS**：Software as a Service，软件即服务。
- **API**：Application Programming Interface，应用程序编程接口。
- **OAuth**：Open Authorization，开放授权。
- **PKCE**：Proof Key for Code Exchange，授权码交换证明密钥。
- **HTTP / HTTPS**：Hypertext Transfer Protocol / Hypertext Transfer Protocol Secure，超文本传输协议 / 超文本传输安全协议。
- **SSE**：Server-Sent Events，服务器发送事件。
- **RFC**：Request for Comments，互联网标准文档系列。
- **SSO**：Single Sign-On，单点登录。
- **SCIM**：System for Cross-domain Identity Management，跨域身份管理系统。
- **DLP**：Data Loss Prevention，数据防泄漏。
- **iPaaS**：Integration Platform as a Service，集成平台即服务。
- **PII / PHI**：Personally Identifiable Information / Protected Health Information，个人可识别信息 / 受保护健康信息。
- **VPC**：Virtual Private Cloud，虚拟私有云。
- **OIDC**：OpenID Connect，开放身份连接。
- **UI**：User Interface，用户界面。
- **ADR**：Architecture Decision Record，架构决策记录。
- **SLA**：Service Level Agreement，服务等级协议。
- **RFP**：Request for Proposal，方案征询。
- **URL**：Uniform Resource Locator，统一资源定位符。
- **JSON**：JavaScript Object Notation，JavaScript 对象表示法。
- **DOM**：Document Object Model，文档对象模型。
- **SSRF**：Server-Side Request Forgery，服务器端请求伪造。

## Recall

### 用户原始要求

- 调研尽可能全面的 MCP 接入平台，示例包括 TradingView、Gmail。
- 预计部分平台存在复杂配置，需要给出可执行的集成方案。
- 方案必须经过复审。

### 验收指标

- 覆盖通用聚合平台、工作流平台、企业治理平台、认证基础设施和官方 Registry，不把不同产品类别混为一谈。
- 使用官方资料核对覆盖量、认证方式、MCP 接口、工具约束及 Gmail/TradingView 的真实能力边界。
- 给出 OpenCorvus 适配方案、配置对象、生命周期、权限、安全、可观测性、迁移和分阶段交付。
- 给出明确首选，不以多平台 fallback 代替决策。
- 完成第二轮架构、安全、协议、运维和供应商锁定复审，记录发现与修订。

### 硬约束

- 保持 `specs/current/architecture/17-code-work-agent-platform.md` 已定义的边界：provider 语义归 capability package，Core 只拥有通用 MCP transport、OAuth、permission、事件与审计事实。
- `prompt_profile.active` 继续是 active Expert Squad 的唯一来源；连接器不得制造第二套 active profile、隐藏消息或合成消息。
- 同一业务能力只有一个执行来源；供应商切换必须是显式替换，不保留双写、双读或 fallback。
- 不用 host gate、状态机或关键字匹配教模型选工具；模型可见面由 package 声明、精确引用和现有 permission contract 构成。
- 不把 OAuth 登录当作 tool mount 或业务授权。
- 不把 TradingView 页面抓取、浏览器自动化、社区非官方 server 或网页 cookie 当作生产交易接口。
- 金融交易、发信、删除邮件等不可逆或高影响动作必须保留现有显式确认能力。

### 已读取的落盘资料

- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/17-code-work-agent-platform.md`
- `packages/web/src/content/docs/zh-cn/mcp-servers.mdx`
- `packages/opencorvus/src/mcp/index.ts`
- `packages/opencorvus/src/mcp/oauth-provider.ts`
- `packages/opencorvus/src/mcp/auth.ts`
- `packages/opencorvus/src/server/routes/mcp.ts`
- `packages/opencorvus/src/config/config.ts` 中的 MCP schema 投影

### 全仓搜索结果

使用 `rg` 搜索了 `MCP`、`mcp server`、`gmail`、`tradingview`、`connector`、`oauth`、`mcp-auth.json`、`mcp_server_refs`。结果表明：

- OpenCorvus 已支持 local stdio、remote Streamable HTTP、SSE（Server-Sent Events，服务器发送事件）、OAuth 2.0 + PKCE、RFC 7591 动态客户端注册、tools/prompts/resources 和 list-changed 通知。
- MCP auth 已按 project + server name 隔离，并绑定 server URL 与 credential identity；当前 token 仍写入权限为 `0600` 的 `mcp-auth.json`。
- 当前架构已经明确 Gmail 是 Work package 分配的 MCP server，raw Gmail tools 不是 transactional Work 的模型授权面。
- 当前代码没有 TradingView provider 或官方 TradingView MCP 的既有实现。

### 独立 Agent 反馈

本次没有启动子 Agent：用户要求“复审”但未明确要求多个独立 Agent、子 Agent 或并行审计，而当前协作约束禁止据此推断递归委托权限。复审由主 Agent 在初稿完成后以独立检查清单重新读取官方证据和仓库边界执行；结论与修订记录见“第二轮复审”。

## 调研方法与证据等级

本报告只用三类结论：

1. **已核证能力**：供应商官方产品页、官方文档或协议规范明确声明。
2. **架构推论**：由官方接口和 OpenCorvus 当前实现共同推出，并明确标注为方案选择。
3. **未核证能力**：官方资料没有证明，不能进入承诺范围。例如“TradingView 有官方 MCP”属于未核证能力。

社区 server、目录收录数量、博客转载和搜索结果只能用于发现候选，不能证明生产可靠性或官方授权。

## 平台全景

### 1. Agent 原生聚合平台

| 平台                    | 官方覆盖陈述                            | MCP / auth 模型                                                                                  | 强项                                                                                                                                                                    | 主要代价                                                                                                                  | OpenCorvus 结论                                                                                                               |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Pipedream Connect**   | 3,000+ API、10,000+ tools               | 面向最终用户的固定 OAuth URL；开发者版 remote MCP 支持 per-user header、Connect Link、托管 token | 当前桌面端接入最直接；action/trigger 与自定义代码生态成熟；tool annotations 标明 read/write/destructive                                                                 | 开发者版需要 client credentials、project/environment/external user；大目录需约束上下文；默认 OAuth scope 需逐 app 核查    | **默认首选**。桌面先用 v2 OAuth；嵌入式多用户另立实施阶段                                                                     |
| **Composio Sessions**   | 官方 catalog 当前显示 1,403 toolkits    | session 绑定 user、toolkits、auth configs、connections、tool version，并提供 session MCP URL     | Agent 原生语义最好；per-user 隔离、in-chat auth、工具限制、版本与 changelog 完整                                                                                        | 生产通常需要自有 OAuth app；session provisioning 和 API key custody 需要额外后端；旧 standalone MCP API 已 deprecated     | **首选备选，不并行启用**。若未来产品变为多租户 SaaS，可用一次 ADR（Architecture Decision Record，架构决策记录）替换 Pipedream |
| **Zapier MCP**          | 8,000+ app connections、30,000+ actions | 在 Zapier 配置 server、tools 与 app connections，再连接任意 MCP client                           | 目录覆盖最大、无代码配置最容易                                                                                                                                          | MCP 单次 tool call；复杂后台流程属于 Zapier Agents/Zaps；每次成功 MCP tool call 的计费需单独评估；工具配置偏人工          | 适合个人/运营团队，不作为默认开发者底座                                                                                       |
| **StackOne**            | 447 managed MCP servers、27,378 tools   | 一个 hosted MCP endpoint，配合 account onboarding、tool/action control                           | 企业 SaaS 覆盖、动态发现、上下文压缩和批量执行强                                                                                                                        | 商业平台、供应商绑定较重；公开覆盖量小于前三者                                                                            | 企业采购候选                                                                                                                  |
| **Merge Agent Handler** | hundreds of MCP-ready connectors        | Tool Pack + Registered User + Link + Security Gateway + audit log                                | per-user / group auth、PII（Personally Identifiable Information，个人可识别信息）/PHI（Protected Health Information，受保护健康信息）/支付数据扫描、SSO/SCIM 与完整审计 | 标准托管在 US-East；区域/单租户/VPC（Virtual Private Cloud，虚拟私有云）能力通常进入企业合同；自定义 MCP 仅支持静态 token | 高合规企业首选候选                                                                                                            |

### 2. 工作流和 iPaaS 平台

iPaaS（Integration Platform as a Service，集成平台即服务）更适合把已经治理好的 workflow/scenario/recipe 暴露为少量高层工具，而不是把数千个低层 API 动作直接交给模型。

| 平台             | MCP 形态                                                                                                   | 适合场景                                                          | 不适合场景                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Workato**      | MCP server 可分配 recipe function、API Platform collection、Genie；API 可管理 server、tools 与 user groups | 大企业既有 Workato、复杂审批、区域驻留、治理与 connector 资产复用 | 轻量桌面产品的默认依赖；中国大陆数据中心官方明确不提供 MCP                                                             |
| **Make**         | MCP server 可运行 scenario、管理 account；toolbox 可把 scenario 暴露为 tools                               | 已有 Make scenario 的高层复用                                     | 直接暴露全部 active/on-demand scenarios；官方也提示基础 server 不提供精确 scenario 粒度时应改用 toolbox/access control |
| **n8n**          | workflow 内 MCP Server Trigger；另有 instance-level MCP access                                             | 自托管、把人工设计的 workflow 变成高层工具、内部自动化            | 误认为安装 n8n 后所有 connector 都自动成为安全且语义稳定的 MCP tools                                                   |
| **Activepieces** | 内置 MCP server；可发现和编辑 flows、tables、runs，并按 project 启用 tool categories                       | 开源自托管、自动化构建与运维                                      | 直接替代 SaaS action aggregator；其平台 MCP 的核心是管理 Activepieces 资产                                             |

### 3. Gateway、认证和构建基础设施

| 平台/能力                 | 定位                                                                                                                   | 结论                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Arcade MCP Gateway**    | 聚合多个远程 MCP server，提供 gateway 级 OAuth/OIDC（OpenID Connect，开放身份连接）与 tool 选择；另有 tool-level OAuth | 如果 OpenCorvus 将来需要托管多租户 gateway，可评估；当前本地 client 已有投影和权限 owner，不应再叠一层只为“统一 URL” |
| **Nango**                 | 800+ API auth、token refresh、Connect UI、proxy/functions/MCP execution                                                | 适合自建深度 connector 时解决 OAuth 和 token custody；它不是开箱即用的 10,000-tool catalog 替代品                    |
| **Official MCP Registry** | 公共 server 元数据、DNS namespace 验证、REST discovery API                                                             | 只做 discovery input；preview、无私有 server、无运行时信任担保                                                       |
| **自建 OpenAPI-to-MCP**   | 从已有内部/垂直 API 生成专用 MCP server                                                                                | 只用于已有稳定 API 且聚合平台无法覆盖的垂直域；必须固定 schema、版本、owner 和部署，不用运行时任意 URL 转换          |

## 评分与选择

评分为本次方案判断，5 为最符合 OpenCorvus 当前需求。它不是供应商的官方评分。

| 平台                | 覆盖广度 | 单用户桌面直连 | 多用户隔离 | 精确 tool/scope | 企业治理 | 自托管 | 总体用途                  |
| ------------------- | -------: | -------------: | ---------: | --------------: | -------: | -----: | ------------------------- |
| Pipedream           |        5 |              5 |          4 |               4 |        3 |      3 | 默认通用连接器            |
| Composio            |        4 |              3 |          5 |               5 |        4 |      2 | 多租户 Agent 产品替换候选 |
| Zapier              |        5 |              5 |          2 |               4 |        3 |      1 | 无代码个人/运营接入       |
| StackOne            |        4 |              3 |          5 |               5 |        5 |      1 | 企业 Agent 集成           |
| Merge Agent Handler |        3 |              3 |          5 |               5 |        5 |      2 | 高合规企业 Agent 集成     |
| Workato             |        4 |              2 |          5 |               5 |        5 |      2 | 既有企业 workflow 资产    |
| Make                |        4 |              4 |          3 |               3 |        3 |      1 | scenario 级工具           |
| n8n                 |        3 |              3 |          3 |               4 |        3 |      5 | 自托管 workflow 级工具    |
| Activepieces        |        3 |              3 |          3 |               4 |        3 |      5 | 开源自动化资产控制        |

### 决策理由

- Pipedream v2 的固定 OAuth endpoint 可由当前 `Config.McpRemote` 直接表达，不需要把 vendor API key、external user header 或 session URL 生成逻辑先塞入 OpenCorvus。
- Pipedream 的覆盖足以验证通用连接器产品面；其 Gmail、Calendar、Slack、Linear、Notion、Stripe、PostgreSQL 等官方示例也覆盖首批价值路径。
- Composio 在多租户、精确 auth config 和 tool version 上更强，但会引入 session provisioning control plane。当前产品先为它构建抽象会超出实际需要。
- Zapier 覆盖更大，但其 MCP 产品更适合用户在 Zapier UI 中人工选择 actions；OpenCorvus 需要 package-owned typed actions 与可重复配置，因此 Pipedream 更匹配。
- 企业方案必须以采购、数据驻留、DLP、审计导出和合同 SLA（Service Level Agreement，服务等级协议）为选择依据，不能由运行时自动挑选供应商。

## OpenCorvus 目标架构

```text
User request
  → fixed Harness / active Expert Squad projection
  → package-owned typed action
  → package-owned exact semantic permission plan
  → existing generic permission-and-MCP invocation adapter
  → one exact configured remote MCP server and tool
  → Pipedream managed app connection
  → target SaaS API

TradingView alert
  → one authenticated webhook ingress
  → immutable normalized market-signal event
  → Automation / Event / Task wake
  → trading package typed query or order action
  → one exact licensed market-data / broker execution provider
```

### 单一来源边界

| 事实/行为                                            | 唯一 owner                                            |
| ---------------------------------------------------- | ----------------------------------------------------- |
| MCP transport、OAuth handshake、token lifecycle      | 现有 `MCP` / `McpAuth`                                |
| 一个 project 的 server definition                    | project `Config.mcp`                                  |
| 当前 Task 可见的 server/tool refs                    | `PromptProfileResolver` / Harness projection          |
| Gmail 业务语义、tool mapping、scope 要求、结果规范化 | Gmail capability package                              |
| Gmail 连接账户和下游 token                           | Pipedream managed connection                          |
| TradingView signal ingress                           | TradingView webhook adapter                           |
| 行情查询与订单执行                                   | 被选中的一个 licensed data/broker provider            |
| 动作确认与持久授权                                   | 现有 `PermissionNext`                                 |
| 外部调用和结果审计                                   | 现有可见 tool result + package normalized audit facts |

### 禁止的双源形态

- 同一个 `gmail.send` 同时尝试 Pipedream、Composio 或 Gmail direct API。
- TradingView webhook 丢失后改用网页抓取补数据。
- 券商调用失败后自动切到另一个券商。
- OAuth 失败后读取手工粘贴在普通 config 或 prompt 中的 provider token。
- 原始 provider MCP tools 与 package typed actions 同时对模型可见。

供应商迁移必须更新一个 package mapping 和一个 exact MCP reference，删除旧定义并重新认证；迁移批次内不双写、不影子执行。

## 配置模型

### 第一阶段：现有 schema 可直接表达

建议先以一个 project-owned remote server 接入 Pipedream：

```jsonc
{
  "mcp": {
    "pipedream": {
      "type": "remote",
      "transport": "streamable-http",
      "url": "https://mcp.pipedream.net/v2",
      "enabled": true,
      "timeout": 30000,
    },
  },
}
```

不在配置里写 `Authorization` header、Pipedream client secret、Gmail token 或 TradingView 凭据。OAuth 由现有 MCP client 发现并打开浏览器完成。

### Package-owned connector declaration

下述为实施时应形成的 strict data contract，不是第二套运行时 registry：它随 package manifest/资源一起解析，并由现有 `PromptProfileResolver` 投影。

```ts
type ExternalActionBinding = {
  action: string
  mcp_server_ref: string
  mcp_tool: string
  permission: {
    name: string
    exact_pattern_fields: string[]
    visible_redacted_fields: string[]
  }
  result_schema_ref: string
  idempotency: "provider_key" | "package_operation_id" | "not_supported"
}
```

`action`、`mcp_tool` 和 schema ref 都是精确值，不允许 fuzzy match。该声明不保存 token、连接状态、active provider 或 workflow step。

### Complex configuration 分层

复杂连接器配置按 owner 分开，避免一个万能 JSON：

| 配置类别           | 示例                                                                              | owner / 存储                 |
| ------------------ | --------------------------------------------------------------------------------- | ---------------------------- |
| Transport          | URL、transport、timeout、非秘密租户 routing header                                | project `Config.mcp`         |
| MCP OAuth          | server authorization metadata、client registration、access/refresh token          | `MCP` / `McpAuth`            |
| Vendor connection  | Gmail account、Pipedream app connection、refresh                                  | vendor hosted auth           |
| Package behavior   | mailbox、label、default draft policy、recipient domain policy                     | package config               |
| Permission         | `gmail.send` recipient/domain pattern、trade account/instrument/quantity pattern  | `PermissionNext`             |
| Event ingress      | TradingView webhook endpoint identity、signature secret reference、source account | Event adapter + secret owner |
| Operational policy | timeout、provider rate-limit metadata、retryable error class、idempotency mode    | package/provider adapter     |

如果需要 client secret、webhook signing secret 或 developer API key，必须先使用通用加密 secret store；不能把 `0600` JSON 重新命名成 secret vault。现有 MCP OAuth token owner 可继续承担协议 token，但不得扩展为任意 provider secret 仓库。

## Gmail 集成

### 能力切片

| Package action                        | 建议 Gmail scope 级别                                 | 业务权限       | 默认确认                                   |
| ------------------------------------- | ----------------------------------------------------- | -------------- | ------------------------------------------ |
| `gmail.read_message` / `gmail.search` | read-only narrow scope                                | `gmail.read`   | 可按 mailbox/query exact pattern 持久允许  |
| `gmail.create_draft`                  | compose/draft scope                                   | `gmail.draft`  | 可按 mailbox 持久允许                      |
| `gmail.send_draft`                    | send scope                                            | `gmail.send`   | 每个新 recipient/domain 询问；群发始终询问 |
| `gmail.modify_labels`                 | modify scope                                          | `gmail.modify` | 删除系统 label 或批量修改时询问            |
| `gmail.delete_message`                | modify/full mailbox scope，按官方 method 实际要求核定 | `gmail.delete` | 每次询问                                   |

Google 官方将 Gmail scopes 分为 non-sensitive、sensitive、restricted。使用 restricted scope 且在服务器存储或传输对应数据时，可能需要 OAuth app verification 和安全评估。因此：

1. 第一版只交付 read、draft、send，不以一个宽 scope 覆盖全部动作。
2. Pipedream 实际请求 scope 必须在连接验收时导出并与 package 声明逐项核对；无法收窄时，不批准 Gmail production rollout。
3. delete 与批量 modify 是独立后续切片，不因平台“已有 tool”自动开放。
4. 账户 subject、邮箱地址与授权 scope 作为连接事实展示；不把 refresh token 暴露给模型、日志或 artifact。

### Gmail push

实时邮件触发不是普通 MCP tool call。Google 官方 Gmail API 使用 Cloud Pub/Sub 推送 mailbox 变化，`watch` 最迟每 7 天续期且官方建议每日续期；通知只携带 mailbox address 与 `historyId`，应用还要调用 `history.list` 获取变化。

第一阶段不实现 Gmail push。若后续需要“新邮件自动唤醒 Task”：

- 只选择 Pipedream trigger 或 Google Pub/Sub direct adapter 中的一个；
- 规范化为 immutable mail-change event；
- 由现有 Event/Automation/Task wake 消费；
- 以 provider event ID / Gmail history cursor 去重；
- 不把轮询作为 push 的静默 fallback。

## TradingView 集成

### 已核证能力边界

- TradingView alert 可向用户配置的 URL 发送 HTTP POST webhook。
- 仅允许端口 80/443，服务超过 3 秒未响应会被取消；官方提示 webhook 偶尔可能投递失败，并可在 alert log 查看状态。
- webhook 要求 TradingView 账户开启双因素认证。
- 官方明确提示 webhook body 不应包含登录凭据或密码。
- Advanced Charts / Trading Platform 不含 market data；Datafeed API 要求产品方提供自己的数据源。
- Broker API 是把券商后端接到 TradingView 图表的能力，不是从 TradingView 账户获得一个通用交易 API。

因此，任何“读取 TradingView watchlist/私有指标/账户历史/图表数据/直接下单”的社区 MCP 都必须视为非官方实现，不能进入默认生产 catalog。

### 推荐链路

#### 信号入口

1. 为每个 project/account 创建一个不可猜测的 webhook endpoint identity。
2. TradingView alert body 使用版本化 JSON envelope：`event_id`、`occurred_at`、`symbol`、`exchange`、`timeframe`、`signal`、`strategy_revision`、`price`、`nonce`。
3. endpoint 在 3 秒内完成认证、schema validation、持久化 immutable event 和快速响应；后续分析异步进入现有 Event/Task 路径。
4. TradingView 原生 webhook 文档没有证明提供通用签名 header，因此认证不能臆造。首选 endpoint-specific high-entropy URL + body nonce；如业务要求强签名，应在 TradingView 与 OpenCorvus 之间放一个明确拥有签名能力的 webhook relay，并把它作为唯一入口，而不是双入口。
5. 事件以 `event_id + source_account + strategy_revision` 做幂等写入；重复投递返回同一接收事实。

#### 行情与交易执行

- 行情查询选择一个有明确许可的 market-data provider，例如业务实际采购的交易所数据、Alpaca/Polygon/FactSet 等；最终供应商需按市场、延迟、再分发权和地区采购决定。
- 交易执行选择用户真实券商的官方 API 或官方 MCP。Market data 与 broker 若由同一供应商提供，可共用 provider package，但事实 owner 仍按 contract 区分。
- `order.preview` 产生规范化预览：账户、instrument、side、order type、quantity/notional、limit/stop、estimated fees、market status、provider timestamp。
- `order.submit` 必须引用同一预览 identity，并触发显式不可逆操作确认；确认后调用一个 exact broker tool。
- 订单提交结果只信任券商返回的 order ID/status；TradingView alert 不是成交事实。

### 明确不交付

- 不通过 Playwright、Browser Preview、cookie 或 DOM（Document Object Model，文档对象模型）操作 TradingView 下单。
- 不抓取 TradingView 页面作为许可行情源。
- 不把 TradingView alert webhook 称为 MCP server。
- 不在 webhook 超时或丢失时自动重放订单。
- 不把 community TradingView MCP 默认安装到 production。

## 安全与治理

### MCP 协议要求

远程 server 必须使用 HTTPS（Hypertext Transfer Protocol Secure，超文本传输安全协议）和 Streamable HTTP；SSE 只留给明确仅支持 SSE 的旧 server。按 MCP 官方授权规范：

- OAuth authorization/token request 携带 resource indicator；server 校验 token audience。
- 使用 PKCE、精确 redirect URI、短期 state、单次使用 authorization code。
- 禁止 token passthrough；MCP server 入站 token 与下游 SaaS token 是不同安全域。
- OAuth metadata discovery 涉及网络访问，需防 SSRF（Server-Side Request Forgery，服务器端请求伪造）；生产拒绝非 loopback HTTP、私网/metadata endpoint 和 redirect chain 越权。
- 不记录 Authorization header、token、authorization code、client secret 或带 secret 的 query string。

### Server admission

Registry 条目或 vendor URL 只提供候选元数据。安装前人工复审并记录：

- publisher/domain ownership、官方文档与服务条款；
- endpoint、transport、OAuth metadata、redirect URI；
- 精确 tools、input/output schema、tool annotations 和版本/changelog；
- read/write/destructive 分类、数据类别、scope 与账户 subject；
- 数据驻留、subprocessor、retention、训练使用、日志导出和删除能力；
- rate limit、timeout、idempotency、重试和故障公告；
- 供应商退出时的 token revoke、数据删除和 mapping replacement 方案。

这是一项安装/采购审查，不是运行时 gate。运行时继续依赖已解析的精确 package declaration、MCP reference 与 permission。

### Prompt injection 与返回数据

邮件、文档、工单和 webhook 文本都是不可信外部内容。它们可以作为 evidence 输入，但不能改变 tool projection、permission、recipient、account 或 system instruction。Package normalized result 应区分 provider metadata 与 user-authored content；任何从内容中提取出的新外部动作参数仍按对应 typed action 和 permission 处理。

## 可观测性与运行契约

每次外部动作至少记录以下非秘密事实：

- Task / Session / package revision；
- MCP server ref、tool name、tool schema/version；
- provider account subject 的不可逆散列或安全显示名；
- semantic permission name 与已脱敏 exact patterns；
- request operation ID、provider request/order/message ID；
- started/finished timestamp、latency、normalized result/error class；
- operator confirmation identity（若适用）；
- vendor trace ID 与 rate-limit metadata（若返回）。

禁止记录 message body、email body、refresh token、Authorization header 或完整金融账户号，除非它们是用户明确要求保存的 artifact，且走既有 attachment/artifact 权限和 retention owner。

### 错误语义

Package 把 provider 错误规范化为 typed result，例如：

- `AUTH_REQUIRED`：连接不存在、撤销或 scope 不足；
- `RATE_LIMITED`：包含可用的 retry-after；
- `INVALID_ARGUMENT`：provider 拒绝 schema/业务参数；
- `PROVIDER_UNAVAILABLE`：供应商暂时不可用；
- `ACTION_CONFLICT`：idempotency key 已对应不同请求；
- `ACTION_ACCEPTED`：provider 已接收并返回 provider identity；
- `ACTION_RESULT_UNKNOWN`：连接中断且无法证明是否执行。

对于 send/order 等写操作，`ACTION_RESULT_UNKNOWN` 必须先用同一 provider 的查询接口按 operation/provider ID 查证，不能盲目重试，也不能切供应商。

## 分阶段实施

### Phase 0 — 无代码协议验证

- 在隔离 project 配置 Pipedream v2 remote MCP。
- 完成 OAuth，连接测试 Gmail 账户。
- 记录 `tools/list` 的 Gmail tools、annotations、schemas、实际 OAuth scopes 和 account subject。
- 只人工执行 read-only 查询，确认 OpenCorvus transport、OAuth、status、logout 与 reconnect。
- 验收产物是调查记录，不把 raw transactional tools 发布给 Work package。

### Phase 1 — Gmail typed package actions

- 定义 Gmail package config、normalized schemas 与 exact tool mappings。
- 实现通用 permission-and-MCP invocation adapter（若当前架构计划中的 adapter 尚未落地），Core 不包含 Gmail 名称或规则。
- 首批只实现 read/search、create draft、send draft。
- 为非 UI contract 添加正向测试：typed input → permission plan → exact MCP call → normalized result；OAuth 登录和 UI 仅走真实交互人工验收。
- 真实测试账户完成 read、draft、send、revoked auth、scope shortage、provider rate-limit 和 ambiguous result 的交互验证。

### Phase 2 — TradingView signal ingress

- 先确定只做 signal ingestion，不承诺 TradingView account data。
- 实现版本化 webhook schema、endpoint identity、nonce、immutable event 与 idempotent acknowledgement。
- 用真实 TradingView alert 验证 80/443、3 秒响应、JSON/plain-text content type、重复投递与 alert log。
- 对 event normalization 和 deduplication 添加纯非 UI 正向 contract tests。

### Phase 3 — Licensed market data / broker execution

- 采购前确定市场、地区、实时性、再分发、券商账户和合规要求。
- 只安装一个 market-data source 和一个 broker execution source；若是同一供应商也分别声明 query/transaction capability。
- 先交付 positions/orders/read-only，再交付 preview，最后才交付 submit/cancel。
- 真实 sandbox/paper account 完成 provider order ID、idempotency、partial fill、cancel 和 unknown-result reconciliation 验证。

### Phase 4 — 企业连接器替换（仅有明确需求时）

- 以 DLP、SSO/SCIM、区域驻留、VPC、审计导出、SLA、价格与 connector coverage 进行 RFP（Request for Proposal，方案征询）。
- 在 Pipedream、Merge、StackOne、Workato 中只选一个目标平台。
- 在一个 release 中替换 package mappings 和 MCP refs，撤销旧 token、删除旧 server definition，不保留 fallback。

## 验收清单

### 通用平台

- [ ] exact endpoint 使用 Streamable HTTP，OAuth metadata 和 callback 可由 OpenCorvus 完成。
- [ ] tools/list 数量、schema、annotations、version 与 vendor catalog 一致。
- [ ] 只投影 package 声明的 exact refs；raw write/destructive tools 不对模型可见。
- [ ] logout 后 token 被撤销/删除，server 不再可调用。
- [ ] 连接一个账户不会让另一个 project/account 获得其 tool authority。

### Gmail

- [ ] read、draft、send 使用不同 semantic permission。
- [ ] 实际 OAuth scopes 不宽于已批准 slice。
- [ ] send result 有 provider message/thread identity；unknown result 不重复发送。
- [ ] 邮件内容中的 prompt injection 不能改变 recipient、account、permission 或 tool projection。

### TradingView / trading

- [ ] 真实 TradingView alert 到达唯一 webhook endpoint，并在 3 秒内获得响应。
- [ ] 重复 event 得到同一持久化 identity，不重复唤醒交易动作。
- [ ] 行情数据来源和许可证有记录；TradingView UI 不是数据 API。
- [ ] order preview 与 submit 引用同一事实，submit 有显式确认。
- [ ] 成交与订单状态只以券商返回事实为准。

### 运维与退出

- [ ] vendor rate limit、billing unit、retention、residency 与 incident channel 已记录。
- [ ] 所有 secret/token 可 revoke，连接可按 project/account 删除。
- [ ] tool schema 变化触发 package mapping 复审，不静默采用 `latest` 改写行为。
- [ ] 替换供应商时删除旧 mapping/ref/token，不并行运行。

## 第二轮复审

### 复审范围

初稿完成后重新检查了五个维度：与现有架构是否冲突、是否存在双源/fallback、协议授权是否完整、Gmail/TradingView 是否夸大官方能力、生产运维是否可收敛。

### 发现与修订

1. **初始倾向曾考虑“Pipedream 通用 + Composio Gmail”。** 这会让同类 SaaS action 有两个集成 control plane，也让账户和 scope 配置分裂。已修订为 Pipedream 单一默认；Composio 只保留未来整体替换候选。
2. **仅写“接 TradingView MCP”会制造错误产品承诺。** 官方材料只证明 webhook、Datafeed/Broker integration 边界，未证明官方 MCP。已改为 webhook ingress 与 licensed execution provider 两条明确且不重叠的 authority。
3. **直接暴露 Pipedream 10,000 tools 会扩大上下文与权限面。** 已修订为 package typed actions + exact tool mapping；平台目录只用于配置发现。
4. **把平台 managed auth 等同于最小权限不成立。** Pipedream/其他平台可能用覆盖面较大的共享 OAuth app。已增加“实际 scope 导出与批准”验收；无法收窄则 Gmail production 不通过。
5. **写操作普通 retry 会导致重复发信或重复下单。** 已补充 operation ID、provider ID、ambiguous result reconciliation 和禁止跨供应商 retry。
6. **当前 `mcp-auth.json` 是 `0600` 文件，不是通用 secret store。** 已限制第一阶段不把 developer client secrets、TradingView secrets 或 broker keys写入普通 config，并将通用加密 secret store列为需要这些凭据前的前置能力。
7. **Registry namespace verification 容易被误读为安全背书。** 已明确 Registry 仅是 discovery input，生产 admission 仍需 publisher、version、scope、retention 和退出审查。

### 复审结论

方案在当前 OpenCorvus 架构下可实施，且没有引入第二套 active capability owner、运行时供应商 fallback、host 状态机或 raw transactional tool 绕过 permission 的路径。推荐批准 Phase 0 调查和 Phase 1 Gmail read/draft/send；TradingView 只批准 Phase 2 signal ingestion。真实交易执行必须等待数据许可、券商选择、paper account 与不可逆操作确认验收完成后单独批准。

## 官方资料

- [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [Official MCP Registry](https://modelcontextprotocol.io/registry/about)
- [Pipedream MCP for end users](https://pipedream.com/docs/connect/mcp/users)
- [Pipedream MCP for developers](https://pipedream.com/docs/connect/mcp/developers)
- [Pipedream custom OAuth clients](https://pipedream.com/docs/apps/oauth-clients)
- [Composio sessions and MCP](https://docs.composio.dev/docs/how-composio-works)
- [Composio authentication](https://docs.composio.dev/docs/authentication)
- [Composio toolkit catalog](https://docs.composio.dev/toolkits)
- [Zapier MCP](https://docs.zapier.com/mcp/home)
- [StackOne MCP](https://www.stackone.com/platform/mcp/)
- [Merge Agent Handler architecture](https://docs.merge.dev/merge-agent-handler/how-it-works)
- [Workato MCP](https://docs.workato.com/en/mcp)
- [Make MCP server](https://developers.make.com/mcp-server)
- [n8n instance-level MCP access](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
- [n8n MCP Server Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/)
- [Activepieces MCP server](https://www.activepieces.com/docs/mcp/overview)
- [Arcade MCP gateways](https://docs.arcade.dev/en/guides/mcp-gateways)
- [Nango auth guide](https://nango.dev/docs/guides/auth/auth-guide)
- [Google Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [TradingView webhook alerts](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/)
- [TradingView Advanced Charts data connection](https://www.tradingview.com/charting-library-docs/latest/connecting_data/)
