const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');

const base = path.resolve(__dirname, '..');
const outDir = path.join(base, 'output');
const shotDir = path.join(base, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'OpenCorvus Experiment';
pptx.company = 'OpenCorvus';
pptx.subject = 'OpenCorvus 项目生成能力实验报告';
pptx.title = 'OpenCorvus 项目生成能力实验报告';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Microsoft YaHei',
  bodyFontFace: 'Microsoft YaHei',
  lang: 'zh-CN',
};
pptx.defineLayout({ name: 'CUSTOM_WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'CUSTOM_WIDE';
pptx.margin = 0;

const W = 13.333;
const H = 7.5;
const C = {
  bg: '0B0F14',
  panel: '151B22',
  panel2: '1D2630',
  ink: 'F7FAFC',
  muted: 'A9B4C0',
  faint: '637083',
  blue: '2F80ED',
  cyan: '35C2FF',
  green: '2DD36F',
  red: 'FF4D4F',
  amber: 'FFB020',
  purple: '8B5CF6',
  line: '2A3441',
};

const screenshots = {
  aiLogin: path.join(shotDir, 'aichat-prd-deepseek-v4-flash-login.png'),
  aiAfter: path.join(shotDir, 'aichat-prd-deepseek-v4-flash-after-login.png'),
  baseline: path.join(shotDir, 'baseline-opus-4-7-market.png'),
  baselinePortfolio: path.join(shotDir, 'baseline-opus-4-7-portfolio.png'),
  stockApi: path.join(shotDir, 'PRD2Code-stock-home.png'),
  stockWeb: path.join(shotDir, 'PRD2Code-stock-web-market.png'),
  stockPortfolio: path.join(shotDir, 'PRD2Code-stock-web-portfolio.png'),
};

const projects = [
  ['aichat-deepseek-flash', 'AI Chat prompt', 15203, 328, '通过', '通过', 78],
  ['aichat-kimi-k2-5', 'AI Chat prompt', 9876, 45, '通过*', '通过*', 66],
  ['aichat-opus4-7', 'AI Chat prompt', 9320, 247, '通过*', '通过*', 72],
  ['aichat-prd-deepseek-v4-flash', 'AI Chat PRD', 20769, 525, '通过', '通过', 83],
  ['baseline-opus-4-7', '股票 baseline', 5187, 18, '通过', '弱覆盖', 60],
  ['PRD2Code-股票交易', '股票 OpenCorvus', 13183, 158, '通过', '通过', 74],
];

const aiProjects = projects.slice(0, 4);
const aiAvg = Math.round(aiProjects.reduce((s, p) => s + p[2], 0) / aiProjects.length);
const allAvg = Math.round(projects.reduce((s, p) => s + p[2], 0) / projects.length);

function slide(title, kicker) {
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.bg }, line: { color: C.bg } });
  if (kicker) {
    s.addText(kicker, { x: 0.55, y: 0.28, w: 4, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 9, color: C.cyan, bold: true, margin: 0 });
  }
  if (title) {
    s.addText(title, { x: 0.55, y: 0.55, w: 10.8, h: 0.55, fontFace: 'Microsoft YaHei', fontSize: 23, color: C.ink, bold: true, margin: 0 });
  }
  s.addText('OpenCorvus experiment report · 2026-05-08', { x: 9.45, y: 7.06, w: 3.25, h: 0.18, fontSize: 7.5, color: C.faint, align: 'right', margin: 0 });
  return s;
}

function addFooter(s, text) {
  s.addText(text, { x: 0.55, y: 7.04, w: 8.8, h: 0.24, fontSize: 7.5, color: C.faint, margin: 0 });
}

function metric(s, label, value, x, y, w, accent = C.blue, sub = '') {
  s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 1.08, rectRadius: 0.08, fill: { color: C.panel }, line: { color: C.line, transparency: 10 } });
  s.addText(label, { x: x + 0.18, y: y + 0.16, w: w - 0.36, h: 0.18, fontSize: 8, color: C.muted, margin: 0 });
  s.addText(String(value), { x: x + 0.18, y: y + 0.42, w: w - 0.36, h: 0.34, fontSize: 21, color: accent, bold: true, margin: 0 });
  if (sub) s.addText(sub, { x: x + 0.18, y: y + 0.82, w: w - 0.36, h: 0.16, fontSize: 7, color: C.faint, margin: 0 });
}

