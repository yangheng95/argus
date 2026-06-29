import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const LOG_VIEWER_SOURCE = join(import.meta.dir, "../src/components/LogViewer.tsx")
const SETTINGS_CSS = join(import.meta.dir, "../src/styles/surfaces/settings.css")
const DOM_SOURCE = join(import.meta.dir, "../src/dom.ts")
const EN_LOCALE = join(import.meta.dir, "../src/i18n/en-US.json")
const ZH_LOCALE = join(import.meta.dir, "../src/i18n/zh-CN.json")

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
    expect(source).not.toContain("log-path")
  })

  test("log virtual list owns a stable visible height", () => {
    const css = readFileSync(SETTINGS_CSS, "utf8")
    const formBody = ruleBody(css, "#logDialog .log-viewer-dialog-form")
    const body = ruleBody(css, ".log-viewer")
    const errorBody = ruleBody(css, ".log-error-banner")

    expect(formBody).toContain("height: min(")
    expect(formBody).toContain("min-height:")
    expect(formBody).toContain("max-height:")
    expect(formBody).toContain("resize: both")
    expect(body).toContain("flex: 1 1 auto")
    expect(body).toContain("height: auto")
    expect(body).toContain("min-height:")
    expect(body).toContain("max-height: none")
    expect(body).toContain("box-sizing: border-box")
    expect(errorBody).toContain("overflow-wrap: anywhere")
  })

  test("header exposes one refresh entry for server log loading", () => {
    const source = readFileSync(LOG_VIEWER_SOURCE, "utf8")
    const domSource = readFileSync(DOM_SOURCE, "utf8")
    const enLocale = JSON.parse(readFileSync(EN_LOCALE, "utf8")) as Record<string, string>
    const zhLocale = JSON.parse(readFileSync(ZH_LOCALE, "utf8")) as Record<string, string>

    expect(source).toContain('id="btnLogRefresh"')
    expect(source).toContain('id="btnLogOpenFile"')
    expect(source).toContain('formClass="log-viewer-dialog-form"')
    expect(source).toContain("parseServerLogTailResponse")
    expect(source).toContain("nativeOpen(path)")
    expect(source).toContain("Host did not open the current log file")
    expect(source).toContain("log-error-banner")
    expect(source).toContain('role="alert"')
    expect(source).not.toContain("btnLogServerLogs")
    expect(source).not.toContain('t("log.load_server")')
    expect(domSource).not.toContain("btnLogServerLogs")
    expect(domSource).toContain("btnLogOpenFile")
    expect(enLocale["log.open_file"]).toBe("Open File")
    expect(enLocale["log.open_file_hint"]).toBe("Open the current server log file")
    expect(zhLocale["log.open_file"]).toBe("打开文件")
    expect(zhLocale["log.open_file_hint"]).toBe("打开当前服务端日志文件")
    expect(enLocale).not.toHaveProperty("log.load_server")
    expect(zhLocale).not.toHaveProperty("log.load_server")

    const clickRefreshEntrypoints = source.match(/onClick=\{\(\) => void refreshAction\.run\(\)\}/g) ?? []
    expect(clickRefreshEntrypoints).toHaveLength(1)
    expect(source.match(/id="btnLogRefresh"/g) ?? []).toHaveLength(1)
    expect(source.match(/id="btnLogOpenFile"/g) ?? []).toHaveLength(1)
  })
})
