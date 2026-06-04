import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { BrowserRuntime } from "../../../src/browser/runtime"
import {
  captureWebpageRuntimeStateEvidence,
  deriveRuntimeStateObservations,
  type RuntimeStateSnapshot,
} from "../../../src/browser/webpage/runtime-state"

describe("runtime-state evidence", () => {
  const originalLaunch = BrowserRuntime.launchPlaywrightBrowserInNodeProcess

  afterEach(() => {
    ;(BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }).launchPlaywrightBrowserInNodeProcess = originalLaunch
  })

  test("captures interaction states through Node sidecar without Bun Playwright launch", async () => {
    const dir = path.join(os.tmpdir(), `runtime-state-sidecar-${process.pid}-${Date.now()}`)
    await fs.mkdir(dir, { recursive: true })
    const html = path.join(dir, "index.html")
    await fs.writeFile(
      html,
      `<!doctype html><html><body style="margin:0">
        <nav style="position:sticky;top:0;background:white">
          <a href="#a">Markets</a><a href="#b">Calendar</a><a href="#c">News</a>
        </nav>
        <main style="height:1800px;padding-top:20px"><button>Open economy panel</button></main>
      </body></html>`,
      "utf8",
    )
    let launchCount = 0
    ;(BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }).launchPlaywrightBrowserInNodeProcess = async () => {
      launchCount++
      throw new Error("runtime-state must not use Bun Playwright launch")
    }

    try {
      const evidence = await captureWebpageRuntimeStateEvidence({
        url: pathToFileURL(html).href,
        outputDir: dir,
        viewport: { width: 360, height: 240 },
      })

      expect(launchCount).toBe(0)
      expect(evidence.source.captureEngine).toBe("playwright")
      expect(evidence.snapshots.map((snapshot) => snapshot.id)).toEqual(["initial", "scroll-25", "scroll-50", "scroll-75"])
      for (const snapshot of evidence.snapshots) {
        const stat = await fs.stat(path.join(dir, snapshot.screenshot))
        expect(stat.size).toBeGreaterThan(0)
      }
      const persisted = JSON.parse(await fs.readFile(path.join(dir, "source-ir", "interaction-state-snapshots.json"), "utf8"))
      expect(persisted.snapshots).toHaveLength(4)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 90_000)

  test("does not require networkidle for runtime-state navigation", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../../src/browser/webpage/runtime-state.ts"), "utf8")

    expect(source).toContain('waitUntil: "domcontentloaded"')
    expect(source).not.toContain('page.goto(input.url, { waitUntil: "networkidle"')
  })

  test("identifies viewport-persistent tab evidence across scroll snapshots", () => {
    const snapshots: RuntimeStateSnapshot[] = [
      snapshot("initial", 0, 148, 148),
      snapshot("scroll-50", 640, 148, 788),
    ]

    const observations = deriveRuntimeStateObservations(snapshots)

    expect(observations).toContainEqual(expect.objectContaining({
      kind: "persistent-viewport-position",
      elementKey: "tab:overview countries ideas",
      viewportYRange: { min: 148, max: 148 },
      documentYRange: { min: 148, max: 788 },
    }))
  })
})

function snapshot(id: string, scrollY: number, viewportY: number, documentY: number): RuntimeStateSnapshot {
  return {
    id,
    label: id,
    scrollY,
    viewport: { width: 1440, height: 900 },
    documentHeight: 2000,
    screenshot: `interaction-states/${id}.png`,
    interactiveElements: [{
      index: 0,
      selector: "nav.tabs",
      tag: "nav",
      role: "tab",
      text: "Overview Countries Ideas",
      bounds: { x: 40, y: viewportY, w: 900, h: 40 },
      documentBounds: { x: 40, y: documentY, w: 900, h: 40 },
      styles: {
        display: "flex",
        position: "sticky",
        top: "64px",
        zIndex: "10",
        backgroundColor: "rgb(255, 255, 255)",
        border: "0px none rgb(0, 0, 0)",
        boxShadow: "none",
        color: "rgb(19, 23, 34)",
        fontSize: "14px",
        fontWeight: "600",
      },
      classes: ["tabs"],
    }],
    persistentElements: [],
    navigationClusters: [],
  }
}
