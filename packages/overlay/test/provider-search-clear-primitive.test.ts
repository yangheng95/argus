import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = readFileSync(join(import.meta.dir, "../src/components/settings/ProvidersPanel.tsx"), "utf8")
const STYLES = readFileSync(join(import.meta.dir, "../src/styles/surfaces/settings.css"), "utf8")

test("ProvidersPanel routes search clear through the Button primitive", () => {
  expect(SOURCE).toContain('import { Button } from "../ui/Button";')
  expect(SOURCE).toContain('data-ui="provider-search-clear"')
  expect(SOURCE).not.toContain('class="provider-search-clear"')
  expect(STYLES).toContain('.provider-search-field .oc-button[data-ui="provider-search-clear"]')
  expect(STYLES).not.toContain(".provider-search-clear {")
})
