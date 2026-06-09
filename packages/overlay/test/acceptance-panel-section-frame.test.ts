// Regression for iter24 of the design-language audit.
//
// User feedback (2026-05-02 23:30 + screenshot): "这个 tab 没有
// 标题且无法折叠" — pointing at the acceptance surface in the
// right panel, which sat between the Goals and Files section
// frames.
//
// Pre-iter24 the AcceptancePanel rendered as a bare
// `<section class="acceptance-panel">` whose only header was a
// verdict-pill ("IN FLIGHT" / "ACCEPTED" / etc). It had no
// section title saying "Acceptance" and was NOT wrapped in
// `<details>`, so the operator couldn't collapse the surface
// when the verdict + evidence groups + summary were too noisy.
// Meanwhile every neighbouring section (Goals, Files,
// Architect, Requirements, …) sat under a `<details
// class="section">` with a `<summary class="section-head">`
// carrying icon + title + tone badge, and could be folded
// away.
//
// Fix: bake the section frame into the AcceptancePanel
// component itself. Every mount (main.tsx:1054 — the live
// one — and the dead Board.tsx Show=false block) now gets a
// proper `<details class="section">` with the
// section.acceptance title, the acceptance icon, and a
// section-badge whose tone tracks the verdict.
//
// The grep below pins the contract on the source — Bun JSX
// runtime can't render Solid components, so we verify the
// JSX tree shape directly. Future contributors who reorder
// or unwrap the details fail CI immediately.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const BOARD = readFileSync(path.resolve(import.meta.dir, "..", "src", "components", "Board.tsx"), "utf8")

describe("AcceptancePanel renders inside a collapsible section frame", () => {
  // 2026-05-04 follow-up: the bare `<details class="section">` wrapper
  // was promoted into the shared `<Section>` primitive (see
  // `components/primitives/Section.tsx`), which renders the same
  // `<details>` tree but tags it with the namespaced `.oc-section*`
  // class family. Pin the post-migration shape: AcceptancePanel mounts
  // through Section and forwards the IDs the DOM accessors expect.
  test("AcceptancePanel returns a <Section> wrapper as its JSX root", () => {
    const fnStart = BOARD.indexOf("export function AcceptancePanel")
    expect(fnStart).toBeGreaterThan(-1)
    const returnIdx = BOARD.indexOf("return (", fnStart)
    expect(returnIdx).toBeGreaterThan(-1)
    const slice = BOARD.slice(returnIdx, returnIdx + 1200)
    expect(slice).toMatch(/return\s*\(\s*<Section\b/)
  })

  test("the Section wrapper passes icon + title + badge + badgeTone props", () => {
    const fnStart = BOARD.indexOf("export function AcceptancePanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).toContain('title={t("section.acceptance")}')
    expect(slice).toMatch(/icon=\{<Icon\s+name="acceptance"\s*\/>}/)
    expect(slice).toMatch(/badge=\{[^}]*verdictPillLabel/)
    expect(slice).toMatch(/badgeTone=\{/)
  })

  test("the section badge tone reacts to verdict (good / bad / accent)", () => {
    const fnStart = BOARD.indexOf("export function AcceptancePanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).toMatch(/badgeTone=\{[\s\S]*"accepted"[\s\S]*"good"[\s\S]*"rejected"[\s\S]*"bad"[\s\S]*\}/)
  })

  test("the Section forwards id=acceptanceSection and bodyId=acceptanceBody so dom.ts accessors resolve", () => {
    // iter31 functional fix: dom.ts queries `#acceptanceSection` and
    // `#acceptanceBody` to attach data-phase-state. Section forwards
    // both `id` and `bodyId` to the underlying `<details>` /
    // `.oc-section__body` so the highlight pipeline still reaches
    // the real nodes after the primitive migration.
    const fnStart = BOARD.indexOf("export function AcceptancePanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).toContain('id="acceptanceSection"')
    expect(slice).toContain('bodyId="acceptanceBody"')
  })

  test("the <details> does NOT hardcode data-phase-state (owned by syncSectionPhases)", () => {
    // iter31: removed the iter24 hardcoded
    // `data-phase-state={props.acceptance ? "active" :
    // undefined}` — that attribute belongs to
    // `syncSectionPhases` which computes it from the live
    // conversation phase + board state. Hardcoding it
    // here pinned the section to "active" forever whenever
    // acceptance data existed.
    const fnStart = BOARD.indexOf("export function AcceptancePanel")
    const slice = BOARD.slice(fnStart, fnStart + 4000)
    expect(slice).not.toMatch(/data-phase-state=\{props\.acceptance/)
  })
})