function bullet(s, items, x, y, w, h, color = C.muted) {
  s.addText(items.map(t => ({ text: t, options: { bullet: { type: 'ul' }, breakLine: true } })), {
    x, y, w, h, fontSize: 11, color, fit: 'shrink', margin: 0.04, breakLine: false,
  });
}

function table(s, rows, x, y, w, h, opts = {}) {
  const colW = opts.colW || undefined;
  const data = rows.map((r, idx) => r.map((cell) => ({
    text: String(cell),
    options: {
      fontFace: 'Microsoft YaHei',
      fontSize: idx === 0 ? 8.5 : 8,
      bold: idx === 0,
      color: idx === 0 ? C.ink : C.muted,
      fill: { color: idx === 0 ? C.panel2 : C.panel, transparency: idx === 0 ? 0 : 10 },
      margin: 0.05,
      valign: 'mid',
      fit: 'shrink',
      border: { type: 'solid', color: C.line, pt: 0.5 },
    },
  })));
  s.addTable(data, { x, y, w, h, colW, border: { type: 'solid', color: C.line, pt: 0.5 } });
}

function addImg(s, imgPath, x, y, w, h, mode = 'contain') {
  if (!fs.existsSync(imgPath)) return;
  s.addImage({ path: imgPath, x, y, w, h, sizing: { type: mode, x, y, w, h } });
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: 'FFFFFF', transparency: 100 }, line: { color: C.line, transparency: 0, pt: 0.6 } });
}

function bar(s, label, value, max, x, y, w, color) {
  s.addText(label, { x, y, w: 2.4, h: 0.18, fontSize: 8, color: C.muted, margin: 0 });
  s.addShape(pptx.ShapeType.rect, { x: x + 2.55, y: y + 0.04, w, h: 0.14, fill: { color: C.panel2 }, line: { color: C.panel2 } });
  s.addShape(pptx.ShapeType.rect, { x: x + 2.55, y: y + 0.04, w: w * value / max, h: 0.14, fill: { color }, line: { color } });
  s.addText(String(value), { x: x + 2.55 + w + 0.12, y: y - 0.01, w: 0.8, h: 0.18, fontSize: 8, color: C.ink, margin: 0 });
}

// 1 cover
{
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.bg }, line: { color: C.bg } });
  s.addText('OpenCorvus\n项目生成能力实验报告', { x: 0.72, y: 0.68, w: 7.2, h: 1.35, fontSize: 34, bold: true, color: C.ink, breakLine: false, fit: 'shrink', margin: 0 });
  s.addText('6 个生成项目 · 真实构建测试 · 浏览器截图 · 股票 baseline 对照', { x: 0.78, y: 2.2, w: 7.6, h: 0.28, fontSize: 13, color: C.muted, margin: 0 });
  s.addText('72.2', { x: 8.15, y: 0.75, w: 3.2, h: 1.15, fontSize: 58, bold: true, color: C.cyan, margin: 0, align: 'right' });
  s.addText('/100 平均综合分', { x: 8.3, y: 1.9, w: 3.1, h: 0.28, fontSize: 13, color: C.muted, align: 'right', margin: 0 });
  s.addShape(pptx.ShapeType.line, { x: 0.78, y: 3.05, w: 11.7, h: 0, line: { color: C.line, pt: 1.2 } });
  metric(s, '平均源码规模', allAvg.toLocaleString(), 0.78, 3.55, 2.65, C.blue, '排除 node_modules/dist/.git 等');
  metric(s, 'AI Chat 平均 LOC', aiAvg.toLocaleString(), 3.65, 3.55, 2.65, C.green, '四个 AI Chat 生成样本');
  metric(s, '股票 LOC 放大', '2.54×', 6.52, 3.55, 2.65, C.amber, 'OpenCorvus vs baseline');
  metric(s, '股票测试放大', '8.78×', 9.39, 3.55, 2.65, C.purple, '158 vs 18 pass');
  bullet(s, [
    '结论不是“谁代码多谁好”：OpenCorvus 在覆盖面、测试和 UI 复杂度上更强。',
    '主要卡点集中在交付集成：前后端入口未统一、部分前端仍使用 mock 数据层。',
    '视觉证据来自本机真实启动和 Playwright 截图。'
  ], 0.82, 5.05, 10.7, 1.0, C.muted);
  addFooter(s, 'Cover concept: one-number report cover; score is derived from weighted runability, coverage, maturity, UI and engineering quality.');
}

