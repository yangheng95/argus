#!/usr/bin/env bun
// Visual+functional audit for the web-calculator deliverable.
// Walks the 16 spec requirements, builds the project, drives it with Playwright,
// and writes screenshots + a JSON verdict to <project>/.scratch/audit-report/.

import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { launchBrowser, type OverlayBrowser, type OverlayPage } from "../../../overlay/test/launch"

const PROJECT_DIR = process.argv[2]
if (!PROJECT_DIR) {
  console.error("usage: bun run script/benchmark/audit-calculator.ts <project-dir>")
  process.exit(2)
}
const ROOT = path.resolve(PROJECT_DIR)
const REPORT_DIR = path.join(ROOT, ".scratch", "audit-report")
await fs.mkdir(REPORT_DIR, { recursive: true })

type Finding = { id: string; req: string; status: "pass" | "fail" | "warn" | "skip"; note: string }
const findings: Finding[] = []
function record(id: string, req: string, status: Finding["status"], note: string) {
  findings.push({ id, req, status, note })
  const tag = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status === "warn" ? "WARN" : "SKIP"
  console.log(`[${tag}] ${id} ${req} — ${note}`)
}

// --- 1. static inspection -------------------------------------------------
async function fileExists(p: string) {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}
async function readSafe(p: string) {
  try {
    return await fs.readFile(p, "utf8")
  } catch {
    return ""
  }
}

const pkgPath = path.join(ROOT, "package.json")
const pkg = await readSafe(pkgPath)
const readme = await readSafe(path.join(ROOT, "README.md"))
const indexHtml = await readSafe(path.join(ROOT, "index.html"))

// Scan all source files for evidence of features (so we don't false-fail on UI tests that depend on visible elements).
async function listSrc(dir: string, out: string[] = []): Promise<string[]> {
  const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === ".scratch") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await listSrc(p, out)
    else if (/\.(ts|tsx|js|jsx|html|css|md|json)$/i.test(e.name)) out.push(p)
  }
  return out
}
const srcFiles = await listSrc(ROOT)
const codeBundle = (await Promise.all(srcFiles.map(readSafe))).join("\n")

// --- 2. build -------------------------------------------------------------
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? ROOT, shell: true })
    let out = "",
      err = ""
    child.stdout.on("data", (d) => {
      out += d.toString()
    })
    child.stderr.on("data", (d) => {
      err += d.toString()
    })
    const t = setTimeout(() => {
      child.kill("SIGKILL")
    }, opts.timeoutMs ?? 600_000)
    child.on("close", (code) => {
      clearTimeout(t)
      resolve({ code: code ?? -1, out, err })
    })
  })
}

const hasNodeModules = await fileExists(path.join(ROOT, "node_modules"))
if (!hasNodeModules) {
  console.log("[audit] npm install …")
  const r = await run("npm", ["install", "--no-audit", "--no-fund"], { timeoutMs: 600_000 })
  if (r.code !== 0) {
    record("BUILD-INSTALL", "npm install", "fail", `exit=${r.code}\n${r.err.slice(-1500)}`)
  } else record("BUILD-INSTALL", "npm install", "pass", "ok")
} else record("BUILD-INSTALL", "npm install", "skip", "node_modules already exists")

const pkgJson = pkg ? JSON.parse(pkg) : {}
const hasBuild = !!pkgJson.scripts?.build
if (hasBuild) {
  console.log("[audit] npm run build …")
  const r = await run("npm", ["run", "build"], { timeoutMs: 300_000 })
  if (r.code !== 0) record("BUILD", "npm run build", "fail", `exit=${r.code}\n${(r.err || r.out).slice(-2000)}`)
  else record("BUILD", "npm run build", "pass", "ok")
} else record("BUILD", "npm run build", "warn", "no build script")

