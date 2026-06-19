import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = readFileSync(join(import.meta.dir, "../src/components/settings/ProvidersPanel.tsx"), "utf8")
const STYLES = readFileSync(join(import.meta.dir, "../src/styles/surfaces/settings.css"), "utf8")
const FIELD_STYLES = readFileSync(join(import.meta.dir, "../src/styles/surfaces/field.css"), "utf8")

test("ProvidersPanel routes search clear through the Button primitive", () => {
  expect(SOURCE).toMatch(/import\s+\{\s*Button\s*\}\s+from\s+"..\/ui\/Button"/)
  expect(SOURCE).toContain('class="provider-search-field search-field"')
  expect(SOURCE).toContain('class="provider-search-icon search-field-icon"')
  expect(SOURCE).toContain('class="provider-search-input search-field-input"')
  expect(SOURCE).toContain('data-ui="provider-search-clear"')
  expect(SOURCE).not.toContain('class="provider-search-clear"')
  expect(FIELD_STYLES).toContain('.search-field .oc-button[data-ui$="-search-clear"]')
  expect(STYLES).not.toContain('.provider-search-field .oc-button[data-ui="provider-search-clear"]')
  expect(STYLES).not.toContain(".provider-search-icon")
  expect(STYLES).not.toContain(".provider-search-field .provider-search-input")
  expect(STYLES).not.toContain(".provider-search-clear {")
})
