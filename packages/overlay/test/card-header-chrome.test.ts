import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CARD_HEADER_TSX = readFileSync(join(import.meta.dir, "..", "src", "components", "CardHeader.tsx"), "utf8")
const CARD_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "surfaces", "card.css"), "utf8")

test("CardHeader does not render status or copy chrome in the message header", () => {
  expect(CARD_HEADER_TSX).not.toContain("statusBadge")
  expect(CARD_HEADER_TSX).not.toContain('class="card__badge')
  expect(CARD_HEADER_TSX).not.toContain('class="card__copy"')
  expect(CARD_HEADER_TSX).not.toContain('name="copy"')
  expect(CARD_CSS).not.toContain(".card__copy")
})
