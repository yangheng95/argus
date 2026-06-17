/**
 * Pins the three fixes that close the form-control theme leak observed
 * 2026-05-06 — settings dialog rendering input fields with a bright UA
 * widget on top of the dark surface tokens.
 *
 *   1. `.dialog` must declare `color-scheme: inherit`. Kobalte portals
 *      dialog content into the document body; Chromium has historically
 *      dropped the body's `color-scheme` for modal form controls, leaving
 *      inputs / scrollbars / autofill with the light UA chrome regardless
 *      of theme.
 *
 *   2. `.field-input` must declare `appearance: none` (and the WebKit
 *      prefix). Without it the UA control widget paints over the
 *      `var(--surface-inset)` background and the input shows up white
 *      on dark surfaces.
 *
 *   3. `accent-color: var(--accent)` must be declared exactly once at
 *      `body{}` scope in `tokens/design-language.css` — surface CSS
 *      used to copy the same declaration into half a dozen places
 *      (rule 9 single source). Per-surface duplicates are forbidden:
 *      if a future component needs a different accent the right move
 *      is a token override, not another `accent-color: var(--accent)`.
 */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles")

function readCss(rel: string): string {
  return readFileSync(join(STYLES_ROOT, rel), "utf8")
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

function* walkCss(root: string): Iterable<string> {
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry)
    if (statSync(abs).isDirectory()) yield* walkCss(abs)
    else if (entry.endsWith(".css")) yield abs
  }
}

describe("dialog top-layer color-scheme inheritance", () => {
  const dialogCss = stripComments(readCss(join("surfaces", "dialog.css")))

  test(".dialog declares color-scheme: inherit", () => {
    const block = dialogCss.match(/\.dialog\s*{[^}]*}/)?.[0] ?? ""
    expect(block).toMatch(/color-scheme\s*:\s*inherit/)
  })
})

describe(".field-input strips UA widget chrome", () => {
  const fieldCss = stripComments(readCss(join("surfaces", "field.css")))

  test(".field-input sets appearance: none", () => {
    const block = fieldCss.match(/\.field-input\s*{[^}]*}/)?.[0] ?? ""
    expect(block).toMatch(/(^|\s)appearance\s*:\s*none/)
    expect(block).toMatch(/-webkit-appearance\s*:\s*none/)
  })

  test("autofill override pins the surface-inset background", () => {
    expect(fieldCss).toMatch(/:-webkit-autofill[\s\S]*?box-shadow[^;]*var\(--surface-inset\)[^;]*inset[^;]*!important/)
  })

  test("search and number sub-controls also strip UA chrome", () => {
    expect(fieldCss).toMatch(/-webkit-search-cancel-button[\s\S]*?appearance\s*:\s*none/)
    expect(fieldCss).toMatch(/-webkit-(?:inner|outer)-spin-button[\s\S]*?-webkit-appearance\s*:\s*none/)
  })
})

describe("shared Kobalte select popup colors", () => {
  const fieldCss = stripComments(readCss(join("surfaces", "field.css")))
  const composerCss = stripComments(readCss(join("surfaces", "composer.css")))
  const inspectorCss = stripComments(readCss(join("surfaces", "inspector.css")))
  const settingsCss = stripComments(readCss(join("surfaces", "settings.css")))
  const browserPreviewPanel = readFileSync(
    join(import.meta.dir, "..", "src", "components", "BrowserPreviewPanel.tsx"),
    "utf8",
  )
  const logViewer = readFileSync(join(import.meta.dir, "..", "src", "components", "LogViewer.tsx"), "utf8")

  test(".oc-select content and options use readable foreground tokens", () => {
    const contentBlock = fieldCss.match(/\.oc-select-content\s*{[^}]*}/)?.[0] ?? ""
    const optionBlock = fieldCss.match(/\.oc-select-option\s*{[^}]*}/)?.[0] ?? ""
    const secondaryBlock = fieldCss.match(/\.oc-select-option\s+small\s*{[^}]*}/)?.[0] ?? ""

    expect(contentBlock).toMatch(/background\s*:\s*var\(--surface\)/)
    expect(contentBlock).toMatch(/color\s*:\s*var\(--text-strong\)/)
    expect(optionBlock).toMatch(/color\s*:\s*var\(--text-strong\)/)
    expect(secondaryBlock).toMatch(/color\s*:\s*var\(--text-soft\)/)
    expect(secondaryBlock).not.toMatch(/var\(--text-muted\)/)
  })

  test("prompt profile option descriptions inherit the shared popup foreground", () => {
    const promptProfileDescriptionBlock =
      composerCss.match(/\.prompt-profile-select-option-copy\s+small\s*{[^}]*}/)?.[0] ?? ""

    expect(promptProfileDescriptionBlock).not.toMatch(/color\s*:/)
  })

  test("browser preview candidate dropdown uses the shared select popup colors", () => {
    expect(browserPreviewPanel).toContain('class="oc-select-content browser-preview-candidate-content"')
    expect(browserPreviewPanel).toContain('class="oc-select-listbox browser-preview-candidate-listbox"')
    expect(browserPreviewPanel).toContain('class="oc-select-option browser-preview-candidate-option"')
    expect(browserPreviewPanel).toContain('class="oc-select-indicator browser-preview-candidate-indicator"')

    const candidateContentBlock = inspectorCss.match(/\.browser-preview-candidate-content\s*{[^}]*}/)?.[0] ?? ""
    const candidateOptionBlock = inspectorCss.match(/\.browser-preview-candidate-option\s*{[^}]*}/)?.[0] ?? ""

    expect(candidateContentBlock).not.toMatch(/background\s*:/)
    expect(candidateContentBlock).not.toMatch(/color\s*:/)
    expect(candidateOptionBlock).not.toMatch(/color\s*:/)
    expect(candidateOptionBlock).not.toMatch(/background\s*:/)
  })

  test("log viewer level dropdown uses the shared Select trigger chrome", () => {
    expect(logViewer).toContain('class="field-input oc-select-trigger log-level-select-trigger"')

    expect(settingsCss).not.toContain(".log-level-select {")
    expect(settingsCss).not.toContain(".log-level-select:focus")
  })
})

describe("accent-color is declared once globally", () => {
  test("design-language body{} block carries the canonical accent-color", () => {
    const css = stripComments(readCss(join("tokens", "design-language.css")))
    const bodyBlock = css.match(/(^|\s)body\s*{[\s\S]*?}/)?.[0] ?? ""
    expect(bodyBlock).toMatch(/accent-color\s*:\s*var\(--accent\)/)
  })

  test("no surface CSS re-declares accent-color: var(--accent)", () => {
    const offenders: string[] = []
    for (const file of walkCss(STYLES_ROOT)) {
      if (file.endsWith(join("tokens", "design-language.css"))) continue
      const body = stripComments(readFileSync(file, "utf8"))
      if (/accent-color\s*:\s*var\(--accent\)/.test(body)) {
        offenders.push(file.replace(STYLES_ROOT, "<styles>"))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("frontend preview iframe shell is fully removed", () => {
  test("inspector surface no longer carries the frontend-preview rule family", () => {
    const css = stripComments(readCss(join("surfaces", "inspector.css")))
    expect(css).not.toMatch(/\.frontend-preview-frame\s*{/)
    expect(css).not.toMatch(/\.frontend-preview\s*{/)
  })
})
