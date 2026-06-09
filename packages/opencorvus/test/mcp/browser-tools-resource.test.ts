import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

test("browser screenshot CDP session detaches on capture errors", () => {
  const source = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/tools.ts"), "utf8")
  expect(source).toContain('cdp.send("Page.captureScreenshot"')
  expect(source).toMatch(/finally\s*\{\s*await cdp\.detach\(\)\.catch\(\(\)\s*=>\s*undefined\)/s)
})
