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
  // 2026-05-04 follow-up: the bare `<details class="section">` wrapper
  // was promoted into the shared `<Section>` primitive (see
  // `components/primitives/Section.tsx`), which renders the same
  // `<details>` tree but tags it with the namespaced `.oc-section*`
  // class family. Pin the post-migration shape: DeliveryPanel mounts
  // through Section and forwards the IDs the DOM accessors expect.
  test("DeliveryPanel returns a <Section> wrapper as its JSX root", () => {
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    expect(fnStart).toBeGreaterThan(-1)
    const returnIdx = BOARD.indexOf("return (", fnStart)
    expect(returnIdx).toBeGreaterThan(-1)
    const slice = BOARD.slice(returnIdx, returnIdx + 1200)
    expect(slice).toMatch(/return\s*\(\s*<Section\b/)
  })

  test("the Section wrapper passes icon + title + badge + badgeTone props", () => {
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).toContain('title={t("section.delivery")}')
    expect(slice).toMatch(/icon=\{<Icon\s+name="delivery"\s*\/>}/)
    expect(slice).toMatch(/badge=\{[^}]*verdictPillLabel/)
    expect(slice).toMatch(/badgeTone=\{/)
  })

  test("the section badge tone reacts to verdict (good / bad / accent)", () => {
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).toMatch(/badgeTone=\{[\s\S]*"accepted"[\s\S]*"good"[\s\S]*"rejected"[\s\S]*"bad"[\s\S]*\}/)
  })

  test("the Section forwards id=deliverySection and bodyId=deliveryBody so dom.ts accessors resolve", () => {
    // iter31 functional fix: dom.ts queries `#deliverySection` and
    // `#deliveryBody` to attach data-phase-state. Section forwards
    // both `id` and `bodyId` to the underlying `<details>` /
    // `.oc-section__body` so the highlight pipeline still reaches
    // the real nodes after the primitive migration.
    const fnStart = BOARD.indexOf("export function DeliveryPanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).toContain('id="deliverySection"')
    expect(slice).toContain('bodyId="deliveryBody"')
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
