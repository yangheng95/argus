import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ICON_SOURCE = readFileSync(path.join(import.meta.dir, "..", "src", "components", "Icon.tsx"), "utf8")

test("Icon registry creates fresh DOM nodes for every icon instance", () => {
  expect(ICON_SOURCE).toContain("body: (idPrefix: string) => JSX.Element")
  expect(ICON_SOURCE).toContain("{record().body(iconIDPrefix)}")
  expect(ICON_SOURCE).not.toContain("body: JSX.Element")
  expect(ICON_SOURCE).not.toContain("{record().body}")
})
