/**
 * QA: render every doc URL in headless Chromium and save a full-page PNG.
 * Outputs to packages/web/qa/screenshots/<slug>.png.
 *
 * Run with: bun run packages/web/qa/screenshot-all.ts
 *
 * Requires the dev server already running at http://localhost:4321/docs
 * (so HMR + Vite-served sources resolve correctly).
 */
import { chromium } from "@playwright/test"
import { readdirSync, statSync, mkdirSync } from "node:fs"
import { join, relative } from "node:path"

const BASE = "http://localhost:4321/docs"
const ROOT = join(import.meta.dir, "..", "src", "content", "docs")
const OUT = join(import.meta.dir, "screenshots")
mkdirSync(OUT, { recursive: true })

function listMdx(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listMdx(full))
    else if (name.endsWith(".mdx")) out.push(full)
  }
  return out
}

function fileToUrl(absPath: string): string {
  let rel = relative(ROOT, absPath).replace(/\\/g, "/").replace(/\.mdx$/, "")
  if (rel === "index") return `${BASE}/`
  if (rel === "zh-cn/index") return `${BASE}/zh-cn/`
  return `${BASE}/${rel}/`
}

function urlToSlug(url: string): string {
  const tail = url.replace(BASE, "").replace(/^\//, "").replace(/\/$/, "")
  return (tail || "_root").replace(/\//g, "__")
}

const files = listMdx(ROOT).sort()
console.log(`pages to screenshot: ${files.length}`)

const exePath = process.env.LOCALAPPDATA + "\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe"
const browser = await chromium.launch({ executablePath: exePath, headless: true, args: ["--no-sandbox"] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const errors: { url: string; reason: string }[] = []
let ok = 0

for (const f of files) {
  const url = fileToUrl(f)
  const slug = urlToSlug(url)
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })
    if (!resp || resp.status() >= 400) {
      errors.push({ url, reason: `HTTP ${resp?.status() ?? "no-resp"}` })
      console.log(`FAIL ${resp?.status() ?? "??"} ${url}`)
      continue
    }
    await page.waitForLoadState("domcontentloaded")
    await page.screenshot({ path: join(OUT, `${slug}.png`), fullPage: true })
    ok++
    if (ok % 10 === 0) console.log(`ok ${ok}/${files.length}`)
  } catch (e) {
    errors.push({ url, reason: String(e).slice(0, 200) })
    console.log(`ERR ${url}: ${String(e).slice(0, 120)}`)
  }
}

await browser.close()
console.log(`\nDone. ok=${ok} errors=${errors.length}`)
if (errors.length) {
  console.log("\n--- ERRORS ---")
  for (const e of errors) console.log(`${e.url} :: ${e.reason}`)
  process.exit(1)
}
