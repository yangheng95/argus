import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { documentationEntryUrl } from "../src/services/documentation"

const OVERLAY_ROOT = join(import.meta.dir, "..")

describe("documentation entries", () => {
  test("uses one URL source for localized Help documentation entries", () => {
    expect(documentationEntryUrl("quickstart", "en-US")).toBe("https://opencorvus.ai/docs/start/quickstart/")
    expect(documentationEntryUrl("sdk", "en-US")).toBe("https://opencorvus.ai/docs/reference/sdk/")
    expect(documentationEntryUrl("quickstart", "zh-CN")).toBe("https://opencorvus.ai/docs/zh-cn/start/quickstart/")
    expect(documentationEntryUrl("sdk", "zh-CN")).toBe("https://opencorvus.ai/docs/zh-cn/reference/sdk/")
  })

  test("Command Palette opens logs through the explicit log event, not the removed Help menu item", () => {
    const source = readFileSync(join(OVERLAY_ROOT, "src/components/CommandPalette.tsx"), "utf8")
    expect(source).toContain('new CustomEvent("oc:open-logs")')
    expect(source).not.toContain("titlebar.logs")
    expect(source).not.toContain("titlebar-help-logs")
  })
})
