构建一个全功能的模拟股票交易系统，支持用户注册、模拟资金账户、实时行情展示、下单交易（买入/卖出）、持仓管理、交易历史查询和收益分析。系统采用前后端分离架构。

Bun 运行时和 bun:test 已可用，项目脚手架已就绪。不要创建 README 文件。

## 技术选型

后端：
- 框架：Hono（轻量、类型安全）
- ORM：Drizzle ORM + better-sqlite3
- 认证：JWT (jose)
- 校验：Zod
- 实时：WebSocket (Hono)

前端：
- 框架：React 19 + Vite 6
- 状态管理：Zustand
- UI 组件：Ant Design 5
- 图表：ECharts (echarts-for-react) — K线、分时图
- 路由：React Router 7
- CSS：Tailwind CSS 4

Only create or modify these files:
- package.json
- tsconfig.json
- server/index.ts
- server/app.ts
- server/db/schema.ts
- server/db/migrate.ts
- server/db/seed.ts
- server/routes/auth.ts
- server/routes/quotes.ts
- server/routes/orders.ts
- server/routes/positions.ts
- server/routes/trades.ts
- server/routes/account.ts
- server/engine/market.ts
- server/engine/matching.ts
- server/engine/risk.ts
- server/middleware/auth.ts
- server/ws/quotes.ts
- server/test/engine.test.ts
- web/index.html
- web/vite.config.ts
- web/tailwind.config.ts
- web/tsconfig.json
- web/src/main.tsx
- web/src/App.tsx
- web/src/api/client.ts
- web/src/stores/auth.ts
- web/src/stores/quotes.ts
- web/src/stores/orders.ts
- web/src/stores/account.ts
- web/src/pages/Login.tsx
- web/src/pages/Register.tsx
- web/src/pages/Dashboard.tsx
- web/src/pages/Market.tsx
- web/src/pages/StockDetail.tsx
- web/src/pages/Orders.tsx
- web/src/pages/Trades.tsx
- web/src/pages/Positions.tsx
- web/src/components/KLineChart.tsx
- web/src/components/TimelineChart.tsx
- web/src/components/OrderBook.tsx
- web/src/components/TradePanel.tsx
- web/src/components/PnlChart.tsx
- web/src/components/PositionPie.tsx
- web/src/components/StockTable.tsx
- web/src/utils/format.ts
- web/src/utils/constants.ts
- shared/types.ts

## 数据模型

### 用户 (users)
- id: TEXT (UUID) 主键
- username: TEXT 唯一
- password_hash: TEXT (bcrypt)
- initial_capital: REAL 默认 1,000,000
- available_balance: REAL
- frozen_balance: REAL
- created_at: INTEGER

### 股票 (stocks)
- code: TEXT 主键（如 SH600000）
- name: TEXT
- sector: TEXT
- initial_price: REAL
- current_price: REAL
- prev_close: REAL
- open_price: REAL
- high: REAL
- low: REAL
- volume: INTEGER
- turnover: REAL
- updated_at: INTEGER

### 订单 (orders)
- id: TEXT (UUID)
- user_id: TEXT
- stock_code: TEXT
- direction: TEXT (buy/sell)
- order_type: TEXT (market/limit)
- price: REAL
- quantity: INTEGER (手，1手=100股)
- filled_quantity: INTEGER
- filled_price: REAL
- status: TEXT (pending/partial/filled/cancelled)
- created_at: INTEGER
- updated_at: INTEGER

### 持仓 (positions)
- id: TEXT (UUID)
- user_id: TEXT
- stock_code: TEXT
- quantity: INTEGER (股)
- available_quantity: INTEGER (T+1)
- avg_cost: REAL
- created_at: INTEGER
- updated_at: INTEGER

### 成交记录 (trades)
- id: TEXT (UUID)
- order_id: TEXT
- user_id: TEXT
- stock_code: TEXT
- direction: TEXT
- price: REAL
- quantity: INTEGER
- amount: REAL
- commission: REAL
- traded_at: INTEGER

### 行情快照 (quotes)
- id: INTEGER 自增
- stock_code: TEXT
- price: REAL
- volume: INTEGER
- timestamp: INTEGER

## API 设计

认证：
- POST /api/auth/register
- POST /api/auth/login → JWT
- GET /api/auth/me

行情：
- GET /api/quotes/list
- GET /api/quotes/:code
- GET /api/quotes/:code/kline (1m/5m/15m/30m/60m/1d)
- WS /ws/quotes 实时推送

交易：
- POST /api/orders 下单
- DELETE /api/orders/:id 撤单
- GET /api/orders 当日委托
- GET /api/orders/history

持仓与资产：
- GET /api/positions
- GET /api/account/summary
- GET /api/account/pnl

成交：
- GET /api/trades

## 核心业务逻辑

### 行情模拟引擎
- 模型：几何布朗运动 (GBM)
- 参数：drift (μ)、volatility (σ)
- 更新频率：每秒一个 tick
- 涨跌停：±10%（基于昨收价）
- 盘口：5 档买卖

### 撮合引擎
- 市价单：当前最优价立即成交
- 限价单：挂入订单簿，当前价 ≤ 委托价(买)或 ≥ 委托价(卖)时成交
- 手续费：买 0.03%，卖 0.03% + 印花税 0.05%

### 风控
- 涨停不可买入，跌停不可卖出
- 资金/持仓校验
- T+1
- 委托数量必须为 100 整数倍

## 前端页面

- /login — 登录
- /register — 注册
- /dashboard — 仪表盘（总资产、持仓市值、盈亏、收益曲线、持仓饼图）
- /market — 行情大盘（股票列表、实时更新、红涨绿跌）
- /market/:code — 个股详情（K线/分时图、5档盘口、交易面板）
- /orders — 委托管理
- /trades — 成交记录
- /positions — 持仓明细

## 初始化数据

预置 20 只 A 股：
SH600000 浦发银行 银行 7.50, SH600036 招商银行 银行 35.20, SH601318 中国平安 保险 45.80,
SZ000001 平安银行 银行 11.30, SZ000858 五粮液 白酒 152.60, SH600519 贵州茅台 白酒 1680.00,
SZ300750 宁德时代 新能源 198.50, SH601012 隆基绿能 新能源 22.40, SZ002594 比亚迪 汽车 265.30,
SH600887 伊利股份 食品 28.60, SZ000333 美的集团 家电 62.80, SH600276 恒瑞医药 医药 43.20,
SZ300059 东方财富 证券 16.80, SH601688 华泰证券 证券 15.40, SZ002415 海康威视 科技 31.50,
SH688981 中芯国际 芯片 48.90, SZ000725 京东方A 面板 4.20, SH601899 紫金矿业 矿业 14.60,
SZ002352 顺丰控股 物流 38.70, SH600809 山西汾酒 白酒 215.40

## 验收标准

Requirements for server/test/engine.test.ts:
- use bun:test
- cover these cases:
  1. 行情引擎生成合法 tick（在涨跌停范围内）
  2. 市价单立即成交，资金正确扣减
  3. 限价买单在价格满足时成交
  4. 卖出手续费包含印花税
  5. 资金不足时下单失败
  6. T+1 限制：当日买入不可当日卖出
  7. 委托数量非 100 整数倍时拒绝

Acceptance:
- run bunx tsc --noEmit
- that command must pass
- run bun test server/test/engine.test.ts
- that command must pass
