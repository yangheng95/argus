---
type: developer-api
last-updated: 2026-07-07
sources:
  - docs.ainvest.com/llms.txt (完整文档索引)
  - docs.ainvest.com/docs/quickstart.md
  - docs.ainvest.com/docs/mcp-servers.md
  - docs.ainvest.com/reference/ (OpenAPI specs)
  - ainvest.com/business/developer-manage/ (API key 管理)
  - linkedin.com/company/ainvestofficial (GTC 2026 post)
---

# Developer API — AInvest 公开开发者 API

> AInvest 有一套**完整的公开 REST API**（`docs.ainvest.com`），面向开发者和 B2B 合作伙伴。API 提供免费 tier，无需信用卡。同时提供 **MCP server** 供 Claude 等 AI 直接调用。
>
> 这是 AInvest 的**B2B / 开发者侧产品线**（区别于面向消费者的 ainvest.com 站点）。

## 概览

| 项 | 值 |
|----|---|
| 文档站 | `https://docs.ainvest.com` |
| LLM 索引 | `https://docs.ainvest.com/llms.txt` |
| API Playground | `https://docs.ainvest.com/reference` |
| 生产 Base URL | `https://openapi.ainvest.com/open` |
| MCP Server | `https://docsmcp.ainvest.com` |
| Developer Center | `https://www.ainvest.com/business/developer-manage/`（管理 API Key） |
| 定价 | **Free tier**（limited calls/min/day）—— 无需信用卡 |
| OpenAPI Spec | `https://docs.ainvest.com/api-reference/openapi.json` |

## API 模块（6 大类）

### 1. Securities（证券主数据）

| Endpoint | 功能 |
|----------|------|
| `GET /securities/search` | 按 ticker 或公司名搜索美股 |
| `GET /securities/stock/financials` | 财务指标（EPS / gross profit / operating income / TTM 等） |
| `GET /securities/stock/statements` | 三表（income / balance sheet / cash flow） |
| `GET /securities/stock/dividends` | 股息历史 |
| `GET /securities/stock/earnings` | 财报（revenue / EPS / SEC links / earnings call recordings） |
| `GET /securities/etf/profile` | ETF 概览（AUM / fee / dividend / industry） |
| `GET /securities/etf/holdings` | ETF 持仓 + 变动历史 |

### 2. News（新闻）

| Endpoint | 功能 |
|----------|------|
| `GET /news/articles` | 文章列表（支持分页 + 过滤） |
| `GET /news/articles/content` | 文章正文（按 articleId） |
| `GET /news/wires` | Newswire 快讯列表 |
| `GET /news/wires/content` | 快讯正文 |

### 3. Market Data（行情）

| Endpoint | 功能 |
|----------|------|
| `GET /marketdata/candles` | OHLCV K 线（指定 period / aggregation / session） |
| `GET /marketdata/trades` | 逐笔成交（tick-by-tick） |

### 4. Calendar（日历）

| Endpoint | 功能 |
|----------|------|
| `GET /calendar/earnings` | 财报日历 |
| `GET /calendar/dividends` | 除息日历（historical + upcoming） |
| `GET /calendar/ipo` | IPO 日历 |
| `GET /calendar/corporateactions` | 股票拆分 / 合股 |
| `GET /calendar/economics` | 宏观经济事件（GDP / 就业等） |
| `GET /calendar/earnings-backtesting` | 财报回测 |

### 5. Ownership（持仓 / 大户）

| Endpoint | 功能 |
|----------|------|
| `GET /ownership/congress` | 美国国会议员交易（date / type / approximate $ value） |
| `GET /ownership/insider` | 内部人交易（SEC filing） |

### 6. Analysis & Ratings（评级）

| Endpoint | 功能 |
|----------|------|
| `GET /analysis-ratings/consensus` | 当前 consensus 评级 + 目标价 |
| `GET /analysis-ratings/history` | 所有评级历史（firm / target price / date） |

## OpenAPI Spec 文件

| Spec | URL |
|------|-----|
| securities | `docs.ainvest.com/reference/securities/securities.yaml` |
| news | `docs.ainvest.com/reference/news/news.yaml` |
| marketdata | `docs.ainvest.com/reference/marketdata/marketdata.yaml` |
| calendar | `docs.ainvest.com/reference/calendar/calendar.yaml` |
| ownership | `docs.ainvest.com/reference/ownership/ownership.yaml` |
| analysis-ratings | `docs.ainvest.com/reference/analysis-ratings/analysis-ratings.yaml` |
| analysts-ratings | `docs.ainvest.com/reference/analysts-ratings/analysts-ratings.yaml` |
| 综合 | `docs.ainvest.com/api-reference/openapi.json` |

