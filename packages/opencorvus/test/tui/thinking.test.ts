import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const tuiRoot = path.join(import.meta.dir, "../../src/cli/cmd/tui")

describe("OpenCode-derived thinking wiring", () => {
  test("keeps the copied thinking helper contract", () => {
    const source = readFileSync(path.join(tuiRoot, "context/thinking.ts"), "utf8")

    expect(source).toContain("Copied from OpenCode")
    expect(source).toContain('export type ThinkingMode = "show" | "hide"')
    expect(source).toContain("export function reasoningSummary")
    expect(source).toContain("content.match")
    expect(source).toContain("export function nextThinkingMode")
    expect(source).toContain('kv.signal<ThinkingMode>("thinking_mode", "hide")')
    expect(source).toContain('const legacy = kv.get("thinking_visibility")')
    expect(source).toContain('if ((stored() as string) === "minimal") set("hide")')
  })

  test("session surfaces use thinking mode instead of the old boolean source", () => {
    const sessionRoute = readFileSync(path.join(tuiRoot, "routes/session/index.tsx"), "utf8")
    const dialogMessage = readFileSync(path.join(tuiRoot, "routes/session/dialog-message.tsx"), "utf8")

    expect(sessionRoute).toContain("const thinking = useThinkingMode()")
    expect(sessionRoute).toContain("const thinkingMode = thinking.mode")
    expect(sessionRoute).toContain("thinking.set(nextThinkingMode(thinkingMode()))")
    expect(sessionRoute).toContain("ReasoningHeader")
    expect(sessionRoute).toContain("reasoningSummary(content())")
    expect(sessionRoute).not.toContain('kv.signal("thinking_visibility"')
    expect(dialogMessage).toContain("const thinking = useThinkingMode()")
    expect(dialogMessage).not.toContain('kv.signal("thinking_visibility"')
  })
})
