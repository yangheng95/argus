import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8")
}

test("ConnectionBadge uses the Button primitive and opens diagnostics", () => {
  const source = read("src/components/ConnectionBadge.tsx")

  expect(source).toContain('import { Button } from "./ui/Button"')
  expect(source).toContain('import { openConfigDialog } from "../services/dialog"')
  expect(source).toContain("<Button")
  expect(source).toContain('type="button"')
  expect(source).toContain('variant="ghost"')
  expect(source).toContain('size="sm"')
  expect(source).toContain('tone="neutral"')
  expect(source).toContain('data-ui="connection-badge"')
  expect(source).toContain('onClick={() => openConfigDialog("general")}')
  expect(source).toContain("aria-live=\"polite\"")
  expect(source).toContain("title={diagnosticsLabel()}")
  expect(source).toContain("aria-label={diagnosticsLabel()}")
  expect(source).not.toContain("onDblClick")
  expect(source).not.toContain('apiJson("restart"')
  expect(source).not.toMatch(/<span[\s\S]*id="connBadge"/)
})

test("ConnectionBadge titlebar CSS composes with the shared Button focus ring", () => {
  const css = read("src/styles/surfaces/titlebar.css")

  expect(css).toContain('.oc-button[data-ui="connection-badge"].conn-badge')
  expect(css).toMatch(
    /\.oc-button\[data-ui="connection-badge"\]\.conn-badge\s*\{[\s\S]*?--oc-button-height:\s*auto;/,
  )
  expect(css).toMatch(
    /\.oc-button\[data-ui="connection-badge"\]\.conn-badge\s*\{[\s\S]*?--oc-button-bg:\s*color-mix\(in srgb, var\(--surface-strong\) 84%, transparent\);/,
  )
  expect(css).toMatch(/\.conn-badge:hover,\s*\.conn-badge:focus-visible\s*\{[\s\S]*?--oc-button-bg:\s*var\(--surface-hover\);/)
  expect(css).not.toMatch(/\.conn-badge:hover,\s*\.conn-badge:focus-visible\s*\{[^}]*outline:\s*none/)
})