## MCP Server（AI 集成）

AInvest 提供 **MCP（Model Context Protocol）server**，供 Claude 等 AI 助手直接调用 API：

- **Server URL**: `https://docsmcp.ainvest.com`
- **认证**: `Authorization: Bearer {AUTH_TOKEN}`
- **支持的 AI 客户端**: Claude Code / Claude Desktop / 任何 MCP-compatible client

### Claude Code 配置

```bash
claude mcp add --transport http ainvest https://docsmcp.ainvest.com --header "Authorization: Bearer ${AUTH_TOKEN}" -s user
```

### Claude Desktop 配置

```json
"remote ainvest": {
  "command": "npx",
  "args": [
    "mcp-remote",
    "https://docsmcp.ainvest.com",
    "--header",
    "Authorization: Bearer ${AUTH_TOKEN}"
  ],
  "env": {
    "AUTH_TOKEN": "your token goes here"
  }
}
```

## B2B 企业产品（GTC 2026 披露）

AInvest 在 NVIDIA GTC 2026（Booth #187）展示了 6 个**企业级**产品：

| 产品 | 类型 | 说明 |
|------|------|------|
| **Financial Data API** | 数据 API | 上述 REST API，面向金融平台集成 |
| **Research Agent** | AI Agent | 研究代理，可嵌入第三方平台 |
| **Aime Copilot** | AI Copilot | 企业版 Aime，可集成到第三方金融应用 |
| **AI Digital Assistant** | AI Assistant | 通用 AI 数字助理 |
| **Custom Data Visualization** | 数据可视化 | 可定制的数据可视化组件 |
| **AI Fitting Mirror** | AI + AR | 与 **New Port AI** 合作的 AI 试穿镜（非金融场景） |

→ GTC Session: "Unified Architectures and Evaluation Frameworks for Financial AI Agents"（Session ID: S81729，2026-03-19）

## AI 研究基础设施（GTC 2026 发布）

AInvest 在 GTC 2026 同时发布了 4 个金融 AI 研究工具：

| 工具 | 说明 |
|------|------|
| **NEXUS-O** | 工业级 omni-modal 基础模型（text + audio + visual 同时处理）；实时跨模态分析（如监听 Fed speech + 对比历史 minutes + 发出 audio alert） |
| **GAGE** | 高速评估沙箱引擎（GPU/CPU 最大化利用 + Agent sandbox + game theory arena） |
| **BizFinBench** | 100K+ 双语（中英）金融 LLM 评测 benchmark（5 维度 9 任务）；含 **Iterajudge** 机制消除 AI 评 AI 偏差；arXiv 论文：`arxiv.org/abs/2505.19457` |
| **MME-Finance** | 视觉金融评测 benchmark（Candlestick / MACD / 数据表识别）；首个由 10+ 年金融从业者标注的视觉测试 |

## 命名硬规则

- **AInvest API**（公开 API 名）—— 不写 "Ainvest API" / "ainvest api"
- **MCP server**（协议名）—— 全大写 MCP
- **NEXUS-O** / **GAGE** / **BizFinBench** / **MME-Finance** —— 全大写 / 首字母大写
- **docs.ainvest.com** —— 开发者文档子域
- **openapi.ainvest.com** —— API 生产 endpoint
- **docsmcp.ainvest.com** —— MCP server endpoint
- **lighthorse.io** —— Light Horse Securities 独立站（不是 ainvest.com 子域）

## 不要做

- ❌ 不要把 AInvest API 当成"内部 API"—— 这是**公开的**开发者 API，有 free tier
- ❌ 不要把 MCP server 和 AIME engine 混淆—— MCP server 是 API 接入层，AIME 是底层 AI 引擎
- ❌ 不要假设所有 API endpoint 都免费—— free tier 有 rate limit，生产使用可能需要付费
- ❌ 不要在没有 API key 的情况下尝试调用 openapi.ainvest.com—— 需要在 Developer Center 注册
- ❌ 不要把 BizFinBench 和 MME-Finance 归功于 AInvest 独立完成—— BizFinBench 论文有学术合作者（HiThink Research）
- ❌ 不要假设 AI Fitting Mirror 是金融产品—— 它是与 New Port AI 合作的 AR/零售产品
