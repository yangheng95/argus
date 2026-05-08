const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [url, name, kind, outDir] = process.argv.slice(2);
if (!url || !name || !kind || !outDir) {
  console.error('usage: node capture-flows.cjs <url> <name> <kind> <outDir>');
  process.exit(2);
}

function file(label) {
  return path.join(outDir, `${name}-${label}.png`);
}

async function visible(locator) {
  try {
    return await locator.first().isVisible({ timeout: 1200 });
  } catch {
    return false;
  }
}

async function fillFirst(page, candidates, value) {
  for (const locator of candidates) {
    if (await visible(locator)) {
      await locator.first().fill(value);
      return true;
    }
  }
  return false;
}

async function clickFirst(page, candidates) {
  for (const locator of candidates) {
    if (await visible(locator)) {
      await locator.first().click();
      return true;
    }
  }
  return false;
}

async function captureAi(page) {
  await page.screenshot({ path: file('login'), fullPage: true });
  await fillFirst(page, [
    page.locator('input[type="email"]'),
    page.locator('input[placeholder*="邮箱"]'),
    page.locator('input[placeholder*="email" i]'),
  ], `report-${Date.now()}@example.com`);
  await fillFirst(page, [
    page.locator('input[type="password"]'),
    page.locator('input[placeholder*="密码"]'),
    page.locator('input[placeholder*="password" i]'),
  ], 'password123');
  await clickFirst(page, [
    page.getByRole('button', { name: /登录|继续|Sign in|Login|欢迎回来/i }),
    page.locator('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: file('after-login'), fullPage: true });
}

async function captureStock(page) {
  await page.screenshot({ path: file('entry'), fullPage: true });
  await clickFirst(page, [
    page.getByText(/注册/),
    page.getByRole('link', { name: /注册|Register/i }),
    page.getByRole('button', { name: /注册|Register/i }),
  ]);
  await page.waitForTimeout(500);
  const username = `u${Date.now()}`;
  await fillFirst(page, [
    page.locator('input[name="username"]'),
    page.locator('input[placeholder*="用户名"]'),
    page.locator('input[placeholder*="user" i]'),
  ], username);
  await fillFirst(page, [
    page.locator('input[name="password"]'),
    page.locator('input[type="password"]').first(),
    page.locator('input[placeholder*="密码"]'),
  ], 'password123');
  await fillFirst(page, [
    page.locator('input[name="confirmPassword"]'),
    page.locator('input[placeholder*="确认"]'),
    page.locator('input[type="password"]').nth(1),
  ], 'password123');
  await clickFirst(page, [
    page.getByRole('button', { name: /注册|创建|Register/i }),
    page.locator('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: file('market'), fullPage: true });
  await clickFirst(page, [
    page.getByText(/持仓/),
    page.getByRole('link', { name: /持仓|Portfolio/i }),
    page.getByRole('button', { name: /持仓|Portfolio/i }),
  ]);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: file('portfolio'), fullPage: true });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const events = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) events.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => events.push({ type: 'pageerror', text: err.message }));
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    if (kind === 'ai') await captureAi(page);
    else if (kind === 'stock') await captureStock(page);
    else await page.screenshot({ path: file('page'), fullPage: true });
    fs.writeFileSync(path.join(outDir, `${name}-console.json`), JSON.stringify(events, null, 2));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
