import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const component = readFileSync(path.join(import.meta.dir, "../src/components/ChatComposer.tsx"), "utf8")
const css = readFileSync(path.join(import.meta.dir, "../src/styles/surfaces/composer.css"), "utf8")
const en = JSON.parse(readFileSync(path.join(import.meta.dir, "../src/i18n/en-US.json"), "utf8"))
const zh = JSON.parse(readFileSync(path.join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8"))

describe("large chat input warning", () => {
  test("warns above 50 KB without blocking submit", () => {
    expect(component).toContain("REQUEST_PERFORMANCE_WARNING_BYTES = 50 * 1024")
    expect(component).toContain("utf8ByteLength(text()) > REQUEST_PERFORMANCE_WARNING_BYTES")
    expect(component).toContain('t("chat.large_input_warning")')
    expect(component).not.toContain("showLargeRequestWarning() ||")
    expect(component).not.toContain("disabled={showLargeRequestWarning()")
  })

  test("renders warning chrome and localized guidance", () => {
    expect(css).toContain(".chat-input-warning")
    expect(css).toContain("color: var(--warn)")
    expect(en["chat.large_input_warning"]).toContain("50 KB")
    expect(en["chat.large_input_warning"]).toContain("1M-context")
    expect(zh["chat.large_input_warning"]).toContain("50 KB")
    expect(zh["chat.large_input_warning"]).toContain("1M")
  })
})