// --- 3. boot preview ------------------------------------------------------
let preview: ChildProcess | null = null
let baseURL = ""
async function startPreview(): Promise<string> {
  // Vite preview on a deterministic port
  const port = 4173 + Math.floor(Math.random() * 200)
  preview = spawn("npx", ["--yes", "vite", "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  preview.stdout?.on("data", (d) => {
    log += d.toString()
  })
  preview.stderr?.on("data", (d) => {
    log += d.toString()
  })
  // Wait until "Local:" line shows up (vite logs the URL)
  const url = `http://127.0.0.1:${port}/`
  const t0 = Date.now()
  while (Date.now() - t0 < 30_000) {
    try {
      const resp = await fetch(url).catch(() => null)
      if (resp && resp.ok) return url
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`vite preview did not come up: ${log.slice(-1000)}`)
}

try {
  baseURL = await startPreview()
  record("BOOT", "vite preview reachable", "pass", baseURL)
} catch (e: any) {
  record("BOOT", "vite preview reachable", "fail", String(e?.message || e))
}

// --- 4. drive UI ----------------------------------------------------------
let browser: OverlayBrowser | null = null
let page: OverlayPage | null = null
const consoleErrors: string[] = []
if (baseURL) {
  browser = await launchBrowser(["--no-sandbox", "--disable-setuid-sandbox"])
  page = await browser.newPage()
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console.error: ${m.text()}`)
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 30_000 })
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: path.join(REPORT_DIR, "01-desktop-default.png"), fullPage: true })
}

async function shot(name: string) {
  if (!page) return
  await page.screenshot({ path: path.join(REPORT_DIR, name), fullPage: true })
}

// helpers to drive common interactions; resilient to button-naming variation.
async function clickByText(text: string): Promise<boolean> {
  if (!page) return false
  return await page.evaluate((t) => {
    const buttons = Array.from(document.querySelectorAll("button, [role=button], .button, .btn"))
    const target = buttons.find((b) => (b.textContent || "").trim() === t) as HTMLElement | undefined
    if (!target) return false
    target.click()
    return true
  }, text)
}

async function readDisplay(): Promise<string> {
  if (!page) return ""
  return await page.evaluate(() => {
    const candidates = [
      ".display .result",
      ".display .current",
      ".display-current",
      ".display .value",
      ".display",
      "#display",
      "[data-testid=display]",
      ".screen",
      ".main-display",
      ".result",
      "#result",
      ".calculator__display",
    ]
    for (const sel of candidates) {
      const el = document.querySelector(sel)
      if (el && (el.textContent || "").trim()) return (el.textContent || "").trim()
    }
    // fallback: largest text block
    const all = Array.from(document.querySelectorAll("body *")).filter((e) =>
      /^\d|Error/.test((e.textContent || "").trim()),
    )
    return (all[0]?.textContent || "").trim()
  })
}

async function pressKey(key: string) {
  if (!page) return
  await page.keyboard.press(key)
}

async function typeKeys(s: string) {
  if (!page) return
  // page.keyboard.type() simulates per-character typing including shift for ()*+
  // (page.keyboard.press("+") would not generate the "+" without explicit Shift on a US layout).
  await page.keyboard.type(s, { delay: 20 })
}

if (page && baseURL) {
  // R1: arithmetic via keyboard 12+34
  await pressKey("Escape").catch(() => {})
  await typeKeys("12+34")
  await pressKey("Enter")
  await new Promise((r) => setTimeout(r, 300))
  const r1 = await readDisplay()
  record("R1-add", "12+34=46", /\b46\b/.test(r1) ? "pass" : "fail", `display="${r1}"`)
  await shot("02-after-12+34.png")

  // R1b: subtraction with negatives 5-12
  await pressKey("Escape").catch(() => {})
  await typeKeys("5-12")
  await pressKey("Enter")
  await new Promise((r) => setTimeout(r, 300))
  const r1b = await readDisplay()
  record("R1-neg", "5-12=-7", /-\s*7/.test(r1b) ? "pass" : "fail", `display="${r1b}"`)

  // R1c: division by zero -> Error
  await pressKey("Escape").catch(() => {})
  await typeKeys("8/0")
  await pressKey("Enter")
  await new Promise((r) => setTimeout(r, 300))
  const r1c = await readDisplay()
  record("R1-div0", "8/0 -> Error", /Error/i.test(r1c) ? "pass" : "fail", `display="${r1c}"`)
  await shot("03-divide-by-zero.png")

  // R2: parens & precedence (2+3)*4 = 20
  await pressKey("Escape").catch(() => {})
  await typeKeys("(2+3)*4")
  await pressKey("Enter")
  await new Promise((r) => setTimeout(r, 300))
  const r2 = await readDisplay()
  record("R2-parens", "(2+3)*4=20", /\b20\b/.test(r2) ? "pass" : "fail", `display="${r2}"`)
  // not using eval check: scan source for `eval(`
  const usesEval = /\beval\s*\(/.test(codeBundle.replace(/\beval\s*ate[A-Za-z]*\b/g, ""))
  record("R2-no-eval", "no use of eval()", usesEval ? "fail" : "pass", usesEval ? "found eval(" : "not found")

  // R3: %, x², √, 1/x, ±  — best-effort by clicking labels
  const fnLabels = ["%", "x²", "√", "1/x", "±"]
  const fnPresent = await page.evaluate((labels) => {
    const buttons = Array.from(document.querySelectorAll("button, [role=button]"))
    const texts = new Set(buttons.map((b) => (b.textContent || "").trim()))
    return labels.map((l) => ({ l, present: texts.has(l) }))
  }, fnLabels)
  for (const f of fnPresent) {
    record(
      `R3-${f.l}`,
      `function key ${f.l} present`,
      f.present ? "pass" : "fail",
      f.present ? "" : "no button with that exact label",
    )
  }

  // R4: AC / C / ⌫ buttons present
  const clearLabels = ["AC", "C", "⌫"]
  const clearPresent = await page.evaluate((labels) => {
    const buttons = Array.from(document.querySelectorAll("button, [role=button]"))
    const texts = new Set(buttons.map((b) => (b.textContent || "").trim()))
    return labels.map((l) => ({ l, present: texts.has(l) }))
  }, clearLabels)
  for (const c of clearPresent) {
    record(`R4-${c.l}`, `clear key ${c.l} present`, c.present ? "pass" : "fail", c.present ? "" : "missing")
  }

  // R5: live expression display under main result
  const liveExpr = /currentExpression|live[-_ ]expression|expression-display|active.*operand|highlight/i.test(
    codeBundle,
  )
  record(
    "R5-live-expr",
    "live expression / current operand highlight",
    liveExpr ? "pass" : "warn",
    liveExpr ? "code refs found" : "no code reference; visual-only check pending",
  )

  // R6: history panel — exists, max 20, click-to-fill, clear-history
  const histRefs = {
    cap20:
      /(?:max|MAX|HISTORY_LIMIT|MAX_HISTORY)\s*[:=]\s*20|\.slice\(\s*-?20\s*\)|\.slice\(0,\s*20\s*\)|\.length\s*>\s*20|history.*20|20.*history/.test(
        codeBundle,
      ),
    clearHistory: /clear[_-]?history|clearHistory|清空历史/i.test(codeBundle),
    clickToFill: /history.*click|clickHistory|onHistoryClick|历史.*点击|click.*history/i.test(codeBundle),
    persist: /localStorage.*history|history.*localStorage/i.test(codeBundle),
  }
  record(
    "R6-cap20",
    "history cap = 20",
    histRefs.cap20 ? "pass" : "warn",
    histRefs.cap20 ? "" : "no obvious cap-20 in code; could still be there",
  )
  record("R6-clear", "clear history present", histRefs.clearHistory ? "pass" : "fail", "")
  record("R6-fillback", "click history to fill back", histRefs.clickToFill ? "pass" : "warn", "")
  record("R6-persist", "history persisted to localStorage", histRefs.persist ? "pass" : "warn", "")

  // R7: keyboard already exercised (R1).  Now confirm Escape clears.
  await pressKey("Escape").catch(() => {})
  await new Promise((r) => setTimeout(r, 200))
  const afterEsc = await readDisplay()
  record("R7-escape", "Escape acts as AC", /^0$|^$/.test(afterEsc) ? "pass" : "fail", `after Esc display="${afterEsc}"`)

  // R7b: backspace
  await typeKeys("123")
  await pressKey("Backspace")
  await new Promise((r) => setTimeout(r, 200))
  const afterBs = await readDisplay()
  record("R7-backspace", "Backspace removes one digit", /^12\b/.test(afterBs) ? "pass" : "fail", `display="${afterBs}"`)

  // R8: pressed-state visual feedback
  const pressedFeedback = /:active|pressed|btn--active|button-pressed|key-pressed|active\s*\{/i.test(codeBundle)
  record(
    "R8-pressed",
    "pressed-state visual feedback",
    pressedFeedback ? "pass" : "warn",
    "css :active or active class",
  )

  // R9: scientific notation > 12 digits
  await pressKey("Escape").catch(() => {})
  await typeKeys("1234567890123*9")
  await pressKey("Enter")
  await new Promise((r) => setTimeout(r, 300))
  const sci = await readDisplay()
  record(
    "R9-sci",
    "result switches to scientific notation when > 12 digits",
    /e\+?\d|E\+?\d/.test(sci) ? "pass" : "fail",
    `display="${sci}"`,
  )

  // R10: dark default + light theme toggle persisted
  const themeRefs = {
    toggle: /theme[-_]toggle|toggle[-_]theme|switch[-_]theme/i.test(codeBundle),
    storage: /localStorage.*theme|theme.*localStorage/i.test(codeBundle),
    darkClass: /\bdata-theme\b|\btheme-dark\b|\.dark\b|prefers-color-scheme/i.test(codeBundle),
  }
  record("R10-toggle", "theme toggle exists", themeRefs.toggle ? "pass" : "warn", "")
  record("R10-storage", "theme persisted to localStorage", themeRefs.storage ? "pass" : "warn", "")
  record("R10-dark-default", "dark theme as default", themeRefs.darkClass ? "pass" : "warn", "")
  // capture light-theme screenshot if a toggle is clickable
  const togglerSelectors = [
    "[data-testid=theme-toggle]",
    ".theme-toggle",
    "#theme-toggle",
    "button[aria-label*=theme i]",
    "button[aria-label*=主题 i]",
  ]
  let toggled = false
  for (const sel of togglerSelectors) {
    const ok = await page.$(sel)
    if (ok) {
      try {
        await ok.click()
        toggled = true
        break
      } catch {}
    }
  }
  if (!toggled)
    toggled =
      (await clickByText("☀️")) ||
      (await clickByText("🌙")) ||
      (await clickByText("Light")) ||
      (await clickByText("浅色"))
  await new Promise((r) => setTimeout(r, 300))
  await shot("04-after-theme-toggle.png")

  // R11: layout sanity — 4 columns, large monospace display, distinct operator color
  const layout = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, [role=button]"))
    const top = buttons.slice(0, 24).map((b) => ({
      text: (b.textContent || "").trim(),
      cs: (() => {
        const r = b.getBoundingClientRect()
        const cs = getComputedStyle(b as Element)
        return { x: r.x, y: r.y, w: r.width, h: r.height, bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily }
      })(),
    }))
    const display = document.querySelector(".display, #display, .calculator__display, .screen, .main-display, .result")
    const dcs = display ? getComputedStyle(display as Element) : null
    return {
      buttons: top,
      display: dcs ? { font: dcs.fontFamily, fontSize: dcs.fontSize, textAlign: dcs.textAlign } : null,
    }
  })
  await fs.writeFile(path.join(REPORT_DIR, "layout.json"), JSON.stringify(layout, null, 2))
  const xs = layout.buttons.map((b) => b.cs.x).filter((n) => Number.isFinite(n))
  const cols = new Set(xs.map((x) => Math.round(x / 8)))
  record(
    "R11-grid",
    "approximately 4-column grid",
    cols.size >= 3 && cols.size <= 6 ? "pass" : "warn",
    `unique x-buckets=${cols.size}`,
  )
  record(
    "R11-mono",
    "monospace font on display",
    /mono|courier|consolas|menlo/i.test(layout.display?.font || "") ? "pass" : "warn",
    `font=${layout.display?.font}`,
  )
  record(
    "R11-right-align",
    "display right-aligned",
    /right|end/i.test(layout.display?.textAlign || "") ? "pass" : "warn",
    `textAlign=${layout.display?.textAlign}`,
  )

  // R12: mobile 360px
  await page.setViewportSize({ width: 360, height: 720 })
  await page.reload({ waitUntil: "networkidle" })
  await new Promise((r) => setTimeout(r, 800))
  await shot("05-mobile-360.png")
  const mobileCheck = await page.evaluate(() => {
    const root = document.querySelector(
      ".calculator, .calc, .calculator-container, main, body > *",
    ) as HTMLElement | null
    return root
      ? { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, overflow: getComputedStyle(root).overflow }
      : null
  })
  record(
    "R12-mobile",
    "mobile 360px renders without horizontal scroll",
    mobileCheck && mobileCheck.scrollWidth <= 380 ? "pass" : "warn",
    JSON.stringify(mobileCheck),
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload({ waitUntil: "networkidle" })
  await new Promise((r) => setTimeout(r, 600))

  // R13: no lorem / no obvious placeholder text
  const visible = (await page.evaluate(() => document.body.innerText || "")) as string
  const placeholderHit = /lorem ipsum|TODO|FIXME|placeholder/i.test(visible)
  record(
    "R13-no-placeholder",
    "no lorem/TODO/placeholder visible",
    placeholderHit ? "fail" : "pass",
    placeholderHit ? "found in DOM" : "",
  )

  // R14/15/16: pure frontend, single entry, README
  const reactsHasBackend = /\b(server|express|koa|fastify|axios|fetch\(['"]https?:)/i.test(codeBundle)
  record(
    "R14-pure-frontend",
    "no backend / no external API",
    !reactsHasBackend || /https?:\/\/(localhost|127\.0\.0\.1)/.test(codeBundle) ? "pass" : "warn",
    "",
  )
  const hasIndexHtml = await fileExists(path.join(ROOT, "index.html"))
  const hasDist = await fileExists(path.join(ROOT, "dist", "index.html"))
  record(
    "R15-single-entry",
    "index.html as entry (or dist after build)",
    hasIndexHtml || hasDist ? "pass" : "fail",
    `index=${hasIndexHtml} dist=${hasDist}`,
  )
  const readmeHasRunInstructions = /(npm\s+(?:install|run\s+(?:dev|build|preview))|bun\s+run|yarn|pnpm)/i.test(readme)
  const readmeHasShortcuts = /(快捷键|shortcuts?|键盘|keyboard)/i.test(readme)
  record("R16-readme-run", "README has run instructions", readmeHasRunInstructions ? "pass" : "fail", "")
  record("R16-readme-shortcuts", "README documents keyboard shortcuts", readmeHasShortcuts ? "pass" : "warn", "")

  // Console errors are a hard fail per the spec.
  record(
    "R13-console",
    "no console errors / red text",
    consoleErrors.length === 0 ? "pass" : "fail",
    consoleErrors.slice(0, 5).join(" | "),
  )
}

// --- 5. tests / typecheck (best-effort) -----------------------------------
if (pkgJson.scripts?.["test:run"] || pkgJson.scripts?.test) {
  const r = await run("npm", ["run", pkgJson.scripts?.["test:run"] ? "test:run" : "test", "--", "--reporter=basic"], {
    timeoutMs: 180_000,
  })
  record("TESTS", "unit tests", r.code === 0 ? "pass" : "warn", `exit=${r.code}\n${(r.err || r.out).slice(-1500)}`)
} else record("TESTS", "unit tests", "skip", "no test script in package.json")

// --- 6. cleanup -----------------------------------------------------------
try {
  await browser?.close()
} catch {}
try {
  preview?.kill("SIGTERM")
  setTimeout(() => preview?.kill("SIGKILL"), 1500).unref()
} catch {}

// --- 7. report ------------------------------------------------------------
const passed = findings.filter((f) => f.status === "pass").length
const failed = findings.filter((f) => f.status === "fail").length
const warned = findings.filter((f) => f.status === "warn").length
const skipped = findings.filter((f) => f.status === "skip").length
const summary = { project: ROOT, baseURL, totals: { passed, failed, warned, skipped }, findings, consoleErrors }
await fs.writeFile(path.join(REPORT_DIR, "report.json"), JSON.stringify(summary, null, 2))

console.log(`\n[audit] ${passed} pass / ${failed} fail / ${warned} warn / ${skipped} skip`)
console.log(`[audit] report → ${REPORT_DIR}`)
process.exit(failed > 0 ? 1 : 0)
