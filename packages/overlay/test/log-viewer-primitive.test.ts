import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const LOG_VIEWER_SOURCE = join(import.meta.dir, "../src/components/LogViewer.tsx")
const SETTINGS_CSS = join(import.meta.dir, "../src/styles/surfaces/settings.css")

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return ""
  const bodyStart = css.indexOf("{", start)
  const bodyEnd = css.indexOf("\n}", bodyStart)
  return bodyEnd === -1 ? "" : css.slice(bodyStart + 1, bodyEnd)
}

describe("LogViewer primitives", () => {
  test("uses shared log helpers and a virtual list", () => {
    const source = readFileSync(LOG_VIEWER_SOURCE, "utf8")

    expect(source).toContain('import { VList, type VListHandle } from "virtua/solid"')
    expect(source).toContain("parseServerLogLine")
    expect(source).toContain("stringifyLogValue")
    expect(source).toContain("logDetailFields")
    expect(source).toContain("<VList")
    expect(source).toContain('import { SelectControl } from "./ui/SelectControl"')
    expect(source).toContain("<SelectControl<LogLevelSelectOption>")
    expect(source).toContain('triggerClass="field-input log-level-select-trigger"')
    expect(source).toContain('optionClass="log-level-select-option"')
    expect(source).not.toContain('import * as Select from "@kobalte/core/select"')
    expect(source).not.toContain("<Select.Root")
    expect(source).not.toContain("<Select.Trigger")
    expect(source).not.toContain("<Select.HiddenSelect")
    expect(source).not.toContain("function LogLevelOption")
    expect(source).not.toContain("<select")
    expect(source).not.toContain("browser-preview-candidate")
    expect(source).not.toContain("function parseLogValue")
    expect(source).not.toContain("function scanBalancedLogValue")
    expect(source).not.toContain("<Index")
    expect(source).not.toContain("setupAutoScroll")
  })

  test("log virtual list owns a stable visible height", () => {
    const css = readFileSync(SETTINGS_CSS, "utf8")
    const body = ruleBody(css, ".log-viewer")

    expect(body).toContain("height: clamp(")
    expect(body).toContain("min-height:")
    expect(body).toContain("max-height:")
    expect(body).toContain("box-sizing: border-box")
  })
})
