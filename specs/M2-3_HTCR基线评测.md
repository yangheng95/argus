# AimeCode M2-3 · HTCR 基线评测

> **自包含文档**：一个 AI 模型只读这一个文件，就能构建 HTCR（混合任务闭环率）评测体系。
> **前置条件**：M2-1（前后端对接）+ M2-2（API 密钥配置）已完成，Real 模式可走通。
> **包含**：HTCR 定义、100 条标注测试集（S01-S05 各 20 条）、自动评测脚本、判定规则、基线报告格式。
> **不包含**：人工标注工具、A/B 测试框架、在线监控。

---

## 1. 目标与验收标准

### 1.1 里程碑目标

建立 HTCR 基线指标，使 AimeCode 的质量可被量化、可回归、可持续追踪。M2 阶段目标 HTCR ≥ 55%。

### 1.2 验收标准

| # | 验收项 | 操作 | 预期结果 |
|---|---|---|---|
| V1 | 测试集完整 | 检查 `eval/test-set.json` | 100 条指令，S01-S05 各 20 条，每条有 `id`, `scenario`, `input`, `expectedTools`, `expectedOutputTypes` |
| V2 | 评测脚本运行 | `bun run eval/run-eval.ts` | 自动依次发送 100 条指令，收集结果，输出 JSON 报告 |
| V3 | 单条评测 | `bun run eval/run-eval.ts --id S01-001` | 只运行指定 ID 的测试 |
| V4 | 判定逻辑正确 | 检查通过/失败判定 | 符合 4 条判定规则（≤3 轮 + 工具正确 + 结构化输出 + 无占位符） |
| V5 | HTCR 计算 | 评测完成后 | 输出 `HTCR: XX% (通过数/有效总数)` |
| V6 | 分场景统计 | 评测报告 | 每个场景单独输出通过率 |
| V7 | 失败分析 | 评测报告 | 每条失败的测试输出失败原因分类 |
| V8 | 基线 ≥ 55% | 首次完整评测 | HTCR ≥ 55%，否则需要迭代修复 |

---

## 2. HTCR 定义

### 2.1 公式

```
HTCR = 通过测试数 / 有效测试总数 × 100%
```

**有效测试**：排除因数据源超时导致的失败（不计入分母）。

### 2.2 判定规则

一条测试通过当且仅当同时满足以下 4 条：

| 规则 | 判定方式 |
|---|---|
| **R1 · ≤ 3 轮完成** | 从用户首条消息到 `done` 事件，中间的 tool_start 循环 ≤ 3 次 |
| **R2 · 工具调用参数正确** | 场景要求调用的工具全部被调用，且参数 `ticker` / `fields` 与预期匹配 |
| **R3 · 输出含结构化内容** | SSE 流中至少包含一个 `chart_data`、`table_data` 或 `code_block` 事件（按场景要求） |
| **R4 · 无占位符** | 最终输出文本不包含 `YOUR_TICKER`、`TODO`、`placeholder`、`fill in`、`<your` 等标记 |

### 2.3 失败分类

| 编码 | 分类 | 描述 |
|---|---|---|
| F1 | 工具未调用 | 应该调用工具但 LLM 没有发起 tool_use |
| F2 | 工具参数错误 | 调用了工具但 ticker/fields/freq 不正确 |
| F3 | 轮次超标 | > 3 次 tool call 循环 |
| F4 | 缺少结构化输出 | 无 chart/table/code（场景要求有） |
| F5 | 含占位符 | 输出中有 TODO/YOUR_TICKER 等 |
| F6 | 数据源超时 | Tushare/AkShare API 返回超时（不计入分母） |
| F7 | LLM 拒绝 | Claude 拒绝回答（内容审核） |
| F8 | 流异常中断 | SSE 流在 done 之前断开 |

---

## 3. 测试集定义

文件路径：`eval/test-set.json`

