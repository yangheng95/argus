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
import { join, relative } from "node:path"

const SRC_ROOT = join(import.meta.dir, "..", "src")
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

function* walkTsx(root: string): Iterable<string> {
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry)
    if (statSync(abs).isDirectory()) yield* walkTsx(abs)
    else if (entry.endsWith(".tsx")) yield abs
  }
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length
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
  const selectControl = readFileSync(
    join(import.meta.dir, "..", "src", "components", "ui", "SelectControl.tsx"),
    "utf8",
  )
  const browserPreviewPanel = readFileSync(
    join(import.meta.dir, "..", "src", "components", "BrowserPreviewPanel.tsx"),
    "utf8",
  )
  const logViewer = readFileSync(join(import.meta.dir, "..", "src", "components", "LogViewer.tsx"), "utf8")
  const appDialogHost = readFileSync(join(import.meta.dir, "..", "src", "components", "AppDialogHost.tsx"), "utf8")

  test(".oc-select content and options use readable foreground tokens", () => {
    const contentBlock = fieldCss.match(/\.oc-select-content\s*{[^}]*}/)?.[0] ?? ""
    const optionBlock = fieldCss.match(/\.oc-select-option\s*{[^}]*}/)?.[0] ?? ""
    const selectedOptionBlock = fieldCss.match(/\.oc-select-option\[data-selected\]\s*{[^}]*}/)?.[0] ?? ""
    const highlightedOptionBlock =
      fieldCss.match(/\.oc-select-option\[data-highlighted\],[\s\S]*?\.oc-select-option:hover\s*{[^}]*}/)?.[0] ?? ""
    const secondaryBlock = fieldCss.match(/\.oc-select-option\s+small\s*{[^}]*}/)?.[0] ?? ""
    const optionCopyBlock = fieldCss.match(/\.oc-select-option-copy\s*{[^}]*}/)?.[0] ?? ""

    expect(contentBlock).toMatch(/background\s*:\s*var\(--menu-panel-bg\)/)
    expect(contentBlock).toMatch(/z-index\s*:\s*calc\(var\(--ui-z-dialog\)\s*\+\s*1\)/)
    expect(contentBlock).not.toMatch(/background\s*:\s*var\(--surface\)/)
    expect(contentBlock).toMatch(/color\s*:\s*var\(--text-strong\)/)
    expect(optionBlock).toMatch(/color\s*:\s*var\(--text-strong\)/)
    expect(selectedOptionBlock).toMatch(/background\s*:\s*var\(--accent-dim\)/)
    expect(selectedOptionBlock).toMatch(/color\s*:\s*var\(--text-strong\)/)
    expect(highlightedOptionBlock).toMatch(/background\s*:\s*var\(--surface-hover\)/)
    expect(secondaryBlock).toMatch(/color\s*:\s*var\(--text-soft\)/)
    expect(secondaryBlock).not.toMatch(/var\(--text-muted\)/)
    expect(optionCopyBlock).toMatch(/flex-direction\s*:\s*column/)
    expect(optionCopyBlock).not.toMatch(/color\s*:/)
  })

  test("SelectControl composes the shared select class family", () => {
    expect(selectControl).toContain('withClass("oc-select-trigger", props.triggerClass)')
    expect(selectControl).toContain('withClass("oc-select-content", props.contentClass)')
    expect(selectControl).toContain('withClass("oc-select-listbox", props.listboxClass)')
    expect(selectControl).toContain('withClass("oc-select-option", props.optionClass)')
    expect(selectControl).toContain('withClass("oc-select-indicator", props.indicatorClass)')
  })

  test("expert squad option descriptions inherit the shared popup foreground", () => {
    const expertSquadDescriptionBlock =
      composerCss.match(/\.expert-squad-select-option-copy\s+small\s*{[^}]*}/)?.[0] ?? ""

    expect(expertSquadDescriptionBlock).not.toMatch(/color\s*:/)
  })

  test("browser preview candidate dropdown uses the shared select popup colors", () => {
    expect(browserPreviewPanel).toContain("<SelectControl<BrowserPreviewCandidate>")
    expect(browserPreviewPanel).toContain('contentClass="browser-preview-candidate-content"')
    expect(browserPreviewPanel).toContain('listboxClass="browser-preview-candidate-listbox"')
    expect(browserPreviewPanel).toContain('optionClass="browser-preview-candidate-option"')
    expect(browserPreviewPanel).toContain('indicatorClass="browser-preview-candidate-indicator"')

    const candidateContentBlock = inspectorCss.match(/\.browser-preview-candidate-content\s*{[^}]*}/)?.[0] ?? ""
    const candidateOptionBlock = inspectorCss.match(/\.browser-preview-candidate-option\s*{[^}]*}/)?.[0] ?? ""

    expect(candidateContentBlock).not.toMatch(/background\s*:/)
    expect(candidateContentBlock).not.toMatch(/color\s*:/)
    expect(candidateOptionBlock).not.toMatch(/color\s*:/)
    expect(candidateOptionBlock).not.toMatch(/background\s*:/)
  })

  test("log viewer level dropdown uses the shared Select trigger chrome", () => {
    expect(logViewer).toContain("<SelectControl<LogLevelSelectOption>")
    expect(logViewer).toContain('triggerClass="field-input log-level-select-trigger"')

    expect(settingsCss).not.toContain(".log-level-select {")
    expect(settingsCss).not.toContain(".log-level-select:focus")
  })

  test("app dialog select trigger uses the shared Select trigger chrome", () => {
    expect(appDialogHost).toContain("<SelectControl<AppDialogSelectOption>")
    expect(appDialogHost).toContain('triggerClass="field-input app-dialog-input app-dialog-select-trigger"')
    expect(appDialogHost).not.toContain('class="field-input app-dialog-input custom-select app-dialog-select-trigger"')
  })

  test("all Select.Trigger consumers use the shared trigger primitive", () => {
    const violations: string[] = []

    for (const file of walkTsx(SRC_ROOT)) {
      if (file.endsWith(join("components", "ui", "SelectControl.tsx"))) continue
      const source = readFileSync(file, "utf8")
      for (const match of source.matchAll(/<Select\.Trigger\b[\s\S]*?>/g)) {
        const tag = match[0]
        if (tag.includes("oc-select-trigger")) continue
        if (
          file.endsWith(join("components", "settings", "primitives.tsx")) &&
          tag.includes("class={triggerClass()}") &&
          source.includes(
            'props.triggerClass ? `field-input oc-select-trigger ${props.triggerClass}` : "field-input oc-select-trigger"',
          )
        ) {
          continue
        }
        violations.push(
          `${relative(SRC_ROOT, file)}:${lineNumber(source, match.index ?? 0)} ${tag.replace(/\s+/g, " ")}`,
        )
      }
    }

    expect(violations).toEqual([])
  })

  test("native select chrome is not kept as a parallel Select style source", () => {
    expect(fieldCss).not.toContain("select.field-input")
    expect(fieldCss).not.toContain(".custom-select")
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
