#!/usr/bin/env bun
// Pull computed styles / layout of the first few cards to diagnose why
// titles / bodies don't render in the fixture.

import path from "node:path"
import { launchBrowser } from "./launch"

const fixtureURL =
  "file:///" +
  path.resolve(new URL("./card-visual.html", import.meta.url).pathname.replace(/^\/+/, "")).replace(/\\/g, "/")

const browser = await launchBrowser(["--no-sandbox"], { headless: false })
const page = await browser.newPage()
await page.setViewportSize({ width: 900, height: 1400 })
await page.goto(fixtureURL, { waitUntil: "load" })
await new Promise((r) => setTimeout(r, 300))

const report = await page.evaluate(() => {
  function pick(el: Element | null, keys: string[]) {
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = (el as HTMLElement).getBoundingClientRect()
    const obj: any = {
      tag: el.tagName,
      class: (el as HTMLElement).className,
      rect: { w: r.width, h: r.height },
      text: (el as HTMLElement).innerText?.slice(0, 40),
    }
    for (const k of keys) obj[k] = cs.getPropertyValue(k)
    return obj
  }
  const cards = Array.from(document.querySelectorAll(".card")).slice(0, 8)
  const rootCS = getComputedStyle(document.documentElement)
  const bodyCS = getComputedStyle(document.body)
  return {
    tokens: {
      "--ui-scale": rootCS.getPropertyValue("--ui-scale") || "(unset)",
      "--ui-font-body": rootCS.getPropertyValue("--ui-font-body"),
      "--text-strong": rootCS.getPropertyValue("--text-strong"),
      "--card-bg-0": rootCS.getPropertyValue("--card-bg-0"),
      "--card-border": rootCS.getPropertyValue("--card-border"),
      "--card-pad-y": rootCS.getPropertyValue("--card-pad-y"),
      bodyBg: bodyCS.backgroundColor,
      bodyColor: bodyCS.color,
    },
    cards: cards.map((c, i) => ({
      i,
      dataKind: (c as HTMLElement).dataset.kind,
      dataDepth: (c as HTMLElement).dataset.depth,
      card: pick(c, ["background-color", "border", "border-left", "display"]),
      head: pick(c.querySelector(".card__head"), ["background-color", "color", "display", "padding", "font-size"]),
      title: pick(c.querySelector(".card__title"), ["color", "font-size", "display", "visibility", "opacity", "width"]),
      badge: pick(c.querySelector(".card__badge"), ["background-color", "width", "height", "color"]),
      body: pick(c.querySelector(".card__body"), ["display", "padding", "overflow", "max-height", "height"]),
    })),
  }
})

console.log(JSON.stringify(report, null, 2))
await browser.close()
