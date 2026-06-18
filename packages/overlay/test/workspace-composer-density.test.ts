import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const WORKSPACE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "workspace.css"),
  "utf8",
)
const COMPOSER = readFileSync(path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "composer.css"), "utf8")
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

function retiredSelector(className: string): RegExp {
  return new RegExp(`(^|[\\n,{])\\s*\\.${className}(?:\\s|[,>{:+~.#\\[]|$)`, "m")
}

describe("workspace header controls share a single density tier", () => {
  test("retired workspace tab chrome stays absent", () => {
    for (const className of ["workspace-tabs", "workspace-tab", "workspace-tab-label", "workspace-tab-file"]) {
      expect(WORKSPACE).not.toMatch(retiredSelector(className))
    }
    expect(WORKSPACE).toContain("min-height: var(--ui-panel-header-height);")
  })

  test("file editor close button uses the icon-button density token", () => {
    expect(WORKSPACE).toContain("width: var(--oc-density-icon-button);")
    expect(WORKSPACE).toContain("height: var(--oc-density-icon-button);")
  })
})

describe("composer shell stays tighter than the surrounding canvas", () => {
  test("composer textarea floor is capped at the compact 56px size", () => {
    // The 56px floor is now declared once as `--chat-textarea-height`
    // on `.chat-input`; both `.chat-textarea-wrap` and `.chat-textarea`
    // read from it via `min-height: var(--chat-textarea-height);`.
    // Pin both: the literal var declaration AND that the consumers
    // route through the variable rather than re-declaring 56px or
    // any other floor.
    expect(COMPOSER).toContain("--chat-textarea-height: calc(56px * var(--ui-scale));")
    expect(COMPOSER).toMatch(/\.chat-textarea\s*\{[^}]*min-height:\s*var\(--chat-textarea-height\)\s*;/)
    expect(COMPOSER).toMatch(/\.chat-textarea-wrap\s*\{[^}]*min-height:\s*var\(--chat-textarea-height\)\s*;/)
  })

  test("send button shares the textarea height contract", () => {
    expect(COMPOSER).toMatch(/\.chat-send\s*\{[^}]*min-height:\s*var\(--chat-textarea-height\)\s*;/)
  })
})

describe("conversation chrome keeps the compact header rhythm", () => {
  test("chat task status keeps compact header typography", () => {
    expect(CONVERSATION).toContain(".chat-task-status")
    expect(CONVERSATION).toContain("font-size: var(--ui-font-meta);")
  })
})

describe("right-rail empty cards stay on the compact density contract", () => {
  test("empty cards use the reduced 8x10 padding shell", () => {
    expect(EMPTY_STATE).toContain("padding: calc(8px * var(--ui-scale)) calc(10px * var(--ui-scale));")
  })

  test("inspector section head/body keep the tighter 5/8 spacing rhythm", () => {
    // Section heads stayed on the explicit 5/8 padding pair (vertical
    // 5px, horizontal 8px) so head density is unmistakeable. The body
    // padding migrated to the canonical `--ui-gap-sm` token after the
    // gap-token sweep — accept that single-source form here.
    expect(INSPECTOR).toContain("padding: calc(5px * var(--ui-scale)) calc(8px * var(--ui-scale));")
    expect(INSPECTOR).toMatch(
      /\.oc-section__body\s*\{\s*padding:\s*0\s+var\(--ui-gap-sm\)\s+var\(--ui-gap-sm\)\s*;\s*\}/,
    )
  })
})