// 2 scope
{
  const s = slide('实验范围：输入文档已随项目落盘', 'SCOPE');
  table(s, [
    ['项目', '输入证据', '实验角色', '端口/截图'],
    ['aichat-prd-deepseek-v4-flash', '项目内 aichat_prd.md', '最新 AI Chat 样本', '43104 / 43114'],
    ['aichat-deepseek-flash', '项目内 aichat-prompt.md', 'AI Chat 对照样本', '43101'],
    ['aichat-kimi-k2-5', '项目内 aichat-prompt.md', 'AI Chat 对照样本', '43102'],
    ['aichat-opus4-7', '项目内 aichat-prompt.md', 'AI Chat 对照样本', '43103'],
    ['baseline-opus-4-7', '项目内 prd-stock-trading-sim.txt', '股票 baseline', '43105 / 43115'],
    ['PRD2Code-股票交易', '项目内 prd-stock-trading-sim.txt', '股票 OpenCorvus', '43106 / web 43116'],
  ], 0.65, 1.32, 12.05, 3.4, { colW: [3.4, 3.0, 2.6, 2.0] });
  bullet(s, ['所有 prompt / PRD 均从磁盘读取；缺少证据不会补写。', '端口冲突通过独立端口或前后端拆分启动处理，不修改源码。'], 0.7, 5.25, 10.8, 0.6);
  addFooter(s, 'Evidence paths: demos/*/{aichat-prompt.md,aichat_prd.md,prd-stock-trading-sim.txt}.');
}

// 3 method
{
  const s = slide('方法：用可复现信号给生成能力打分', 'METHOD');
  metric(s, '可运行性', '20%', 0.7, 1.4, 2.2, C.green, 'install/build/start/screenshot/console');
  metric(s, '需求覆盖率', '25%', 3.05, 1.4, 2.2, C.blue, 'PRD 验收项逐项映射');
  metric(s, '功能成熟度', '25%', 5.4, 1.4, 2.2, C.purple, '闭环、持久化、实时、错误处理');
  metric(s, 'UI 完成度', '15%', 7.75, 1.4, 2.2, C.amber, '真实截图、布局、状态、图表');
  metric(s, '工程质量', '15%', 10.1, 1.4, 2.2, C.cyan, '类型、模块、API、测试');
  table(s, [
    ['执行项', '真实命令/工具', '结果写入'],
    ['代码统计', 'PowerShell + rg，排除依赖和构建产物', 'businessLoc/testLoc'],
    ['构建测试', 'npm/bun，日志活动 idle timeout', 'logs/*.json'],
    ['截图', 'Playwright Chromium，本机启动项目', 'screenshots/*.png'],
    ['PPT', 'pptxgenjs 原生 PPTX + HTML/PNG 预览', 'output/*.pptx / previews'],
  ], 0.72, 3.25, 11.9, 2.2, { colW: [2.2, 5.2, 3.1] });
  addFooter(s, 'Timeout policy: monitored by log activity, not by elapsed time since process launch.');
}

// 4 overview
{
  const s = slide('运行总览：6 个项目均可启动截图，2 个曾因依赖态失败后恢复', 'RUN');
  table(s, [
    ['项目', 'LOC', '测试', 'Build', 'Test', '运行截图', '分'],
    ...projects.map(p => [p[0], p[2].toLocaleString(), p[3], p[4], p[5], 'OK', p[6]]),
  ], 0.52, 1.3, 12.3, 4.6, { colW: [3.3, 1.0, 0.8, 1.0, 1.0, 1.1, 0.6] });
  bullet(s, ['Kimi/Opus 初次失败根因是 node_modules 缺少本地 bin；npm ci 后构建/测试恢复。', 'PRD2Code 后端根入口只返回 API 文本，前端需额外进入 web Vite 启动。'], 0.7, 6.08, 10.8, 0.55);
}

// 5 scale
{
  const s = slide('代码规模：OpenCorvus 会显著扩大实现面，但不等价于完成度', 'LOC');
  const max = 21000;
  projects.forEach((p, i) => bar(s, p[0], p[2], max, 0.75, 1.25 + i * 0.62, 6.6, i === 5 ? C.green : (i === 4 ? C.amber : C.blue)));
  metric(s, '全样本平均', allAvg.toLocaleString(), 9.05, 1.2, 2.75, C.cyan, '6 projects');
  metric(s, 'AI Chat 平均', aiAvg.toLocaleString(), 9.05, 2.55, 2.75, C.green, '4 projects');
  metric(s, '股票差距', '2.54×', 9.05, 3.9, 2.75, C.amber, '13,183 vs 5,187 LOC');
  bullet(s, ['PRD 级 AI Chat 新样本最大：20,769 LOC / 525 tests。', '股票 OpenCorvus 比 baseline 更完整，但存在入口集成和前端 mock 层问题。'], 0.8, 5.75, 11.1, 0.6);
}

