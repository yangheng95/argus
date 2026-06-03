#!/usr/bin/env bun
/**
 * Open the overlay's Config & Settings dialog and screenshot it.
 *
 * Used during the 2026-05-06 dialog-density refactor to compare
 * before/after CSS changes side-by-side. Only assumes the vite dev
 * server is up (no daemon needed — the dialog renders even without
 * tasks data, just with empty provider lists).
 *
 * Usage:
 *   bun run script/snap-settings.ts <out.png> [tab] [w] [h]
 *
 * tab: general | permissions | prompt | channelConfig | tools | memory
 *      | providers | agentModels | about    (default: providers)
 */

import { findBrowserExecutable } from "../../opencorvus/src/acceptance/checks/visual"
import puppeteer from "puppeteer-core"
import path from "node:path"

const out = process.argv[2]
if (!out) {
  console.error("usage: bun run script/snap-settings.ts <out.png> [tab] [w] [h]")
  process.exit(2)
}
const tab = process.argv[3] ?? "providers"
const w = Number(process.argv[4] ?? 1280)
const h = Number(process.argv[5] ?? 800)

const exe = await findBrowserExecutable()
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  page.on("pageerror", (e) => console.error("[page-error]", e.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[console-error]", msg.text())
  })
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle2", timeout: 15000 }).catch((e) => {
    console.error(`page.goto warning: ${e.message ?? e}`)
  })
  await new Promise((r) => setTimeout(r, 800))

  // Open the config dialog by reaching into the dev module graph.
  // dialog.ts attaches `openConfigDialog` to the module namespace; vite
  // dev exposes those via `window.__OPENCORVUS_DEV__` if anything wired
  // it up, otherwise we drive the store directly.
  // Wait for the dev hook (main.tsx exposes `window.__OC_DEV__` once
  // module load finishes — independent of `initApp()`, which blocks on
  // the daemon connection). `ensureConfigHost` mounts the dialog host
  // ourselves so the open() call has somewhere to render to.
  await page.waitForFunction(() => Boolean((window as any).__OC_DEV__?.openConfigDialog), {
    timeout: 8000,
  }).catch(() => console.error("__OC_DEV__ never appeared"))
  const opened = await page.evaluate((wantTab) => {
    try {
      const dev = (window as any).__OC_DEV__
      dev.ensureConfigHost()
      dev.openConfigDialog(wantTab)
      return "ok"
    } catch (e: any) {
      return "fail:" + (e?.message ?? String(e))
    }
  }, tab)
  console.log(`open path: ${opened}`)

  // Wait long enough for Solid's createEffect → dialog.showModal() to flush.
  await page.waitForFunction(() => {
    const dlg = document.getElementById("configDialog") as HTMLDialogElement | null
    return dlg?.open === true
  }, { timeout: 4000 }).catch(async () => {
    const diag = await page.evaluate(() => {
      const dlg = document.getElementById("configDialog") as HTMLDialogElement | null
      return {
        present: Boolean(dlg),
        open: dlg?.open ?? null,
        outerLen: dlg?.outerHTML?.length ?? 0,
      }
    })
    console.error("dialog did not open:", diag)
  })
  await new Promise((r) => setTimeout(r, 600))

  const measure = await page.evaluate(() => {
    const dlg = document.getElementById("configDialog")
    const q = (sel: string) => dlg?.querySelector(sel) as HTMLElement | null
    const get = (el: HTMLElement | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        styleH: cs.height,
        minH: cs.minHeight,
        maxH: cs.maxHeight,
        flexBasis: cs.flexBasis,
        flexGrow: cs.flexGrow,
        position: cs.position,
        display: cs.display,
        overflow: cs.overflow,
      }
    }
    const formEl = dlg?.querySelector(".dialog-form") as HTMLElement | null
    const formChildren = formEl
      ? Array.from(formEl.children).map((c) => {
          const r = c.getBoundingClientRect()
          return {
            tag: c.tagName.toLowerCase(),
            cls: (c as HTMLElement).className,
            h: Math.round(r.height),
            top: Math.round(r.top),
            visible: getComputedStyle(c as HTMLElement).display !== "none",
          }
        })
      : []
    const formScrollHeight = formEl?.scrollHeight ?? 0
    return {
      dialog: get(dlg as HTMLElement | null),
      form: get(formEl),
      formChildren,
      formScrollHeight,
      header: get(dlg?.querySelector(".dialog-header,.dialog-head") as HTMLElement | null),
      layout: get(q(".config-dialog-layout")),
      sidebar: get(q(".config-sidebar")),
      content: get(q(".config-content")),
    }
  })
  console.log("measure:", JSON.stringify(measure))
  const html = await page.evaluate(() => {
    const f = document.getElementById("configDialog")?.querySelector(".dialog-form")
    return (f?.outerHTML ?? "").slice(0, 800)
  })
  console.log("form outerHTML head:", html)
  const abs = path.resolve(out)
  await page.screenshot({ path: abs as `${string}.png`, fullPage: false })
  console.log(`screenshot → ${abs}`)
} finally {
  await browser.close()
}