```json
[
  {
    "id": "S01-001",
    "scenario": "S01",
    "input": "帮我画一下茅台过去三年ROE趋势",
    "expectedTools": [{"name": "get_financial_report", "ticker": "600519.SH", "fields": ["roe"]}],
    "expectedOutputTypes": ["chart_data", "text_delta"],
    "tags": ["单标的", "财报", "可视化"]
  },
  {
    "id": "S01-002",
    "scenario": "S01",
    "input": "查看五粮液近四个季度的毛利率变化",
    "expectedTools": [{"name": "get_financial_report", "ticker": "000858.SZ", "fields": ["gross_margin"]}],
    "expectedOutputTypes": ["chart_data", "table_data"],
    "tags": ["单标的", "财报"]
  },
  {
    "id": "S01-003",
    "scenario": "S01",
    "input": "贵州茅台2023年报ROE和净利率分别是多少",
    "expectedTools": [{"name": "get_financial_report", "ticker": "600519.SH", "fields": ["roe", "net_margin"]}],
    "expectedOutputTypes": ["text_delta"],
    "tags": ["单标的", "财报", "精确查询"]
  },
  {
    "id": "S01-004",
    "scenario": "S01",
    "input": "画一张招商银行ROE和净利率的双轴图",
    "expectedTools": [{"name": "get_financial_report", "ticker": "600036.SH", "fields": ["roe", "net_margin"]}],
    "expectedOutputTypes": ["chart_data", "code_block"],
    "tags": ["单标的", "多字段", "可视化"]
  },
  {
    "id": "S01-005",
    "scenario": "S01",
    "input": "分析一下海天味业过去两年的毛利率趋势，是否在下降",
    "expectedTools": [{"name": "get_financial_report", "ticker": "603288.SH", "fields": ["gross_margin"]}],
    "expectedOutputTypes": ["chart_data", "text_delta"],
    "tags": ["趋势分析"]
  },
  {
    "id": "S01-006", "scenario": "S01",
    "input": "中国平安最近5年的ROE变化情况",
    "expectedTools": [{"name": "get_financial_report", "ticker": "601318.SH", "fields": ["roe"]}],
    "expectedOutputTypes": ["chart_data"], "tags": ["长周期"]
  },
  {
    "id": "S01-007", "scenario": "S01",
    "input": "格力电器营收和净利润的季度趋势",
    "expectedTools": [{"name": "get_financial_report", "ticker": "000651.SZ", "fields": ["revenue", "net_profit"]}],
    "expectedOutputTypes": ["chart_data"], "tags": ["多字段"]
  },
  {
    "id": "S01-008", "scenario": "S01", "input": "隆基绿能PE走势", "expectedTools": [{"name": "get_financial_report", "ticker": "601012.SH", "fields": ["pe_ttm"]}], "expectedOutputTypes": ["chart_data"], "tags": ["估值"]
  },
  {
    "id": "S01-009", "scenario": "S01", "input": "恒瑞医药2021-2024每年的研发费用率", "expectedTools": [{"name": "get_financial_report", "ticker": "600276.SH"}], "expectedOutputTypes": ["table_data"], "tags": ["特殊字段"]
  },
  {
    "id": "S01-010", "scenario": "S01", "input": "伊利股份最近八个季度的EPS", "expectedTools": [{"name": "get_financial_report", "ticker": "600887.SH", "fields": ["eps"]}], "expectedOutputTypes": ["chart_data"], "tags": ["EPS"]
  },
  {
    "id": "S01-011", "scenario": "S01", "input": "帮我看看片仔癀的ROE是不是真的很高", "expectedTools": [{"name": "get_financial_report", "ticker": "600436.SH", "fields": ["roe"]}], "expectedOutputTypes": ["text_delta"], "tags": ["口语化"]
  },
  {
    "id": "S01-012", "scenario": "S01", "input": "万科毛利率和净利率的差距有多大", "expectedTools": [{"name": "get_financial_report", "ticker": "000002.SZ", "fields": ["gross_margin", "net_margin"]}], "expectedOutputTypes": ["chart_data"], "tags": ["对比"]
  },
  {
    "id": "S01-013", "scenario": "S01", "input": "药明康德近两年每季度收入是多少", "expectedTools": [{"name": "get_financial_report", "ticker": "603259.SH", "fields": ["revenue"]}], "expectedOutputTypes": ["table_data"], "tags": ["绝对值"]
  },
  {
    "id": "S01-014", "scenario": "S01", "input": "建设银行PB历史分位", "expectedTools": [{"name": "get_financial_report", "ticker": "601939.SH", "fields": ["pb"]}], "expectedOutputTypes": ["chart_data"], "tags": ["估值"]
  },
  {
    "id": "S01-015", "scenario": "S01", "input": "长江电力的分红率和ROE", "expectedTools": [{"name": "get_financial_report", "ticker": "600900.SH", "fields": ["roe"]}], "expectedOutputTypes": ["text_delta"], "tags": ["高股息"]
  },
  {
    "id": "S01-016", "scenario": "S01", "input": "美的集团和海尔智家谁的营收增长更快", "expectedTools": [{"name": "get_financial_report", "ticker": "000333.SZ"}, {"name": "get_financial_report", "ticker": "600690.SH"}], "expectedOutputTypes": ["chart_data"], "tags": ["双标的"]
  },
  {
    "id": "S01-017", "scenario": "S01", "input": "中芯国际最近三个季度的毛利率", "expectedTools": [{"name": "get_financial_report", "ticker": "688981.SH", "fields": ["gross_margin"]}], "expectedOutputTypes": ["table_data"], "tags": ["科创板"]
  },
  {
    "id": "S01-018", "scenario": "S01", "input": "天齐锂业ROE为什么这两年波动这么大", "expectedTools": [{"name": "get_financial_report", "ticker": "002466.SZ", "fields": ["roe"]}], "expectedOutputTypes": ["chart_data", "text_delta"], "tags": ["分析型"]
  },
  {
    "id": "S01-019", "scenario": "S01", "input": "中信证券的营收规模有多大", "expectedTools": [{"name": "get_financial_report", "ticker": "600030.SH", "fields": ["revenue"]}], "expectedOutputTypes": ["text_delta"], "tags": ["简单查询"]
  },
  {
    "id": "S01-020", "scenario": "S01", "input": "山西汾酒和洋河股份的净利率对比", "expectedTools": [{"name": "get_financial_report", "ticker": "600809.SH"}, {"name": "get_financial_report", "ticker": "002304.SZ"}], "expectedOutputTypes": ["chart_data", "table_data"], "tags": ["双标的对比"]
  },

  {"id": "S02-001", "scenario": "S02", "input": "我的动量因子IC只有0.01，帮我看看代码有什么问题：\ndef momentum(df, n=20):\n    return df['close'].pct_change(n)", "expectedTools": [], "expectedOutputTypes": ["text_delta", "code_block"], "tags": ["因子调试"]},
  {"id": "S02-002", "scenario": "S02", "input": "这段因子代码有没有未来信息泄露：\ndf['signal'] = df['close'].rolling(10).mean()\ndf['ret'] = df['close'].pct_change()\nic = df['signal'].corr(df['ret'])", "expectedTools": [], "expectedOutputTypes": ["text_delta", "code_block"], "tags": ["look-ahead"]},
  {"id": "S02-003", "scenario": "S02", "input": "我的反转因子在回测里表现很好但实盘亏钱，可能是什么原因", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["过拟合"]},
  {"id": "S02-004", "scenario": "S02", "input": "帮我写一个消除行业暴露的因子中性化函数", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["代码生成"]},
  {"id": "S02-005", "scenario": "S02", "input": "IC衰减太快怎么办，从0.05第二天就衰减到0.01了", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["因子衰减"]},
  {"id": "S02-006", "scenario": "S02", "input": "写一个计算因子IC和IR的函数，要处理截面数据", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["工具函数"]},
  {"id": "S02-007", "scenario": "S02", "input": "我的alpha因子和市值因子的相关性太高，怎么正交化", "expectedTools": [], "expectedOutputTypes": ["text_delta", "code_block"], "tags": ["因子正交"]},
  {"id": "S02-008", "scenario": "S02", "input": "帮我检查这段止损逻辑有没有bug：\nif current_price < buy_price * 0.95:\n    sell(ticker, current_price)", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["代码审查"]},
  {"id": "S02-009", "scenario": "S02", "input": "用Fama-French三因子模型做归因分析的代码", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["归因"]},
  {"id": "S02-010", "scenario": "S02", "input": "我的换手率因子在小市值股票上IC特别高，这正常吗", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["因子分析"]},
  {"id": "S02-011", "scenario": "S02", "input": "写一个分层回测函数，把股票按因子值分成5组", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["分层回测"]},
  {"id": "S02-012", "scenario": "S02", "input": "ICIR小于0.5的因子还值得用吗", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["因子评估"]},
  {"id": "S02-013", "scenario": "S02", "input": "帮我把这个因子从日频改成周频\ndef daily_factor(df):\n    return df['volume'].rolling(5).mean() / df['volume'].rolling(20).mean()", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["频率转换"]},
  {"id": "S02-014", "scenario": "S02", "input": "存活偏差对我的回测结果影响有多大，怎么消除", "expectedTools": [], "expectedOutputTypes": ["text_delta", "code_block"], "tags": ["存活偏差"]},
  {"id": "S02-015", "scenario": "S02", "input": "写一个winsorize函数处理因子异常值", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["数据处理"]},
  {"id": "S02-016", "scenario": "S02", "input": "我的因子在2020年之前很好但之后失效了，什么原因", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["因子失效"]},
  {"id": "S02-017", "scenario": "S02", "input": "帮我计算这个组合的最大回撤和Sharpe Ratio", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["绩效指标"]},
  {"id": "S02-018", "scenario": "S02", "input": "多因子合成用等权好还是IC加权好", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["因子合成"]},
  {"id": "S02-019", "scenario": "S02", "input": "写一个避免前视偏差的时间序列交叉验证", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["交叉验证"]},
  {"id": "S02-020", "scenario": "S02", "input": "行业中性化和市值中性化应该先做哪个", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["因子处理顺序"]},

  {"id": "S03-001", "scenario": "S03", "input": "最近30个交易日沪深300成分股平均换手率，封装成函数", "expectedTools": [{"name": "get_index_components"}, {"name": "get_market_data"}], "expectedOutputTypes": ["chart_data", "code_block"], "tags": ["封装"]},
  {"id": "S03-002", "scenario": "S03", "input": "查一下茅台最近半年的日线数据", "expectedTools": [{"name": "get_market_data", "ticker": "600519.SH"}], "expectedOutputTypes": ["chart_data"], "tags": ["行情查询"]},
  {"id": "S03-003", "scenario": "S03", "input": "帮我封装一个获取A股行业ETF日收益率的函数", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["封装"]},
  {"id": "S03-004", "scenario": "S03", "input": "沪深300和中证500最近一年的走势对比", "expectedTools": [{"name": "get_market_data", "ticker": "000300.SH"}, {"name": "get_market_data", "ticker": "000905.SH"}], "expectedOutputTypes": ["chart_data"], "tags": ["指数对比"]},
  {"id": "S03-005", "scenario": "S03", "input": "写一个函数计算任意股票的N日收益率和波动率", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["工具函数"]},
  {"id": "S03-006", "scenario": "S03", "input": "茅台上个月的K线图", "expectedTools": [{"name": "get_market_data", "ticker": "600519.SH"}], "expectedOutputTypes": ["chart_data"], "tags": ["K线"]},
  {"id": "S03-007", "scenario": "S03", "input": "帮我拉取宁德时代2023年全年的日线数据并计算20日均线", "expectedTools": [{"name": "get_market_data", "ticker": "300750.SZ"}], "expectedOutputTypes": ["chart_data", "code_block"], "tags": ["技术指标"]},
  {"id": "S03-008", "scenario": "S03", "input": "中证1000今年的涨跌幅是多少", "expectedTools": [{"name": "get_market_data", "ticker": "000852.SH"}], "expectedOutputTypes": ["text_delta"], "tags": ["简单查询"]},
  {"id": "S03-009", "scenario": "S03", "input": "比亚迪和特斯拉...不对，比亚迪最近三个月的成交量趋势", "expectedTools": [{"name": "get_market_data", "ticker": "002594.SZ"}], "expectedOutputTypes": ["chart_data"], "tags": ["成交量"]},
  {"id": "S03-010", "scenario": "S03", "input": "封装一个获取指数成分股并计算等权收益率的函数", "expectedTools": [{"name": "get_index_components"}], "expectedOutputTypes": ["code_block"], "tags": ["封装"]},
  {"id": "S03-011", "scenario": "S03", "input": "上证50的成分股有哪些", "expectedTools": [{"name": "get_index_components", "indexCode": "000016.SH"}], "expectedOutputTypes": ["table_data"], "tags": ["成分股"]},
  {"id": "S03-012", "scenario": "S03", "input": "写一个计算股票间相关性矩阵的函数", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["相关性"]},
  {"id": "S03-013", "scenario": "S03", "input": "查沪深300最近一个月每天的涨跌幅", "expectedTools": [{"name": "get_market_data", "ticker": "000300.SH"}], "expectedOutputTypes": ["table_data"], "tags": ["涨跌幅"]},
  {"id": "S03-014", "scenario": "S03", "input": "帮我找出沪深300中权重最大的10只股票", "expectedTools": [{"name": "get_index_components", "indexCode": "000300.SH"}], "expectedOutputTypes": ["table_data"], "tags": ["Top N"]},
  {"id": "S03-015", "scenario": "S03", "input": "中国神华2024年日线数据的最高价和最低价分别是多少", "expectedTools": [{"name": "get_market_data", "ticker": "601088.SH"}], "expectedOutputTypes": ["text_delta"], "tags": ["极值"]},
  {"id": "S03-016", "scenario": "S03", "input": "封装一个判断是否涨停/跌停的函数", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["封装"]},
  {"id": "S03-017", "scenario": "S03", "input": "画一张北方华创的周K线图", "expectedTools": [{"name": "get_market_data", "ticker": "002371.SZ"}], "expectedOutputTypes": ["chart_data"], "tags": ["周线"]},
  {"id": "S03-018", "scenario": "S03", "input": "立讯精密和海康威视的月线走势", "expectedTools": [{"name": "get_market_data"}, {"name": "get_market_data"}], "expectedOutputTypes": ["chart_data"], "tags": ["双标的月线"]},
  {"id": "S03-019", "scenario": "S03", "input": "帮我写一个计算VWAP的函数", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["VWAP"]},
  {"id": "S03-020", "scenario": "S03", "input": "沪深300里面新能源相关的成分股有哪些", "expectedTools": [{"name": "get_index_components"}], "expectedOutputTypes": ["table_data"], "tags": ["筛选"]},

  {"id": "S04-001", "scenario": "S04", "input": "用2015年股灾数据跑当前组合最大回撤", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data", "code_block"], "tags": ["压力测试"]},
  {"id": "S04-002", "scenario": "S04", "input": "如果2018年的贸易战重演，一个满仓茅台的组合会亏多少", "expectedTools": [{"name": "get_market_data", "ticker": "600519.SH"}], "expectedOutputTypes": ["chart_data", "text_delta"], "tags": ["情景分析"]},
  {"id": "S04-003", "scenario": "S04", "input": "计算等权持有茅台五粮液泸州老窖的2020年最大回撤", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data", "code_block"], "tags": ["组合回撤"]},
  {"id": "S04-004", "scenario": "S04", "input": "用蒙特卡洛模拟估算这个组合未来一年的VaR(95%)", "expectedTools": [], "expectedOutputTypes": ["code_block", "text_delta"], "tags": ["VaR"]},
  {"id": "S04-005", "scenario": "S04", "input": "回测一个简单的双均线策略在上证综指上的表现", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data", "code_block"], "tags": ["策略回测"]},
  {"id": "S04-006", "scenario": "S04", "input": "2022年新能源板块回调时宁德时代回撤了多少", "expectedTools": [{"name": "get_market_data", "ticker": "300750.SZ"}], "expectedOutputTypes": ["chart_data", "text_delta"], "tags": ["历史回撤"]},
  {"id": "S04-007", "scenario": "S04", "input": "写一个计算组合夏普比率、最大回撤、卡玛比率的函数", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["绩效函数"]},
  {"id": "S04-008", "scenario": "S04", "input": "对比2015年和2018年股灾中银行股的表现", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data", "table_data"], "tags": ["历史对比"]},
  {"id": "S04-009", "scenario": "S04", "input": "假设组合持有60%股票40%债券，极端情况下最大亏损是多少", "expectedTools": [], "expectedOutputTypes": ["text_delta", "code_block"], "tags": ["资产配置"]},
  {"id": "S04-010", "scenario": "S04", "input": "沪深300过去十年每年的最大回撤分别是多少", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["table_data", "chart_data"], "tags": ["年度回撤"]},
  {"id": "S04-011", "scenario": "S04", "input": "写一个event study函数，分析某事件前后N天的超额收益", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["事件研究"]},
  {"id": "S04-012", "scenario": "S04", "input": "茅台在2020年3月疫情暴跌时最低跌到多少", "expectedTools": [{"name": "get_market_data", "ticker": "600519.SH"}], "expectedOutputTypes": ["text_delta", "chart_data"], "tags": ["历史查询"]},
  {"id": "S04-013", "scenario": "S04", "input": "计算一个简单趋势跟踪策略的回测曲线", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data", "code_block"], "tags": ["趋势策略"]},
  {"id": "S04-014", "scenario": "S04", "input": "做一个滚动波动率图，看看最近两年市场波动变化", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data", "code_block"], "tags": ["波动率"]},
  {"id": "S04-015", "scenario": "S04", "input": "如果突然加息100个基点，银行股大概会怎么反应", "expectedTools": [], "expectedOutputTypes": ["text_delta"], "tags": ["宏观情景"]},
  {"id": "S04-016", "scenario": "S04", "input": "帮我写一个历史情景压力测试框架", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["框架"]},
  {"id": "S04-017", "scenario": "S04", "input": "计算等权持有工行建行农行中行的年化收益率和夏普", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["text_delta", "code_block"], "tags": ["银行组合"]},
  {"id": "S04-018", "scenario": "S04", "input": "2021年教培双减对教育股的冲击，用海量数据回测一下", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data"], "tags": ["事件冲击"]},
  {"id": "S04-019", "scenario": "S04", "input": "写一个bootstrap方法计算收益率的置信区间", "expectedTools": [], "expectedOutputTypes": ["code_block"], "tags": ["统计方法"]},
  {"id": "S04-020", "scenario": "S04", "input": "对比A股和港股在2022年全年的回撤走势", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data"], "tags": ["跨市场"]},

  {"id": "S05-001", "scenario": "S05", "input": "比较宁德时代、比亚迪、亿纬锂能的营收增速、毛利率和PE", "expectedTools": [{"name": "get_financial_report", "ticker": "300750.SZ"}, {"name": "get_financial_report", "ticker": "002594.SZ"}, {"name": "get_financial_report", "ticker": "300014.SZ"}], "expectedOutputTypes": ["chart_data", "table_data"], "tags": ["三标的对比"]},
  {"id": "S05-002", "scenario": "S05", "input": "茅台五粮液泸州老窖的ROE和PE谁性价比更高", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["chart_data", "table_data", "text_delta"], "tags": ["白酒对比"]},
  {"id": "S05-003", "scenario": "S05", "input": "四大行的净利率和ROE对比", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["table_data", "chart_data"], "tags": ["银行对比"]},
  {"id": "S05-004", "scenario": "S05", "input": "对比格力美的海尔的营收规模", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["chart_data"], "tags": ["家电对比"]},
  {"id": "S05-005", "scenario": "S05", "input": "半导体三巨头中芯国际、韦尔股份、北方华创的毛利率对比", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["chart_data", "table_data"], "tags": ["半导体"]},
  {"id": "S05-006", "scenario": "S05", "input": "平安人寿太保的ROE和PB比较", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["table_data"], "tags": ["保险"]},
  {"id": "S05-007", "scenario": "S05", "input": "茅台和五粮液最近一年的股价走势对比", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data"], "tags": ["股价对比"]},
  {"id": "S05-008", "scenario": "S05", "input": "宁德时代和比亚迪的市值变化趋势", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data"], "tags": ["市值"]},
  {"id": "S05-009", "scenario": "S05", "input": "中信证券和海通证券的业绩对比", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["table_data"], "tags": ["券商"]},
  {"id": "S05-010", "scenario": "S05", "input": "对比隆基阳光电源天齐锂业赣锋锂业四家公司的基本面", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["table_data", "chart_data"], "tags": ["四标的"]},
  {"id": "S05-011", "scenario": "S05", "input": "药明康德和恒瑞医药谁的盈利能力更强", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["table_data", "text_delta"], "tags": ["医药"]},
  {"id": "S05-012", "scenario": "S05", "input": "招行兴业民生三家银行的净息差和不良率对比", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["table_data"], "tags": ["银行深度"]},
  {"id": "S05-013", "scenario": "S05", "input": "万科保利的毛利率变化趋势对比", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["chart_data"], "tags": ["地产"]},
  {"id": "S05-014", "scenario": "S05", "input": "用雷达图展示茅台五粮液泸州老窖的多维度指标", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["chart_data", "code_block"], "tags": ["雷达图"]},
  {"id": "S05-015", "scenario": "S05", "input": "对比沪深300中证500中证1000三个指数今年的表现", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["chart_data", "table_data"], "tags": ["指数对比"]},
  {"id": "S05-016", "scenario": "S05", "input": "新能源车三杰最近半年的涨跌幅排名", "expectedTools": [{"name": "get_market_data"}], "expectedOutputTypes": ["table_data"], "tags": ["涨跌排名"]},
  {"id": "S05-017", "scenario": "S05", "input": "消费电子三巨头立讯精密、海康威视、歌尔股份的营收对比", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["chart_data"], "tags": ["消费电子"]},
  {"id": "S05-018", "scenario": "S05", "input": "中国石油和中国石化谁更赚钱", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["table_data", "text_delta"], "tags": ["能源"]},
  {"id": "S05-019", "scenario": "S05", "input": "做一个五粮液茅台泸州老窖的估值对比表", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["table_data"], "tags": ["估值表"]},
  {"id": "S05-020", "scenario": "S05", "input": "腾讯阿里百度京东这四家的营收增速对比", "expectedTools": [{"name": "get_financial_report"}], "expectedOutputTypes": ["chart_data", "table_data"], "tags": ["互联网"]}
]
```