// 6 AI comparison
{
  const s = slide('AI Chat：PRD 版样本覆盖最强，prompt 版样本差异明显', 'AI CHAT');
  table(s, [
    ['AI Chat 样本', '输入', 'LOC', 'Tests', '成熟度判断'],
    ['deepseek-flash', '短 prompt', '15,203', '328', '覆盖登录、SSE、API key、搜索等，结构完整'],
    ['kimi-k2-5', '短 prompt', '9,876', '45', '功能面较窄，测试少；依赖重装后可运行'],
    ['opus4-7', '短 prompt', '9,320', '247', '组件和 Markdown 能力强，应用集成中等'],
    ['prd-deepseek-v4-flash', '完整 PRD', '20,769', '525', '当前最完整：路由、持久化、渲染、设置、测试均强'],
  ], 0.6, 1.32, 12.1, 3.55, { colW: [2.5, 1.25, 1.0, 0.8, 5.8] });
  addImg(s, screenshots.aiAfter, 0.75, 5.1, 5.8, 1.75, 'contain');
  bullet(s, ['报告采用 PRD 版作为 AI Chat 主样本；其它三个用于衡量生成稳定性。', '真实 Deepseek SSE 需配置外部 Key，本次未调用外部模型，只验证本地应用与测试证据。'], 6.85, 5.25, 5.6, 1.0);
}

// 7 AI screenshot
{
  const s = slide('AI Chat 主样本：登录后可进入完整 Chat 工作台', 'AI CHAT SCREEN');
  addImg(s, screenshots.aiAfter, 0.58, 1.28, 8.1, 4.58, 'contain');
  metric(s, '测试覆盖', '525', 9.05, 1.35, 2.7, C.green, '68 files passed');
  metric(s, '源码规模', '20,769', 9.05, 2.65, 2.7, C.blue, 'largest AI sample');
  metric(s, 'Console', '0 error', 9.05, 3.95, 2.7, C.green, 'only router warnings');
  bullet(s, ['首屏有模型选择、会话栏、示例 prompt 卡片和快捷键提示。', 'UI 已达到“可演示产品”而非默认 Vite 页。'], 9.05, 5.3, 3.0, 0.75);
}

// 8 stock PRD
{
  const s = slide('股票交易 PRD：核心不是页面，而是交易闭环和实时可信', 'STOCK PRD');
  bullet(s, [
    '技术栈固定：Bun + Hono + SQLite + React + Vite + Recharts。',
    '必须完成注册/登录、行情、SSE、下单、撤单、持仓、资产、记录、风控。',
    '验收包含 20 条 API 测试：资金冻结、100 股倍数、±10% 限价、用户隔离、K 线 MACD、新闻 sentiment。',
    'UI 要求 Apple 深色模式：毛玻璃、红涨绿跌、图表、热力图、动效、无空白表格。'
  ], 0.9, 1.35, 6.0, 4.1);
  metric(s, 'API 验收项', '20', 8.0, 1.35, 2.8, C.blue, 'PRD §二十');
  metric(s, '刷新频率', '2s', 8.0, 2.65, 2.8, C.green, 'SSE 行情');
  metric(s, '初始资金', '¥1,000,000', 8.0, 3.95, 2.8, C.amber, '模拟账户');
}

// 9 stock overview
{
  const s = slide('股票 baseline vs OpenCorvus：后者更强，但集成缺口更尖锐', 'STOCK SCORE');
  table(s, [
    ['维度', 'baseline-opus-4-7', 'PRD2Code-股票交易', '判断'],
    ['源码规模', '5,187 LOC', '13,183 LOC', 'OpenCorvus 2.54×'],
    ['测试', '18 pass，覆盖窄', '158 pass，含 PRD 20 条 API', 'OpenCorvus 强'],
    ['后端', '单 index 挂全路由并服务 SPA', '模块化 Hono route', 'OpenCorvus 结构强'],
    ['前端接入', '真实 fetch 到 /api', '部分 mock API + proxy 3000', 'baseline 闭环强'],
    ['根入口', '可直接看到 Web App', '只返回 API 文本', 'OpenCorvus 卡点'],
    ['UI', '可用但热力图/排版粗糙', '更接近 Apple 深色交易终端', 'OpenCorvus 强'],
  ], 0.58, 1.25, 12.15, 4.55, { colW: [1.7, 3.0, 3.2, 2.9] });
  metric(s, 'baseline', '60', 1.05, 6.05, 2.4, C.amber, '闭环直接，但覆盖浅');
  metric(s, 'OpenCorvus', '74', 3.75, 6.05, 2.4, C.green, '覆盖强，集成未收口');
  bullet(s, ['“完成度”不是单一维度：OpenCorvus 生成能力强，交付口仍有断点。'], 6.7, 6.35, 5.3, 0.35);
}

