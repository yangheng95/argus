// Regression for iter24 of the design-language audit.
//
// User feedback (2026-05-02 23:30 + screenshot): "这个 tab 没有
// 标题且无法折叠" — pointing at the delivery surface in the
// right panel, which sat between the Goals and Files section
// frames.
//
// Pre-iter24 the DeliveryPanel rendered as a bare
// `<section class="delivery-panel">` whose only header was a
// verdict-pill ("IN FLIGHT" / "ACCEPTED" / etc). It had no
// section title saying "Delivery" and was NOT wrapped in
// `<details>`, so the operator couldn't collapse the surface
// when the verdict + evidence groups + summary were too noisy.
// Meanwhile every neighbouring section (Goals, Files,
// Architect, Requirements, …) sat under a `<details
// class="section">` with a `<summary class="section-head">`
// carrying icon + title + tone badge, and could be folded
// away.
//
// Fix: bake the section frame into the DeliveryPanel
// component itself. Every mount (main.tsx:1054 — the live
// one — and the dead Board.tsx Show=false block) now gets a
// proper `<details class="section">` with the
// section.delivery title, the delivery icon, and a
// section-badge whose tone tracks the verdict.
//
// The grep below pins the contract on the source — Bun JSX
// runtime can't render Solid components, so we verify the
// JSX tree shape directly. Future contributors who reorder
// or unwrap the details fail CI immediately.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const BOARD = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "components", "Board.tsx"),
  "utf8",
)

describe("DeliveryPanel renders inside a collapsible section frame", () => {
  test("DeliveryPanel returns a <details class=\"section\"> wrapper", () => {
    // Locate the function body and walk forward looking for
    // the first JSX root after `return (`. The first tag must
    // be `<details` with `class="section"`.
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    expect(fnStart).toBeGreaterThan(-1)
    const returnIdx = BOARD.indexOf("return (", fnStart)
    expect(returnIdx).toBeGreaterThan(-1)
    const slice = BOARD.slice(returnIdx, returnIdx + 1200)
    expect(slice).toMatch(/return\s*\([^<]*<details\s+(?:id="deliverySection"\s+)?class="section"/)
  })

  test("the section-head carries an icon + title + badge", () => {
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    const returnIdx = BOARD.indexOf("return (", fnStart)
    const slice = BOARD.slice(returnIdx, returnIdx + 2000)
    expect(slice).toContain('class="section-head"')
    expect(slice).toContain('class="section-icon"')
    expect(slice).toContain('class="section-title"')
    expect(slice).toContain('class="section-badge"')
    expect(slice).toContain('t("section.delivery")')
  })

  test("the section badge tone reacts to verdict (good / bad / accent)", () => {
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).toMatch(/data-tone=\{[\s\S]*"accepted"[\s\S]*"good"[\s\S]*"rejected"[\s\S]*"bad"[\s\S]*\}/)
  })

  test("the rendered <details> carries id=deliverySection and the body id=deliveryBody (so dom.ts accessors resolve)", () => {
    // iter31 functional fix: dom.ts queries `#deliverySection`
    // and `#deliveryBody` to attach data-phase-state for
    // section phase highlighting. Pre-iter31 the iter24 self-
    // wrap rendered a bare `<details class="section">` with
    // no IDs — `syncSectionPhases({delivery: "active"})`
    // silently no-op'd. Pin the IDs so the highlight
    // pipeline reaches the real nodes.
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).toMatch(/<details\s+id="deliverySection"\s+class="section"/)
    expect(slice).toMatch(/<div\s+id="deliveryBody"\s+class="section-body"/)
  })

  test("the <details> does NOT hardcode data-phase-state (owned by syncSectionPhases)", () => {
    // iter31: removed the iter24 hardcoded
    // `data-phase-state={props.delivery ? "active" :
    // undefined}` — that attribute belongs to
    // `syncSectionPhases` which computes it from the live
    // conversation phase + board state. Hardcoding it
    // here pinned the section to "active" forever whenever
    // delivery data existed.
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).not.toMatch(/data-phase-state=\{props\.delivery/)
  })
})
