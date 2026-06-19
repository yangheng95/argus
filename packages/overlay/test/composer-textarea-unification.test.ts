// Composer textarea unification (spec: composer-textarea-unification-2026-05-28).
//
// Operator report: the goal dialog's acceptance textarea clipped long content
// with no visible scrollbar, and the goal / mission / chat inputs were three
// different textarea implementations. Fix: one shared <AutoGrowTextarea>
// primitive (single source for auto-grow) + a `.composer-textarea` chrome that
// re-enables a visible scrollbar over the global hide in cascade/base.css.
//
// These guards pin both halves: the cap logic (pure) and the structural reuse
// (so a future edit cannot silently regress back to a bespoke / fixed,
// scrollbar-hidden textarea).

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { autoGrowHeight, DEFAULT_MAX_VISIBLE_LINES } from "../src/components/primitives/AutoGrowTextareaMetrics"

const SRC = path.resolve(import.meta.dir, "..", "src")
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8")

describe("autoGrowHeight cap logic", () => {
  test("returns the content height while below the line cap", () => {
    expect(autoGrowHeight({ scrollHeight: 80, lineHeight: 20, padTop: 8, padBottom: 8, maxLines: 10 })).toBe(80)
  })

  test("clamps to the maxLines ceiling once content overflows", () => {
    // ceiling = ceil(20*3 + 8 + 8) = 76
    expect(autoGrowHeight({ scrollHeight: 500, lineHeight: 20, padTop: 8, padBottom: 8, maxLines: 3 })).toBe(76)
  })

  test("the shared default cap is 10 visible lines", () => {
    expect(DEFAULT_MAX_VISIBLE_LINES).toBe(10)
  })
})

describe("goal / mission / chat / agent reply reuse the AutoGrowTextarea primitive", () => {
  test("goal dialog migrated both fields off the fixed field-input textarea", () => {
    const goal = read("components/GoalDialogHost.tsx")
    expect(goal).toContain("AutoGrowTextarea")
    // No raw <textarea> left behind, and the fixed scrollbar-hidden field-input
    // textareas are gone.
    expect(goal).not.toMatch(/<textarea\b/)
  })

  test("mission launcher reuses the main ChatComposer input surface", () => {
    const mission = read("components/Mission.tsx")
    const main = read("main.tsx")
    expect(mission).not.toContain("<ChatComposer")
    expect(main).toContain("<ChatComposer")
    expect(main).toContain("missionSubmitActive()")
    expect(main).toContain('"mission-composer-input"')
    expect(main).toContain("function missionLedgerActive()")
    expect(main).toContain("draftKey={panelComposerDraftKey()}")
    expect(mission).not.toMatch(/<textarea\b/)
  })

  test("chat composer renders the primitive and no longer owns the auto-grow cap", () => {
    const chat = read("components/ChatComposer.tsx")
    expect(chat).toContain("AutoGrowTextarea")
    expect(chat).toContain("setComposerDraft")
    expect(chat).toContain("clearComposerDraft")
    expect(chat).not.toMatch(/<textarea\b/)
    // The line cap is single-sourced in the primitive now.
    expect(chat).not.toContain("MAX_VISIBLE_LINES")
  })

  test("agent session reply box uses the shared primitive with the compact two-row cap", () => {
    const reply = read("components/AgentSessionReplyBox.tsx")
    expect(reply).toContain('import { AutoGrowTextarea } from "./primitives/AutoGrowTextarea"')
    expect(reply).toContain("<AutoGrowTextarea")
    expect(reply).toContain("rows={2}")
    expect(reply).toContain("maxLines={2}")
    expect(reply).not.toMatch(/<textarea\b/)
  })

  test("interaction question custom replies reuse the shared primitive and form textarea chrome", () => {
    const interaction = read("components/InteractionCard.tsx")
    const cardCss = read("styles/surfaces/card.css")
    expect(interaction).toContain('import { AutoGrowTextarea } from "./primitives/AutoGrowTextarea"')
    expect(interaction).toContain("<AutoGrowTextarea")
    expect(interaction).toContain('class="composer-textarea interaction-card__custom-input"')
    expect(interaction).toContain("rows={opts.length > 0 ? 1 : 3}")
    expect(interaction).toContain("maxLines={6}")
    expect(interaction).not.toMatch(/<textarea\b/)
    expect(cardCss).not.toMatch(/\.interaction-card__custom-input\s*\{/)
  })

  test("settings long-text editors reuse the shared primitive and form textarea chrome", () => {
    const promptCatalog = read("components/settings/PromptCatalog.tsx")
    const providers = read("components/settings/ProvidersPanel.tsx")
    const settingsCss = read("styles/surfaces/settings.css")

    expect(promptCatalog).toContain('import { AutoGrowTextarea } from "../primitives/AutoGrowTextarea"')
    expect(promptCatalog).toContain("<AutoGrowTextarea")
    expect(promptCatalog).toContain('class="composer-textarea prompt-profile-description"')
    expect(promptCatalog).toContain('class="composer-textarea prompt-profile-textarea"')
    expect(promptCatalog).not.toMatch(/<textarea\b/)

    expect(providers).toContain('import { AutoGrowTextarea } from "../primitives/AutoGrowTextarea"')
    expect(providers).toContain("<AutoGrowTextarea")
    expect(providers).toContain('class="composer-textarea provider-models-textarea"')
    expect(providers).not.toMatch(/<textarea\b/)
    expect(settingsCss).not.toMatch(/\.provider-models-textarea\s*\{[^}]*resize:/s)
  })
})

describe(".composer-textarea re-enables a visible scrollbar (goal-dialog clip fix)", () => {
  const field = read("styles/surfaces/field.css")

  test("the rule exists and can scroll on overflow", () => {
    expect(field).toMatch(/\.composer-textarea\s*\{[^}]*overflow-y:\s*auto/)
  })

  test("it opts back into a scrollbar instead of inheriting the global hide", () => {
    // base.css sets `scrollbar-width: none` + `width: 0` globally; this surface
    // must override both, or long content clips with no gutter (the bug).
    expect(field).toMatch(/\.composer-textarea\s*\{[^}]*scrollbar-width:\s*thin/)
    expect(field).toMatch(/\.composer-textarea::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--session-scrollbar-size\)/)
  })
})