// 10 side by side screenshots
{
  const s = slide('视觉对比：OpenCorvus 更像交易终端，baseline 更像早期 MVP', 'STOCK UI');
  addImg(s, screenshots.baseline, 0.55, 1.3, 5.9, 4.8, 'contain');
  addImg(s, screenshots.stockWeb, 6.88, 1.3, 5.9, 4.8, 'contain');
  s.addText('baseline：真实入口完整，但热力图重叠、信息层级粗糙', { x: 0.65, y: 6.25, w: 5.6, h: 0.28, fontSize: 9, color: C.amber, margin: 0 });
  s.addText('OpenCorvus：Apple 深色风格、榜单/热力图/新闻流更完整', { x: 6.98, y: 6.25, w: 5.8, h: 0.28, fontSize: 9, color: C.green, margin: 0 });
}

// 11 backend comparison
{
  const s = slide('后端能力：OpenCorvus 模块化更完整，baseline 更会“直接交付”', 'BACKEND');
  table(s, [
    ['能力', 'baseline', 'OpenCorvus'],
    ['路由组织', 'index.ts 内集中注册约 26 条路由', 'auth/market/news/trading/portfolio/history 模块 route'],
    ['数据库', 'SQLite schema + seed', 'SQLite schema + seed + 更复杂交易/模拟器类型'],
    ['行情', 'SSE + heatmap + kline', 'SSE + kline + indicators + simulator tests'],
    ['交易风控', '实现买卖撤单和基础风控', '测试覆盖价格限制、资金不足、用户隔离'],
    ['静态服务', '根入口服务 web/dist', '根入口只返回 API 文本'],
  ], 0.7, 1.3, 11.8, 4.15, { colW: [2.0, 4.4, 5.0] });
  bullet(s, ['根入口问题是交付缺口，不是算法缺口；但它会直接影响用户“本地启动可看到应用”的验收。'], 0.85, 5.85, 11.1, 0.45);
}

// 12 frontend comparison
{
  const s = slide('前端能力：OpenCorvus UI 更成熟，但仍保留 mock 数据通道', 'FRONTEND');
  addImg(s, screenshots.stockPortfolio, 0.58, 1.3, 5.55, 3.3, 'contain');
  addImg(s, screenshots.stockApi, 7.6, 1.3, 3.9, 2.2, 'contain');
  table(s, [
    ['观察项', '证据'],
    ['PRD2Code UI', '行情、榜单、热力图、新闻、持仓页完整，视觉更专业'],
    ['PRD2Code 数据层', 'tradingApi.ts / portfolioApi.ts 明确为 mock，等待 goal_integration 替换'],
    ['PRD2Code 启动契约', 'vite proxy target 固定 http://localhost:3000；根服务不挂 SPA'],
    ['baseline UI', '真实 API 闭环强，但热力图可读性和布局质量弱'],
  ], 0.65, 4.95, 11.8, 1.45, { colW: [2.2, 8.8] });
}

// 13 requirement coverage
{
  const s = slide('需求覆盖：OpenCorvus 强在“写了并测了”，弱在“集成闭环未统一”', 'COVERAGE');
  table(s, [
    ['验收族', 'baseline', 'OpenCorvus', '证据'],
    ['注册/登录', '通过', '通过', 'browser flow + API tests'],
    ['行情/SSE/K线', '实现', '实现并测试', 'SSE / Kline / MACD tests'],
    ['下单/撤单/持仓', '实现', '后端测试强，前端部分 mock', 'trading tests + mock API comments'],
    ['记录/新闻/热力图', '实现粗糙', '更完整', 'screenshots'],
    ['Apple UI', '基本暗色', '更贴近', 'theme/component tests'],
    ['本地一键打开 Web', '通过', '未通过根入口', 'PRD2 root screenshot'],
  ], 0.7, 1.25, 11.9, 4.2, { colW: [2.0, 2.0, 2.4, 4.5] });
  metric(s, 'PRD API tests', '20/20', 1.0, 5.95, 2.7, C.green, 'OpenCorvus stock');
  metric(s, 'UI tests', '119+', 4.0, 5.95, 2.7, C.blue, 'ARIA/design/keyboard/contrast');
  metric(s, '交付卡点', '2', 7.0, 5.95, 2.7, C.red, 'SPA mount + mock client');
}

