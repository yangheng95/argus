const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const base = path.resolve(__dirname, '..');
const previewDir = path.join(base, 'previews');
const shot = path.join(base, 'screenshots');
fs.mkdirSync(previewDir, { recursive: true });

const slides = [
  ['OpenCorvus 项目生成能力实验报告', '72.2/100 平均综合分；6 个生成项目，真实构建、测试和截图。'],
  ['实验范围', '输入文档已放入各项目内；AI Chat、股票 baseline 与 OpenCorvus 版本均纳入。'],
  ['方法', '可运行性 20%、需求覆盖 25%、功能成熟度 25%、UI 15%、工程质量 15%。'],
  ['运行总览', '6 个项目均可启动截图；Kimi/Opus 通过修复依赖安装态恢复构建测试。'],
  ['代码规模', '全样本平均 12,256 LOC；AI Chat 平均 13,792 LOC；股票 OpenCorvus 为 baseline 2.54×。'],
  ['AI Chat 对比', 'PRD DeepSeek v4 Flash 最大且测试最多：20,769 LOC / 525 tests。'],
  ['AI Chat 截图', '登录后进入完整 Chat 工作台。', 'aichat-prd-deepseek-v4-flash-after-login.png'],
  ['股票 PRD', '核心是交易闭环：注册、行情、SSE、下单、撤单、持仓、记录与风控。'],
  ['股票总览', 'OpenCorvus：74 分；baseline：60 分。OpenCorvus 覆盖更强，但集成未收口。'],
  ['视觉对比', '左 baseline，右 OpenCorvus。', 'baseline-opus-4-7-market.png', 'PRD2Code-stock-web-market.png'],
  ['后端对比', 'OpenCorvus 模块化 route 和测试更强；baseline 根入口服务 SPA 更完整。'],
  ['前端对比', 'OpenCorvus UI 更成熟，但存在 mock API 层和硬编码 proxy。', 'PRD2Code-stock-web-portfolio.png', 'PRD2Code-stock-home.png'],
  ['需求覆盖', 'OpenCorvus 股票 PRD 20 条 API 验收全部通过；根入口和真实 API 贯通扣分。'],
  ['当前完成度', '已经具备复杂产品骨架生成能力，交付完成度仍卡在最后一公里。'],
  ['卡点', 'P0：前后端入口未统一；P0：前端 mock API 残留；P1：端口契约硬编码。'],
  ['附录', 'PPTX、截图、日志、生成命令均位于 artifacts/opencorvus-experiment-report-2026-05-08。'],
];

function imgTag(name) {
  const p = path.join(shot, name);
  if (!fs.existsSync(p)) return '';
  const rel = path.relative(previewDir, p).replaceAll('\\', '/');
  return `<img src="${rel}" />`;
}

const html = `<!doctype html><meta charset="utf-8">
<style>
body{margin:0;background:#0b0f14;font-family:"Microsoft YaHei",Arial,sans-serif;color:#f7fafc}
.slide{width:1280px;height:720px;box-sizing:border-box;padding:54px 64px;background:#0b0f14;position:relative;overflow:hidden}
.k{color:#35c2ff;font-size:14px;font-weight:700;letter-spacing:.08em;margin-bottom:18px}
h1{font-size:42px;line-height:1.15;margin:0 0 22px}
p{font-size:23px;line-height:1.55;color:#a9b4c0;width:880px;margin:0}
.num{position:absolute;right:80px;top:80px;font-size:88px;color:#35c2ff;font-weight:800}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:26px}
img{max-width:100%;max-height:390px;object-fit:contain;border:1px solid #2a3441;border-radius:12px;background:#151b22}
.footer{position:absolute;left:64px;bottom:36px;color:#637083;font-size:13px}
</style>
${slides.map((s,i)=>`<section class="slide" id="s${i+1}">
<div class="k">SLIDE ${String(i+1).padStart(2,'0')}</div>
<h1>${s[0]}</h1>
<p>${s[1]}</p>
${i===0?'<div class="num">72.2</div>':''}
${s[2]?`<div class="grid">${imgTag(s[2])}${s[3]?imgTag(s[3]):''}</div>`:''}
<div class="footer">HTML preview for visual QA; PPTX is editable native content.</div>
</section>`).join('\n')}`;

fs.writeFileSync(path.join(previewDir, 'preview.html'), html);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(previewDir, 'preview.html').replaceAll('\\', '/'));
  for (let i = 1; i <= slides.length; i++) {
    const el = page.locator(`#s${i}`);
    await el.screenshot({ path: path.join(previewDir, `slide-${String(i).padStart(2, '0')}.png`) });
  }
  await browser.close();
})();
