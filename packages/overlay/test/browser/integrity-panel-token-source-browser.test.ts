import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")

function readCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", rel), "utf8")
}

function overlayStyleHrefs(): string[] {
  const html = readFileSync(join(OVERLAY_ROOT, "src/index.html"), "utf8")
  const hrefs = Array.from(html.matchAll(/<link\s+rel="stylesheet"\s+href="styles\/([^"]+)"/g), (match) => match[1])
  if (hrefs.length === 0) throw new Error("No overlay stylesheet links found in src/index.html")
  return hrefs
}

const OVERLAY_STYLE_HREFS = overlayStyleHrefs()

function overlayCss(): string {
  return OVERLAY_STYLE_HREFS.map(readCss).join("\n")
}

function scratchPath(name: string): string {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  return target
}

test("Integrity panel chrome resolves canonical tokens on a light surface", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 760 })
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            ${overlayCss()}
            :root { --ui-scale: 1; }
            body {
              min-height: 100vh;
              margin: 0;
              padding: 24px;
              background: rgb(255, 255, 255);
              color: var(--text);
              font-family: var(--font);
            }
            .integrity-fixture {
              width: 620px;
              padding: 16px;
              background: var(--surface);
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="integrity-fixture" aria-label="Integrity token source fixture">
            <section class="integrity">
              <header class="integrity__header">
                <span class="verdict-pill" data-verdict="concerns">concerns</span>
                <span class="integrity__attempts">attempt 2</span>
              </header>
              <p class="integrity__summary">Reviewers found one visual concern and one missing keyboard proof.</p>
              <pre class="integrity__report" data-sample="standalone-report">standalone report: chrome must resolve on white surfaces</pre>
              <details class="integrity__report-detail" open>
                <summary class="integrity__report-summary">
                  <span>Consensus report</span>
                  <span class="integrity__report-meta">2 reviewers</span>
                </summary>
                <pre class="integrity__report">requirement: keyboard focus remains visible
evidence: screenshot and computed styles attached
result: concern until verified</pre>
              </details>
              <ul class="integrity__reviewer-list">
                <li class="integrity__reviewer" data-verdict="needs_correction">
                  <div class="integrity__reviewer-head">
                    <span class="verdict-pill" data-verdict="needs_correction">needs correction</span>
                    <span class="integrity__reviewer-title">
                      <span class="integrity__reviewer-name">GUI reviewer</span>
                      <span class="integrity__reviewer-scope">overlay integrity panel</span>
                    </span>
                  </div>
                  <p class="integrity__reviewer-summary">The report chrome must stay readable on white surfaces.</p>
                  <div class="integrity__reviewer-meta">
                    <span class="oc-badge" data-tone="neutral" data-size="sm" data-ui="integrity-reviewer-chip">1 finding</span>
                    <span class="oc-badge" data-tone="warn" data-size="sm" data-ui="integrity-reviewer-chip">1 question</span>
                  </div>
                  <div class="integrity__manifest-meta">
                    <span>browser screenshot</span>
                    <span>light theme</span>
                  </div>
                </li>
              </ul>
              <ul class="integrity__list">
                <li class="integrity__issue" data-type="blocking">
                  <span class="oc-badge" data-tone="bad" data-size="sm" data-ui="integrity-issue-tag">blocking</span>
                  <div class="integrity__issue-body">
                    <div class="integrity__issue-desc">
                      <span class="integrity__issue-title">White surface contrast</span>
                      <span>Private chip chrome must not return.</span>
                    </div>
                  </div>
                </li>
                <li class="integrity__correction">
                  <div class="integrity__correction-head">
                    <span class="oc-badge" data-tone="neutral" data-size="sm" data-ui="integrity-repair-tag">repair-1</span>
                    <span class="integrity__correction-reason">Use the shared Badge primitive.</span>
                  </div>
                </li>
              </ul>
            </section>
          </main>
        </body>
      </html>
    `)

    const metrics = await page.evaluate(() => {
      const sample = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) throw new Error(`missing ${selector}`)
        const style = getComputedStyle(node)
        return {
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          borderRadius: style.borderTopLeftRadius,
        }
      }
      return {
        report: sample('[data-sample="standalone-report"]'),
        detail: sample(".integrity__report-detail"),
        reviewer: sample(".integrity__reviewer"),
        manifest: sample(".integrity__manifest-meta span"),
        badge: sample('.oc-badge[data-ui="integrity-issue-tag"]'),
        retiredBadgePresent:
          document.querySelector(".integrity__reviewer-chip") !== null ||
          document.querySelector(".integrity__tag") !== null,
      }
    })

    const { retiredBadgePresent, ...chromeMetrics } = metrics
    for (const [name, metric] of Object.entries(chromeMetrics)) {
      if (name !== "reviewer") {
        assert.notEqual(metric.backgroundColor, "rgba(0, 0, 0, 0)", `${name} background should resolve`)
      }
      assert.equal(metric.borderTopStyle, "solid", `${name} border style should resolve`)
      assert.notEqual(metric.borderTopWidth, "0px", `${name} border width should resolve`)
      assert.notEqual(metric.borderTopColor, "rgba(0, 0, 0, 0)", `${name} border color should resolve`)
      assert.notEqual(metric.borderRadius, "0px", `${name} radius should resolve`)
    }

    assert.equal(retiredBadgePresent, false)

    const fixture = await page.$(".integrity-fixture")
    assert.ok(fixture)
    writeFileSync(scratchPath("integrity-panel-token-source-light.png"), await fixture.screenshot({}))
  } finally {
    await browser.close()
  }
})
