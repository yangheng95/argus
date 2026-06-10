import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

test("card header renders literal tool titles without i18n lookup", () => {
  const source = readFileSync(join(OVERLAY_ROOT, "src/components/CardHeader.tsx"), "utf8")

  expect(source).toContain("function cardTitleText")
  expect(source).toContain('/^[\\w-]+(?:\\.[\\w-]+)+$/.test(title) ? t(title) : title')
  expect(source).toContain("{cardTitleText(props.node.title)}")
  expect(source).not.toContain("{t(props.node.title)}")
})
