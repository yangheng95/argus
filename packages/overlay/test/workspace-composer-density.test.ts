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
    expect(WORKSPACE).toContain('.file-editor-header .oc-button[data-ui="file-editor-close"]')
    expect(WORKSPACE).toContain('data-ui="file-editor-close"')
    expect(WORKSPACE).not.toContain(".file-editor-close {")
  })
})

describe("composer shell stays tighter than the surrounding canvas", () => {
  test("composer stack width, input minimum height, and radius are explicit", () => {
    expect(COMPOSER).toMatch(/\.chat-composer-stack\s*\{[^}]*--chat-composer-inline-gutter:/)
    expect(COMPOSER).toContain("--chat-composer-inline-gutter: calc(28px * var(--ui-scale));")
    expect(COMPOSER).toContain("--chat-composer-max-width: calc(1040px * var(--ui-scale));")
    expect(COMPOSER).toContain("--chat-composer-min-height: calc(96px * var(--ui-scale));")
    expect(COMPOSER).toContain(
      "width: min(var(--chat-composer-max-width), calc(100% - var(--chat-composer-inline-gutter)));",
    )
    expect(COMPOSER).toContain("max-width: var(--chat-composer-max-width);")
    expect(COMPOSER).toContain("min-height: var(--chat-composer-min-height);")
    expect(COMPOSER).toContain("border-radius: var(--oc-radius-xl);")
    expect(COMPOSER).toMatch(/\.chat-input\s*\{[\s\S]*?width:\s*100%;/)
  })

  test("composer textarea floor is capped at the compact 48px size", () => {
    // The 48px floor is now declared once as `--chat-textarea-height`
    // on `.chat-composer-stack`; both `.chat-textarea-wrap` and `.chat-textarea`
    // read from it via `min-height: var(--chat-textarea-height);`.
    // Pin both: the literal var declaration AND that the consumers
    // route through the variable rather than re-declaring 48px or
    // any other floor.
    expect(COMPOSER).toContain("--chat-textarea-height: calc(48px * var(--ui-scale));")
    expect(COMPOSER).toMatch(/\.chat-textarea\s*\{[^}]*min-height:\s*var\(--chat-textarea-height\)\s*;/)
    expect(COMPOSER).toMatch(/\.chat-textarea-wrap\s*\{[^}]*min-height:\s*var\(--chat-textarea-height\)\s*;/)
  })

  test("send button uses the compact embedded action size", () => {
    expect(COMPOSER).toMatch(
      /\.chat-compose-meta-right\s+\.oc-button\[data-mode\]\s*\{[^}]*min-height:\s*var\(--chat-composer-action-size\)\s*;/,
    )
    expect(COMPOSER).toMatch(/\.chat-send-label\s*\{[\s\S]*?clip:\s*rect\(0 0 0 0\);/)
  })

  test("narrow composer panels keep selector buttons, attachment loaders, and send on one meta row", () => {
    expect(COMPOSER).toMatch(/\.chat-compose-meta\s*\{[^}]*flex-wrap:\s*nowrap\s*;/)
    expect(COMPOSER).toMatch(/\.chat-compose-meta-right\s*\{[^}]*align-items:\s*center\s*;/)
    expect(COMPOSER).toMatch(/\.chat-compose-meta-left\s*\{[\s\S]*?display:\s*flex\s*;/)
    expect(COMPOSER).toMatch(/\.chat-compose-meta-left\s*\{[\s\S]*?justify-content:\s*flex-start\s*;/)
    expect(COMPOSER).toMatch(/\.chat-compose-meta-left\s*\{[\s\S]*?flex:\s*0 1 auto\s*;/)
    expect(COMPOSER).toMatch(/\.composer-attachment-loaders\s*\{[^}]*justify-content:\s*flex-end\s*;/)
    expect(COMPOSER).not.toMatch(
      /@container \(max-width: 520px\)\s*\{[\s\S]*?\.chat-compose-meta-left\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
    )
    expect(COMPOSER).toMatch(
      /@container \(max-width: 360px\)\s*\{[\s\S]*?\.executor-dualbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
    )
  })

  test("bottom mode, expert-squad, and model dropdowns keep a visible default boundary", () => {
    expect(COMPOSER).toMatch(
      /\.composer-mode-select-wrap,\s*\.expert-squad-select-wrap,\s*\.composer-model-selector\s*\{[\s\S]*?background:\s*color-mix\(in srgb,\s*var\(--surface-inset\) 26%, transparent\);/,
    )
    expect(COMPOSER).toMatch(
      /\.composer-mode-select-wrap,\s*\.expert-squad-select-wrap,\s*\.composer-model-selector\s*\{[\s\S]*?box-shadow:\s*inset 0 0 0 var\(--oc-border-width\) color-mix\(in srgb,\s*var\(--border\) 46%, transparent\);/,
    )
    expect(COMPOSER).toMatch(
      /\.composer-mode-select-value,\s*\.expert-squad-select-value,\s*\.composer-model-selector-value\s*\{[\s\S]*?color:\s*var\(--text-strong\);/,
    )
  })

  test("bottom dropdown triggers render as short buttons without visible arrows", () => {
    expect(COMPOSER).toMatch(
      /\.composer-mode-select-wrap,\s*\.expert-squad-select-wrap\s*\{[\s\S]*?max-width:\s*calc\(188px \* var\(--ui-scale\)\);/,
    )
    expect(COMPOSER).toMatch(/\.composer-model-selector\s*\{[\s\S]*?max-width:\s*calc\(276px \* var\(--ui-scale\)\);/)
    expect(COMPOSER).toMatch(
      /\.composer-mode-select-trigger\.oc-select-trigger,\s*\.expert-squad-select-trigger\.oc-select-trigger,\s*\.composer-model-selector \.oc-button\[data-ui="composer-model-selector-trigger"\]\s*\{[\s\S]*?width:\s*auto;/,
    )
    expect(COMPOSER).toMatch(
      /\.composer-mode-select-trigger\.oc-select-trigger,\s*\.expert-squad-select-trigger\.oc-select-trigger,\s*\.composer-model-selector \.oc-button\[data-ui="composer-model-selector-trigger"\]\s*\{[\s\S]*?justify-content:\s*center;/,
    )
    expect(COMPOSER).toMatch(/\.composer-mode-select-caret,\s*\.expert-squad-select-caret\s*\{[\s\S]*?display:\s*none;/)
    expect(COMPOSER).toContain(".composer-model-selector-popover")
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