// 14 OpenCorvus completion
{
  const s = slide('当前完成度：已经具备“生成复杂产品骨架”的能力', 'STATUS');
  metric(s, '综合平均', '72.2', 0.8, 1.35, 2.75, C.cyan, '6 projects');
  metric(s, 'AI Chat 最佳', '83', 3.85, 1.35, 2.75, C.green, 'PRD DeepSeek v4 Flash');
  metric(s, '股票 OpenCorvus', '74', 6.9, 1.35, 2.75, C.green, 'vs baseline 60');
  metric(s, '真实截图', '16', 9.95, 1.35, 2.75, C.blue, 'home + flows');
  bullet(s, [
    '强项：大 PRD 拆解能力、代码规模、模块覆盖、测试意识、视觉完成度。',
    '中项：多样本稳定性；依赖状态修复后全部可 build/test。',
    '弱项：交付入口统一、前后端真实 API 贯通、避免 mock 层残留。'
  ], 0.9, 3.25, 10.8, 1.55);
  table(s, [
    ['成熟度等级', '解释'],
    ['AI Chat', '演示级可用，真实外部 Deepseek SSE 需配置 Key 再做端到端验收'],
    ['股票交易', '后端与 UI 接近演示级，但还不是“启动即完整产品”的交付形态'],
  ], 0.9, 5.25, 10.9, 1.0, { colW: [2.0, 8.4] });
}

// 15 blockers
{
  const s = slide('卡点：不是“不会生成”，而是最后一公里缺少收口纪律', 'BLOCKERS');
  table(s, [
    ['卡点', '证据', '影响', '优先级'],
    ['前后端入口未统一', 'PRD2 root 只显示 API 文本', '用户无法按 PRD 直接打开完整应用', 'P0'],
    ['前端 mock API 残留', 'tradingApi/portfolioApi 注释写明 mock', '交易闭环不能完全代表真实后端', 'P0'],
    ['端口契约硬编码', 'vite proxy 固定 3000', '多项目实验和部署不稳', 'P1'],
    ['部分样本依赖状态不完整', 'Kimi/Opus 初次缺 tsc/vite/vitest', '影响一键验收', 'P1'],
    ['bundle 过大', 'AI Chat PRD index 约 1.45MB', '性能目标需继续优化', 'P2'],
  ], 0.55, 1.25, 12.2, 4.25, { colW: [2.1, 3.8, 3.4, 0.9] });
  bullet(s, ['下一轮不要先堆功能：先把“单入口、单数据源、真实 API 贯通、启动契约”作为质量门。'], 0.8, 6.0, 11.2, 0.45, C.ink);
}

// 16 appendix
{
  const s = slide('附录：输出物与复现路径', 'APPENDIX');
  table(s, [
    ['类别', '路径/命令'],
    ['PPTX', 'artifacts/opencorvus-experiment-report-2026-05-08/output/OpenCorvus-experiment-report-2026-05-08.pptx'],
    ['截图', 'artifacts/opencorvus-experiment-report-2026-05-08/screenshots/*.png'],
    ['构建/测试日志', 'artifacts/opencorvus-experiment-report-2026-05-08/logs/*.log'],
    ['启动截图结果', 'runtime-screenshot-results.json / flow-screenshot-results.json'],
    ['PPT 生成命令', 'node artifacts/.../runtime/build-report.cjs'],
    ['预览生成命令', 'node artifacts/.../runtime/build-previews.cjs'],
  ], 0.65, 1.3, 12.0, 3.5, { colW: [2.3, 8.8] });
  bullet(s, ['未做外部 PowerPoint/Keynote parity 声明；本机无可用 headless PPTX renderer。', '预览 PNG 是从同一内容数据生成的视觉 QA，不替代 PowerPoint 打开检查。'], 0.8, 5.35, 10.8, 0.7);
}

pptx.writeFile({ fileName: path.join(outDir, 'OpenCorvus-experiment-report-2026-05-08.pptx') });
