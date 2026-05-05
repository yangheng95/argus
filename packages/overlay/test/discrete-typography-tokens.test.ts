import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const cssFiles = [
  "../src/styles/surfaces/changes.css",
  "../src/styles/surfaces/composer.css",
  "../src/styles/surfaces/conversation.css",
  "../src/styles/surfaces/diff.css",
  "../src/styles/surfaces/inline-pill.css",
  "../src/styles/surfaces/inspector.css",
  "../src/styles/surfaces/messages.css",
]

test("surface typography uses discrete size tokens instead of token multipliers", () => {
  const tokenMultiplierPattern = /font-size:\s*calc\(var\(--ui-font-(?:tiny|small|meta|control|body|title)\)[^;]*\);/g

  for (const rel of cssFiles) {
    const file = path.resolve(import.meta.dir, rel)
    const css = readFileSync(file, "utf8")
    expect(css.match(tokenMultiplierPattern) ?? []).toEqual([])
  }
})
