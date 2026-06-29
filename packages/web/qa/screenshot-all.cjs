#!/usr/bin/env node
/* eslint-disable */
const PW_PATH = require("node:path").join(
  __dirname,
  "..",
  "..",
  "..",
  "node_modules",
  ".bun",
  "playwright-core@1.59.1",
  "node_modules",
  "playwright-core",
)
const { chromium } = require(PW_PATH)
const { readdirSync, statSync, mkdirSync } = require("node:fs")
const { join, relative } = require("node:path")

const BASE = "http://localhost:4321/docs"
const ROOT = join(__dirname, "..", "src", "content", "docs")
const OUT = join(__dirname, "screenshots")
mkdirSync(OUT, { recursive: true })

function listMdx(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listMdx(full))
    else if (name.endsWith(".mdx")) out.push(full)
  }
  return out
}

function fileToUrl(absPath) {
  let rel = relative(ROOT, absPath)
    .replace(/\\/g, "/")
    .replace(/\.mdx$/, "")
  if (rel === "index") return `${BASE}/`
  if (rel === "zh-cn/index") return `${BASE}/zh-cn/`
  return `${BASE}/${rel}/`
}

function urlToSlug(url) {
  const tail = url.replace(BASE, "").replace(/^\//, "").replace(/\/$/, "")
  return (tail || "_root").replace(/\//g, "__")
}

function docsActivityLabel(event, payload) {
  if (payload && typeof payload.url === "function") return `${event} ${payload.url()}`
  if (payload && typeof payload.message === "function") return `${event} ${payload.message()}`
  if (payload && typeof payload.text === "function") return `${event} ${payload.text()}`
  if (payload && typeof payload.errorText === "string") return `${event} ${payload.errorText}`
  return event
}

async function withDocsBrowserInactivity(page, label, inactivityTimeoutMs, action) {
  let settled = false
  let lastActivity = "start"
  let timer
  let rejectInactive
  const listeners = []
  const inactive = new Promise((_, reject) => {
    rejectInactive = reject
  })
  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  const reset = (source) => {
    if (settled) return
    lastActivity = source
    clearTimer()
    timer = setTimeout(() => {
      rejectInactive(new Error(`${label} browser inactive for ${inactivityTimeoutMs}ms after ${lastActivity}`))
    }, inactivityTimeoutMs)
  }
  const fail = (source) => {
    if (settled) return
    lastActivity = source
    clearTimer()
    rejectInactive(new Error(`${label} browser failure before screenshot: ${source}`))
  }
  const on = (event, handler) => {
    page.on(event, handler)
    listeners.push([event, handler])
  }
  on("console", (payload) => reset(docsActivityLabel("console", payload)))
  on("response", (payload) => {
    const status = typeof payload.status === "function" ? payload.status() : 0
    if (status >= 400) {
      fail(`${docsActivityLabel("response", payload)} HTTP ${status}`)
      return
    }
    reset(docsActivityLabel("response", payload))
  })
  on("requestfailed", (payload) => fail(docsActivityLabel("requestfailed", payload)))
  on("pageerror", (payload) => fail(docsActivityLabel("pageerror", payload)))
  reset("start")
  try {
    return await Promise.race([action(), inactive])
  } finally {
    settled = true
    clearTimer()
    for (const [event, handler] of listeners) page.off(event, handler)
  }
}

;(async () => {
  const files = listMdx(ROOT).sort()
  console.log(`pages to screenshot: ${files.length}`)

  const exePath = process.env.LOCALAPPDATA + "\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe"
  const browser = await chromium.launch({ executablePath: exePath, headless: true, args: ["--no-sandbox"] })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  const errors = []
  let ok = 0
  for (const f of files) {
    const url = fileToUrl(f)
    const slug = urlToSlug(url)
    try {
      const resp = await withDocsBrowserInactivity(page, `goto ${url}`, 30_000, () =>
        page.goto(url, { waitUntil: "domcontentloaded", timeout: 0 }),
      )
      if (!resp || resp.status() >= 400) {
        errors.push({ url, reason: `HTTP ${resp ? resp.status() : "no-resp"}` })
        console.log(`FAIL ${resp ? resp.status() : "??"} ${url}`)
        continue
      }
      await withDocsBrowserInactivity(page, `networkidle ${url}`, 5_000, () =>
        page.waitForLoadState("networkidle", { timeout: 0 }),
      )
      // Cap height at 1800 to stay under the 2000px viewer limit; no fullPage.
      await page.setViewportSize({ width: 1440, height: 1800 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: join(OUT, `${slug}.png`), fullPage: false })
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
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
