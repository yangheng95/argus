import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const WORKSPACE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "workspace.css"),
  "utf8",
)
const COMPOSER = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "composer.css"),
  "utf8",
)
const CONVERSATION = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "conversation.css"),
  "utf8",
)
const EMPTY_STATE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "empty-state.css"),
  "utf8",
)
const INSPECTOR = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "inspector.css"),
  "utf8",
)

describe("workspace header controls share a single density tier", () => {
  test("workspace tabs use the panel-header height and title typography", () => {
    expect(WORKSPACE).toContain("min-height: var(--ui-panel-header-height);")
    expect(WORKSPACE).toContain("font-size: var(--ui-font-title);")
  })

  test("workspace close button uses the icon-button density token", () => {
    expect(WORKSPACE).toContain("width: var(--oc-density-icon-button);")
    expect(WORKSPACE).toContain("height: var(--oc-density-icon-button);")
  })
})

describe("composer shell stays tighter than the surrounding canvas", () => {
  test("composer textarea floor is capped at the compact 56px size", () => {
    expect(COMPOSER).toContain("min-height: calc(56px * var(--ui-scale));")
  })

  test("send button stays on the reduced 64px vertical contract", () => {
    expect(COMPOSER).toContain("min-height: calc(64px * var(--ui-scale) * var(--chat-compose-scale));")
  })
})

describe("conversation chrome keeps the compact header rhythm", () => {
  test("copy-all action participates in control height instead of floating as raw text", () => {
    expect(CONVERSATION).toContain("min-height: var(--oc-density-control-height);")
    expect(CONVERSATION).toContain("font-size: var(--ui-font-meta);")
  })
})

describe("right-rail empty cards stay on the compact density contract", () => {
  test("empty cards use the reduced 8x10 padding shell", () => {
    expect(EMPTY_STATE).toContain("padding: calc(8px * var(--ui-scale)) calc(10px * var(--ui-scale));")
  })

  test("inspector section head/body keep the tighter 5/8 spacing rhythm", () => {
    expect(INSPECTOR).toContain("padding: calc(5px * var(--ui-scale)) calc(8px * var(--ui-scale));")
    expect(INSPECTOR).toContain("padding: 0 calc(5px * var(--ui-scale)) calc(5px * var(--ui-scale));")
  })
})
