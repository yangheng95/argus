import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")
const OPENCORVUS_ROOT = path.resolve(import.meta.dir, "../../opencorvus")

function read(root: string, relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8")
}

describe("composer routing stays prefix-free", () => {
  test("ChatComposer does not prefill a hidden routing prefix", () => {
    const source = read(OVERLAY_ROOT, "src/components/ChatComposer.tsx")

    expect(source).not.toContain("@team ")
    expect(source).not.toContain("@agent ")
    expect(source).not.toContain("DEFAULT_PROMPT_PREFIX")
    expect(source).toContain('createSignal("")')
  })

  test("orchestrator core prompt does not encode prefix-based routing", () => {
    const prompt = read(OPENCORVUS_ROOT, "src/prompt/core/orchestrator-core.txt")

    expect(prompt).not.toContain("Path selection from the user's prefix")
    expect(prompt).not.toContain("@team")
    expect(prompt).not.toContain("@agent")
    expect(prompt).toContain("Do not rely on synthetic routing prefixes")
  })
})
