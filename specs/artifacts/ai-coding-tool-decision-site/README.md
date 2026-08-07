# AI 编程工具采购决策网站（Phase 02）

可本地运行的参数化 AI 编程工具采购决策网站。调整**团队人数、使用强度、成本权重、安全权重、任务效果权重**（及官方可换算超额单位的消耗量）后，实时重算各工具的年度成本、综合评分与推荐排序。

全部价格/额度/政策数据**只来自 Phase 01 官方复核成果**（imported `ai-coding-tools-selection-data.json`，12 个官方 source_urls 于 2026-08-02 复核一致）。本网站**不新增任何价格/政策估计**；`NO_CONVERSION` / `PARTIAL` / `NOT_TESTED` / `NOT-COMPARABLE` / `ASSUMED` 标记原样展示。

## 运行命令与打开地址

技术栈：Vite 6.4.3 + SolidJS 1.9.14 + Tailwind CSS 4.1.11 + ECharts 6.1.0（依赖经 bun install 本地安装，构建产物 `dist/` 已提交，**离线可用，无运行时 CDN**）。

```bash
# 方式一：构建 + 预览（推荐）
bun install        # 首次安装依赖（npm registry 为 npmmirror 国内镜像）
bun run build      # 构建到 dist/
bun run preview    # 启动本地预览（默认 http://127.0.0.1:4178/）
# 打开浏览器访问 http://127.0.0.1:4178/

# 方式二：直接托管 dist/（任意静态服务）
python3 -m http.server 8080 --directory dist
# 或 node 静态服务后访问 http://127.0.0.1:8080/

# 方式三：开发模式
bun run dev        # http://127.0.0.1:5178/
```

> `vite.config.ts` 中 `base: "./"` 相对路径，`dist/` 可被任意本地静态服务托管。

## 参数说明

| 参数                     | 取值范围                             | 说明                                                                                             |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 团队人数 N               | 10 / 30 / 100 预设，或自由输入正整数 | 非法输入（非正整数）给出「N 必须为正整数」校验提示，成本列不展示数值                             |
| 使用强度                 | LIGHT / STANDARD / HEAVY             | **ASSUMED（章程 §3.1，非官方口径）**：LIGHT≈10M-30M tokens/月/人、STANDARD≈30M-100M、HEAVY≈100M+ |
| 成本权重                 | 0-100%                               | 对年度总成本重视程度                                                                             |
| 安全权重                 | 0-100%                               | 对安全/数据政策重视程度                                                                          |
| 任务效果权重             | 0-100%                               | 对实测质量重视程度                                                                               |
| JetBrains credits/月/人  | 正整数（默认 70=额度内）             | 超额 = max(0, 消耗−70)×$1；1 credit=$1（官方）；消耗量为用户输入（ASSUMED）                      |
| Amazon Q LOC/月/人       | 正整数（默认 4000=额度内）           | 超额 = max(0, LOC−4000)×$0.003（官方）；agentic 超额 NO_CONVERSION                               |
| Tabnine provider $/月/人 | ≥0（默认 0=own-LLM）                 | Tabnine LLM 模式超额 = provider 价格+5%（官方公式）；own-LLM 无超额                              |

权重归一化：`W_k = w_k / (w_cost + w_security + w_task)`；三者全为 0 时按等权 1/3（页面实时显示归一化后权重）。

## 计算口径

### 年度成本

```
席位成本(USD/年) = 官方单价 × 12 × N
Windsurf 特殊公式 = 480×N + 960（平台费 $80/mo×12）
```

- 单价原文与 `per_seat_annual_usd`（=官方单价×12，Phase 01 DQ-1 已重算验证）取自 `cost_model.per_tool_seat_cost` 8 行。
- **超额成本仅按官方可换算单位计算**：
  - Cursor：`$0.25/MTok`（Teams+，官方）；用量取强度档 ASSUMED token 区间，**闭区间取中点、开区间取下限**（LIGHT 20M / STANDARD 65M / HEAVY 100M MTok/月/人），公式 `用量×$0.25×12×N`，标 ASSUMED（未计 credits 抵扣）。
  - JetBrains：`1 credit=$1`（官方）；`超额 = max(0, 消耗credits−70)×$1×12×N`（消耗量为用户输入，ASSUMED）。
  - Amazon Q：`$0.003/LOC`（官方，beyond 4K LOC pool）；`超额 = max(0, LOC−4000)×$0.003×12×N`（用户输入）；agentic requests 超额单价未公开 → **NO_CONVERSION**。
  - Tabnine：own-LLM 无超额；Tabnine LLM 超额 = `provider 价格+5%`（官方公式，provider 成本为用户输入）。
- **NO_CONVERSION**（Copilot Business / Claude 订阅档 / OpenAI Codex / Windsurf）：显示「**不可换算（官方无公开换算依据）**」，禁止估计；年度总成本仅计席位部分并标注「未含超额」。
- Enterprise 档价格多为 PARTIAL/custom，未纳入本模型（limitations.L2）。

### 综合评分（公式在页面可见）