---

## 4. 评测脚本骨架

文件路径：`eval/run-eval.ts`

```typescript
// 评测脚本 — 自动运行测试集并生成报告
// 用法：
//   bun run eval/run-eval.ts                  # 运行全部
//   bun run eval/run-eval.ts --id S01-001     # 运行单条
//   bun run eval/run-eval.ts --scenario S01   # 运行某场景

import testSet from './test-set.json'

const API_BASE = process.env.API_BASE || 'http://localhost:3001'
const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN || ''

interface TestResult {
  id: string
  scenario: string
  input: string
  passed: boolean
  failureCode?: string
  failureReason?: string
  toolsCalled: string[]
  outputTypes: string[]
  rounds: number
  durationMs: number
}

async function runSingleTest(test: typeof testSet[0]): Promise<TestResult> {
  const start = performance.now()

  // 1. 创建会话
  const sessionRes = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' })
  const session = await sessionRes.json()

  // 2. 发送消息并收集 SSE 流
  const chatRes = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}:${TUSHARE_TOKEN}`,
    },
    body: JSON.stringify({ sessionId: session.id, message: test.input }),
  })

  const events: any[] = []
  // ... SSE 解析（同 sse-parser.ts 逻辑）...

  const durationMs = Math.round(performance.now() - start)

  // 3. 分析结果
  const toolsCalled = events.filter(e => e.type === 'tool_start').map(e => e.tool)
  const outputTypes = [...new Set(events.map(e => e.type))]
  const rounds = events.filter(e => e.type === 'tool_start').length
  const fullText = events.filter(e => e.type === 'text_delta').map(e => e.delta).join('')

  // 4. 判定
  const r1 = rounds <= 3
  const r2 = checkToolsCalled(toolsCalled, test.expectedTools)
  const r3 = checkOutputTypes(outputTypes, test.expectedOutputTypes)
  const r4 = !hasPlaceholders(fullText)

  let failureCode: string | undefined
  let failureReason: string | undefined

  if (!r1) { failureCode = 'F3'; failureReason = `轮次超标: ${rounds} > 3` }
  else if (!r2) { failureCode = 'F2'; failureReason = '工具调用不匹配' }
  else if (!r3) { failureCode = 'F4'; failureReason = '缺少结构化输出' }
  else if (!r4) { failureCode = 'F5'; failureReason = '含占位符' }

  return {
    id: test.id,
    scenario: test.scenario,
    input: test.input,
    passed: r1 && r2 && r3 && r4,
    failureCode,
    failureReason,
    toolsCalled,
    outputTypes,
    rounds,
    durationMs,
  }
}

