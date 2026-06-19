import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CARD_HEADER_TSX = readFileSync(join(import.meta.dir, "..", "src", "components", "CardHeader.tsx"), "utf8")
const CARD_HEADER_CHROME_TSX = readFileSync(
  join(import.meta.dir, "..", "src", "components", "CardHeaderChrome.tsx"),
  "utf8",
)
const CHAT_BUBBLE_TSX = readFileSync(join(import.meta.dir, "..", "src", "components", "ChatBubble.tsx"), "utf8")
const CARD_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "surfaces", "card.css"), "utf8")

test("CardHeader does not render status or copy chrome in the message header", () => {
  expect(CARD_HEADER_TSX).not.toContain("statusBadge")
  expect(CARD_HEADER_TSX).not.toContain('class="card__badge')
  expect(CARD_HEADER_TSX).not.toContain('class="card__copy"')
  expect(CARD_HEADER_TSX).not.toContain('name="copy"')
  expect(CARD_CSS).not.toContain(".card__badge")
  expect(CARD_CSS).not.toContain(".card__copy")
})

test("CardHeader groups metadata separately from icon controls", () => {
  expect(CARD_HEADER_TSX).toContain('import { CardDurationChip, CardHeaderChrome } from "./CardHeaderChrome"')
  expect(CARD_HEADER_TSX).toContain("<CardHeaderChrome")
  expect(CHAT_BUBBLE_TSX).toContain('import { CardDurationChip, CardHeaderChrome } from "./CardHeaderChrome"')
  expect(CHAT_BUBBLE_TSX).toContain("<CardHeaderChrome")
  expect(CARD_HEADER_CHROME_TSX).toContain('class="card__meta-actions"')
  expect(CARD_HEADER_CHROME_TSX).toContain('class="card__control-actions"')
  expect(CARD_HEADER_CHROME_TSX.indexOf('class="card__meta-actions"')).toBeLessThan(
    CARD_HEADER_CHROME_TSX.indexOf('class="card__control-actions"'),
  )
  expect(CARD_CSS).toContain(".card__meta-actions,")
  expect(CARD_CSS).toContain(".card__control-actions")
  expect(CARD_CSS).toContain(".card__actions > .card__control-actions:first-child")
})

test("Card header action rail has one TSX owner", () => {
  const productionOwners = [
    ["CardHeader.tsx", CARD_HEADER_TSX],
    ["ChatBubble.tsx", CHAT_BUBBLE_TSX],
    ["CardHeaderChrome.tsx", CARD_HEADER_CHROME_TSX],
  ]

  for (const needle of [
    'class="card__meta-actions"',
    'class="card__control-actions"',
    'data-ui="card-error-reason"',
    'data-ui="card-trace"',
    'data-ui="card-agent-model-settings"',
    'data-ui="card-agent-cancel"',
    'data-ui="card-rewind"',
  ]) {
    const owners = productionOwners.filter(([, source]) => source.includes(needle)).map(([name]) => name)
    expect(owners).toEqual(["CardHeaderChrome.tsx"])
  }

  for (const delegated of [CARD_HEADER_TSX, CHAT_BUBBLE_TSX]) {
    expect(delegated).not.toContain('from "../hooks/use-card-head-actions"')
    expect(delegated).not.toContain('from "../services/clock"')
    expect(delegated).not.toContain('formatCostUSD')
    expect(delegated).not.toContain('formatTokenCount')
  }
})

test("CardHeader keeps disclosure and action buttons as sibling controls", () => {
  expect(CARD_HEADER_TSX).toContain('class="card__head-main"')
  expect(CARD_HEADER_TSX).toContain("aria-expanded={props.collapsible ? props.expanded : undefined}")
  expect(CARD_HEADER_TSX).not.toContain('role={props.collapsible ? "button" : undefined}')
  expect(CARD_HEADER_TSX).not.toContain("tabindex={props.collapsible ? 0 : undefined}")
  expect(CARD_HEADER_TSX).not.toContain("onKeyDown={(e) =>")
  expect(CARD_CSS).toContain(".card__head-main")
  expect(CARD_CSS).toContain(".card__head-main:focus-visible")

  const mainButton = CARD_HEADER_TSX.indexOf('class="card__head-main"')
  const actions = CARD_HEADER_TSX.indexOf("<CardHeaderChrome")
  expect(mainButton).toBeGreaterThan(0)
  expect(actions).toBeGreaterThan(mainButton)
})

test("CardHeader action controls use Button primitives", () => {
  for (const dataUi of [
    "card-error-reason",
    "card-trace",
    "card-agent-model-settings",
    "card-agent-cancel",
    "card-rewind",
  ]) {
    expect(CARD_HEADER_CHROME_TSX).toContain(`data-ui="${dataUi}"`)
    expect(CARD_CSS).toContain(`.oc-button[data-ui="${dataUi}"]`)
  }
  expect(CARD_HEADER_CHROME_TSX).toContain('import { Button } from "./ui/Button"')

  for (const retired of [
    'class="card__error-reason"',
    'class="card__trace"',
    'class="card__agent-cancel"',
    'class="card__rewind"',
    ".card__error-reason",
    ".card__trace",
    ".card__agent-cancel",
    ".card__rewind",
    ".card__agent-reply-toggle",
  ]) {
    expect(CARD_HEADER_CHROME_TSX).not.toContain(retired)
    expect(CARD_CSS).not.toContain(retired)
  }
})