```
成本得分 = 100 × (总成本max − 总成本i) / (总成本max − 总成本min)   # 当前 N/强度档下 8 个可比工具 min-max；max=min → 全 100
安全得分 = 100 × Σ(维度权重 × 指示值) / Σ(维度权重)              # 7 维 checklist；指示 1=官方明确支持 / 0.5=PARTIAL·部分披露 / 0=未披露
任务效果得分 = 100 × mean_quality / 5                            # 官方 1-5 尺度；claude=100、codex=86.6
综合评分 = W_cost×成本得分 + W_security×安全得分 + W_task×任务效果得分
```

- **NOT_TESTED / 无实测工具**（Copilot/Cursor/Aider 及无基准的 Windsurf/JetBrains/Amazon Q/Tabnine）：任务效果维度不可评分，综合评分去掉该维度，对剩余权重在各自和上**重归一化**，并显示「未实测（NOT_TESTED）：评分不含任务效果维度」徽标；禁止为未实测工具伪造任务效果分。
- **Cline/Aider（NOT-COMPARABLE）**：无官方企业定价/政策，按章程 §3.3 排除主矩阵，不进入成本模型与评分（单独显示排除原因）。
- 排序：综合评分降序，TOP 名次高亮；R1-R6 推荐徽标映射到对应工具（R1=组合首选 Copilot+Claude Code、R2=预算替代 Codex/Amazon Q、R3=IDE 原生 Cursor、R4=生态替代 JetBrains/Amazon Q、R5=排除/谨慎 Cline-Aider/Windsurf、R6=全局复核约束）。

## 数据新鲜度

- **访问日期快照**：2026-08-01（全部价格/额度/政策，工具级 `access_date` 与 `cost_model.access_date`）。
- **复核日期**：2026-08-02（全部 12 个官方 source_urls 复核一致，0 变更 / 0 未确认；见 `ai-coding-tools-selection-review-2026-08-02.md`）。
- **STALE 规则**（limitations.L1 原文）：价格/额度/政策为 2026-08-01 快照，属动态事实；交付超 14 天需标 **STALE**，采购前须复核。
- 站点运行时动态判定：`当前日期 − 2026-08-01 > 14 天 → 显示 STALE 徽标并提示复核`（`src/lib/freshness.ts`，非静态文案）。构建当日（2026-08-02）在新鲜期内。
- 正式采购须以厂商官方页复核为准；Enterprise 档需厂商报价后重算成本模型（R6）。

## 标记位语义

| 标记           | 含义                                                     | 出现位置                                                               |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| NOT_TESTED     | 未实测（本机 CLI 不可用），Agent 能力/质量仅官方文档支撑 | benchmarks.not_tested（copilot/aider/cursor）                          |
| NOT-COMPARABLE | 无官方企业定价/政策，按章程 §3.3 排除主矩阵              | tools[cline-aider].comparability                                       |
| PARTIAL        | 官方存在但信息不完整/页面失效                            | Enterprise 档价格、Windsurf 数据政策、JetBrains 认证细节               |
| NO_CONVERSION  | 不可换算（官方无公开换算依据），禁止估计                 | Copilot/Claude 订阅档/Codex/Windsurf/Amazon Q agentic 超额             |
| ASSUMED        | 强度档用量假设（章程 §3.1），非官方口径                  | intensity_tier_assumptions、Cursor/JetBrains/Amazon Q/Tabnine 超额用量 |
| STALE          | 数据超 14 天未复核（limitations.L1）                     | 运行时按当前日期动态判定                                               |

## 数据来源

- `data/site-data.json`：派生自 Phase 01 imported `specs/artifacts/ai-coding-tools-selection-data.json`（sha256 `b3d379e3c17666d10b4b1d72216c1c33540ffdd7d77fb0e014011d2cf3cd17b6`）。派生规则=仅字段选择与结构重塑，官方原文字符串逐字保留，不新增/修改任何数值；provenance 块见文件头。
- 配套文件：`specs/artifacts/ai-coding-tools-selection-report.md`（六章报告）、`ai-coding-tools-selection-review-2026-08-02.md`（复核记录）。
- 站点运行时只读取 `data/site-data.json` 单一数据源。

## 目录结构

```
specs/artifacts/ai-coding-tool-decision-site/
├── index.html / vite.config.ts / package.json / tsconfig.json
├── src/
│   ├── main.tsx / App.tsx / index.css
│   ├── data/site-data.json          # 派生数据（provenance 见文件头）
│   ├── lib/cost.ts                  # 成本引擎（席位/超额/年度总成本，纯函数）
│   ├── lib/scoring.ts               # 评分引擎（min-max/安全 checklist/权重归一化，纯函数）
│   ├── lib/freshness.ts             # STALE 动态判定
│   └── components/                  # ParamPanel/ComparisonMatrix/CostModel/ScoreRanking/Recommendations/DataFreshness/EChart/MarkerBadge
├── dist/                            # 构建产物（离线可用）
├── screenshots/                     # 视觉验收截图（01-10）
└── README.md
```

## 视觉验收说明

- 验收方式：`bun run build` → `bun run preview`（127.0.0.1:4178）→ Node + Playwright 真实页面截图到 `screenshots/` → 人工逐区块复核（参数联动、标记位、公式、无溢出/错位/未渲染）。
- 三组参数手工核对（详见 development-report）：N=10 STANDARD、N=30 LIGHT、N=100 HEAVY+超额输入，席位/超额/评分与独立数学计算一致。
- 本任务禁止 UI 自动化测试：验收过程不落测试文件/fixture/baseline/断言脚本，截图仅作为当次人工复核证据。