function checkToolsCalled(actual: string[], expected: any[]): boolean {
  // 检查每个 expected tool 是否被调用
  for (const exp of expected) {
    if (!actual.includes(exp.name)) return false
  }
  return true
}

function checkOutputTypes(actual: string[], expected: string[]): boolean {
  for (const exp of expected) {
    if (!actual.includes(exp)) return false
  }
  return true
}

function hasPlaceholders(text: string): boolean {
  const patterns = [/YOUR_TICKER/i, /TODO/i, /placeholder/i, /fill\s+in/i, /<your/i, /FIXME/i]
  return patterns.some(p => p.test(text))
}

// 主入口
async function main() {
  const args = process.argv.slice(2)
  let tests = testSet

  if (args.includes('--id')) {
    const id = args[args.indexOf('--id') + 1]
    tests = tests.filter(t => t.id === id)
  } else if (args.includes('--scenario')) {
    const scenario = args[args.indexOf('--scenario') + 1]
    tests = tests.filter(t => t.scenario === scenario)
  }

  console.log(`Running ${tests.length} tests...\n`)

  const results: TestResult[] = []
  for (const test of tests) {
    console.log(`[${test.id}] ${test.input.slice(0, 40)}...`)
    const result = await runSingleTest(test)
    results.push(result)
    console.log(`  → ${result.passed ? '✓ PASS' : `✗ FAIL (${result.failureCode})`} (${result.durationMs}ms)`)
  }

  // 汇总
  const passed = results.filter(r => r.passed).length
  const total = results.length
  const htcr = (passed / total * 100).toFixed(1)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`HTCR: ${htcr}% (${passed}/${total})`)
  console.log(`${'='.repeat(50)}`)

  // 分场景统计
  for (const scenario of ['S01', 'S02', 'S03', 'S04', 'S05']) {
    const scenarioResults = results.filter(r => r.scenario === scenario)
    const scenarioPassed = scenarioResults.filter(r => r.passed).length
    console.log(`  ${scenario}: ${scenarioPassed}/${scenarioResults.length} (${(scenarioPassed / scenarioResults.length * 100).toFixed(0)}%)`)
  }

  // 失败分析
  const failures = results.filter(r => !r.passed)
  if (failures.length > 0) {
    console.log(`\nFailures:`)
    for (const f of failures) {
      console.log(`  ${f.id}: ${f.failureCode} — ${f.failureReason}`)
    }
  }

  // 写入报告
  const report = {
    timestamp: new Date().toISOString(),
    htcr: Number(htcr),
    total,
    passed,
    results,
  }
  await Bun.write('eval/report.json', JSON.stringify(report, null, 2))
  console.log(`\nReport written to eval/report.json`)
}

main()
```

---

## 5. 集成陷阱

| # | 问题 | 解决方案 |
|---|---|---|
| T1 | Tushare 限频导致批量测试超时 | 串行运行，每条间隔 2s；超时的标记为 F6 不计入分母 |
| T2 | LLM 输出非确定性 | 每条测试运行 1 次（不是平均多次），HTCR 是整体统计量 |
| T3 | 测试集不公开给研发 | `eval/test-set.json` 不在 src/ 下，不参与前端 build |
| T4 | Claude 可能拒绝回答某些金融问题 | F7（LLM 拒绝）不计入分母 |
| T5 | 工具参数匹配宽松 | 只检查 tool name 和 ticker，不检查 fields 顺序 |
