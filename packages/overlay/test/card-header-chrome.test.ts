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

test("CardHeader groups metadata separately from icon controls", () => {
  expect(CARD_HEADER_TSX).toContain('class="card__meta-actions"')
  expect(CARD_HEADER_TSX).toContain('class="card__control-actions"')
  expect(CARD_HEADER_TSX.indexOf('class="card__meta-actions"')).toBeLessThan(
    CARD_HEADER_TSX.indexOf('class="card__control-actions"'),
  )
  expect(CARD_CSS).toContain(".card__meta-actions,")
  expect(CARD_CSS).toContain(".card__control-actions")
  expect(CARD_CSS).toContain(".card__actions > .card__control-actions:first-child")
})

test("CardHeader keeps disclosure and action buttons as sibling controls", () => {
  expect(CARD_HEADER_TSX).toContain('class="card__head-main"')
  expect(CARD_HEADER_TSX).toContain("aria-expanded={props.collapsible ? props.expanded : undefined}")
  expect(CARD_HEADER_TSX).not.toContain('role={props.collapsible ? "button" : undefined}')
  expect(CARD_HEADER_TSX).not.toContain("tabindex={props.collapsible ? 0 : undefined}")
  expect(CARD_CSS).toContain(".card__head-main")
  expect(CARD_CSS).toContain(".card__head-main:focus-visible")

  const mainButton = CARD_HEADER_TSX.indexOf('class="card__head-main"')
  const errorButton = CARD_HEADER_TSX.indexOf('class="card__error-reason"')
  const actions = CARD_HEADER_TSX.indexOf('class="card__actions"')
  expect(mainButton).toBeGreaterThan(0)
  expect(errorButton).toBeGreaterThan(mainButton)
  expect(actions).toBeGreaterThan(errorButton)
})
