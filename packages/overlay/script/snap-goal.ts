#!/usr/bin/env bun
/**
 * Open the overlay's Goal dialog and screenshot it.
 *
 * Mirrors snap-settings.ts — only needs the vite dev server (no daemon),
 * driving the dev-only `window.__OC_DEV__` hook to mount + open the goal
 * dialog. Seeds long title/acceptance text so any overflow / missing
 * scrollbar shows up in the capture.
 *
 * Usage:
 *   bun run script/snap-goal.ts <out.png> [w] [h] [theme]
 */

import { launchBrowser } from "../test/launch"
import path from "node:path"

const out = process.argv[2]
if (!out) {
  console.error("usage: bun run script/snap-goal.ts <out.png> [w] [h] [theme]")
  process.exit(2)
}
const w = Number(process.argv[3] ?? 1280)
const h = Number(process.argv[4] ?? 800)
const theme = process.argv[5] ?? "dark"

const LONG_TITLE =
  "Refactor the orchestrator dispatch layer so every sub-agent receives a fully-formed mission brief, and the goal acceptance contract is enforced before any executor session is allowed to start."
const LONG_ACCEPTANCE =
  "1. All orchestrator-spawned sub-agents receive a non-empty mission brief (no empty <input> XML blocks).\n2. The goal acceptance specs are validated against the Zod schema before execution.\n3. A regression test asserts the dispatcher constructs the brief, not the agent prompt.\n4. The build dashboard shows the goal transitioning queued -> running -> completed with no stuck states.\n5. No fallback / compatibility shims are introduced; old dispatch path is deleted.\n6. Typecheck + api:routes-check + docs:check all pass on pre-push."

const browser = await launchBrowser(["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
try {
  const page = await browser.newPage()
  await page.setViewportSize({ width: w, height: h })
  page.on("pageerror", (e) => console.error("[page-error]", e.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[console-error]", msg.text())
  })
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 15000 }).catch((e) => {
    console.error(`page.goto warning: ${e.message ?? e}`)
  })
  await page.evaluate((wantTheme) => {
    document.documentElement.setAttribute("data-theme", wantTheme)
    document.body.setAttribute("data-theme", wantTheme)
  }, theme)
  await new Promise((r) => setTimeout(r, 800))

  await page
    .waitForFunction(() => Boolean((window as any).__OC_DEV__?.openGoalDialog), {
      timeout: 8000,
    })
    .catch(() => console.error("__OC_DEV__ never appeared"))

  const opened = await page.evaluate(
    (args) => {
      try {
        const dev = (window as any).__OC_DEV__
        dev.ensureGoalHost()
        dev.openGoalDialog("goal_demo_01", args.title, args.acceptance)
        return "ok"
      } catch (e: any) {
        return "fail:" + (e?.message ?? String(e))
      }
    },
    { title: LONG_TITLE, acceptance: LONG_ACCEPTANCE },
  )
  console.log(`open path: ${opened}`)

  await page
    .waitForFunction(
      () => {
        const dlg = document.getElementById("goalDialog") as HTMLDialogElement | null
        return dlg?.open === true
      },
      { timeout: 4000 },
    )
    .catch(async () => {
      const diag = await page.evaluate(() => {
        const dlg = document.getElementById("goalDialog") as HTMLDialogElement | null
        return { present: Boolean(dlg), open: dlg?.open ?? null }
      })
      console.error("dialog did not open:", diag)
    })
  await new Promise((r) => setTimeout(r, 500))

  const measure = await page.evaluate(() => {
    const dlg = document.getElementById("goalDialog") as HTMLElement | null
    const form = dlg?.querySelector(".dialog-form") as HTMLElement | null
    const goalForm = dlg?.querySelector(".goal-dialog-form") as HTMLElement | null
    const m = (el: HTMLElement | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        overflowY: cs.overflowY,
        maxH: cs.maxHeight,
      }
    }
    const acc = dlg?.querySelector("#goalCriteria") as HTMLTextAreaElement | null
    return {
      dialogForm: m(form),
      goalForm: m(goalForm),
      acceptance: m(acc),
      acceptanceOverflows: acc ? acc.scrollHeight > acc.clientHeight : null,
      acceptanceScrollbarPx: acc ? acc.offsetWidth - acc.clientWidth : null,
      formScrolls: form ? form.scrollHeight > form.clientHeight : null,
      viewportH: window.innerHeight,
    }
  })
  console.log("measure:", JSON.stringify(measure, null, 2))

  const abs = path.resolve(out)
  await page.screenshot({ path: abs as `${string}.png`, fullPage: false })
  console.log(`screenshot → ${abs}`)
} finally {
  await browser.close()
}
