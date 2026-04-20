根据参考网页复刻一个完整的股票交易系统。参考站点：https://chart.ainvest.com/NASDAQ-NVDA/

严格遵循参考网页的视觉风格（暗色、紫/蓝强调、卡片化），实现前后端最小可用版本。

## 前端（静态 HTML + CSS + 原生 JS）
- `public/index.html` — 市场总览
- `public/stocks/NVDA.html` — 个股详情（含 Canvas 画的 60 点折线图、买卖面板）
- `public/assets/styles.css`、`public/assets/app.js`

## 后端（Bun 原生 HTTP）
- `src/server.ts` 监听 `127.0.0.1:3000`
- `GET /api/stocks`、`GET /api/stocks/:symbol`、`POST /api/orders`

## 验收
- `bun run src/server.ts` 可启动
- 浏览器访问首页和 NVDA 详情页渲染正常
- 买卖面板下单后 `/api/orders` 返回 200

## 限制
- 只修改 `public/**`、`src/**`
- 不要创建 package.json、README、测试文件
- 不引入第三方依赖
