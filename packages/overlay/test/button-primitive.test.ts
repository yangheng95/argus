import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const BUTTON_SOURCE = join(import.meta.dir, "../src/components/ui/Button.tsx")
const BUTTON_CSS = join(import.meta.dir, "../src/styles/primitives/button.css")

function sourceArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\] as const`))
  expect(match).not.toBeNull()
  return match![1]!
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
}

function cssDataValues(css: string, attr: "variant" | "size" | "tone"): string[] {
  return Array.from(
    new Set(
      Array.from(css.matchAll(new RegExp(`\\.oc-button\\[data-${attr}="([^"]+)"\\]`, "g"))).map((match) => match[1]!),
    ),
  ).sort()
}

test("Button primitive exposes the canonical data-attribute contract", () => {
  const source = readFileSync(BUTTON_SOURCE, "utf8")

  expect(source).toContain('export const BUTTON_VARIANTS = ["solid", "outline", "ghost"] as const')
  expect(source).toContain('export const BUTTON_SIZES = ["mini", "sm", "md", "icon"] as const')
  expect(source).toContain('export const BUTTON_TONES = ["neutral", "accent", "danger"] as const')
  expect(source).toContain("export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]")
  expect(source).toContain("export type ButtonSize = (typeof BUTTON_SIZES)[number]")
  expect(source).toContain("export type ButtonTone = (typeof BUTTON_TONES)[number]")
  expect(source).toContain('Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "classList">')
  expect(source).toContain("variant: ButtonVariant")
  expect(source).toContain("size: ButtonSize")
  expect(source).toContain("tone: ButtonTone")
  expect(source).toContain('class="oc-button"')
  expect(source).toContain("data-variant={local.variant}")
  expect(source).toContain("data-size={local.size}")
  expect(source).toContain("data-tone={local.tone}")
  expect(source).not.toContain("local.class")
  expect(source).not.toContain("className")
  expect(source).not.toMatch(/\b(?:btn|chat-send|titlebar-btn|sidebar-btn|right-panel-tab|executor-chip)\b/)
})

test("Button primitive TypeScript API and CSS data variants stay in lockstep", () => {
  const source = readFileSync(BUTTON_SOURCE, "utf8")
  const css = readFileSync(BUTTON_CSS, "utf8")

  expect(cssDataValues(css, "variant")).toEqual(sourceArray(source, "BUTTON_VARIANTS").sort())
  expect(cssDataValues(css, "size")).toEqual(sourceArray(source, "BUTTON_SIZES").sort())
  expect(cssDataValues(css, "tone")).toEqual(sourceArray(source, "BUTTON_TONES").sort())
})

test("Button solid tones keep readable foreground and dedicated hover chrome", () => {
  const css = readFileSync(BUTTON_CSS, "utf8")

  for (const tone of ["neutral", "accent", "danger"]) {
    expect(css).toContain(`.oc-button[data-variant="solid"][data-tone="${tone}"]`)
  }
  expect(css).toMatch(
    /\.oc-button\[data-variant="solid"\]\[data-tone="accent"\]\s*\{[^}]*--oc-button-color:\s*var\(--surface\);/s,
  )
  expect(css).toMatch(
    /\.oc-button\[data-variant="solid"\]\[data-tone="accent"\]:hover,[^}]*--oc-button-bg:\s*var\(--accent-hover\);/s,
  )
  expect(css).toContain('.oc-button:not([data-tone="danger"]):not([data-variant="solid"]):hover')
})

test("Button mini size owns the retired compact-button padding contract", () => {
  const css = readFileSync(BUTTON_CSS, "utf8")

  expect(css).toMatch(
    /\.oc-button\[data-size="mini"\]\s*\{[^}]*--oc-button-padding-x:\s*var\(--ui-btn-mini-padding-x\);/s,
  )
  expect(css).toMatch(
    /\.oc-button\[data-size="mini"\]\s*\{[^}]*--oc-button-padding-y:\s*var\(--ui-btn-mini-padding-y\);/s,
  )
  expect(css).toMatch(/\.oc-button\[data-size="mini"\]\s*\{[^}]*font-size:\s*var\(--ui-font-small\);/s)
})

test("Button primitive owns the canonical keyboard focus ring", () => {
  const css = readFileSync(BUTTON_CSS, "utf8")

  expect(css).toMatch(
    /\.oc-button:focus-visible\s*\{[^}]*outline:\s*var\(--oc-border-width\)\s+solid\s+var\(--accent\);/s,
  )
  expect(css).toMatch(/\.oc-button:focus-visible\s*\{[^}]*outline-offset:\s*calc\(1px \* var\(--ui-scale\)\);/s)
  expect(css).not.toMatch(/\.oc-button[^{]*:focus-visible\s*\{[^}]*outline:\s*none\s*;/s)
})
