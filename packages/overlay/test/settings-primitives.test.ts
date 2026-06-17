/**
 * Settings primitives — single-source guard.
 *
 * Asserts that the `.s-*` layer in styles/surfaces/settings.css and
 * the matching Solid components in components/settings/primitives.tsx
 * stay in lockstep. The architecture-guard suite already pins the
 * PermissionsPanel migration; this file owns the primitive contract
 * itself so future panels see the same shape.
 *
 * See specs/overlay-settings-primitives-2026-05-26.md.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SETTINGS_CSS = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"), "utf8")
const PRIMITIVES_SRC = readFileSync(join(OVERLAY_ROOT, "src/components/settings/primitives.tsx"), "utf8")
const SEGMENTED_SRC = readFileSync(join(OVERLAY_ROOT, "src/components/ui/SegmentedControl.tsx"), "utf8")
const AGENT_MODELS_SRC = readFileSync(join(OVERLAY_ROOT, "src/components/settings/AgentModelsPanel.tsx"), "utf8")
const SKILL_MARKET_SRC = readFileSync(join(OVERLAY_ROOT, "src/components/settings/SkillMarketPanel.tsx"), "utf8")

describe("settings primitives — CSS contract", () => {
  test.each([
    "s-panel",
    "s-group",
    "s-group-head",
    "s-group-head-title",
    "s-group-head-actions",
    "s-group-body",
    "s-row",
    "s-row-leading",
    "s-row-main",
    "s-row-title",
    "s-row-desc",
    "s-row-meta",
    "s-row-actions",
    "s-pill",
    "s-toolbar",
    "s-empty",
    "s-segmented",
    "s-segmented-btn",
  ])("settings.css declares .%s", (cls) => {
    // accept the class being the head of a multi-selector rule or carrying
    // a state/data attribute/pseudo (e.g. `.s-row + .s-row`,
    // `.s-pill[data-tone="ok"]`, `.s-row:hover`).
    expect(SETTINGS_CSS).toMatch(new RegExp(`(^|\\n)\\.${cls}\\s*[\\[\\{,:+>~]`))
  })

  test("primitives use design tokens, not raw px", () => {
    // Carve the primitive block out and check that all padding/gap inside
    // it routes through tokens — no `Npx` literals inside the block.
    const start = SETTINGS_CSS.indexOf("PRIMITIVE LAYER")
    const end = SETTINGS_CSS.indexOf("/* ── PermissionsPanel.tsx", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = SETTINGS_CSS.slice(start, end)
    // Allow `Npx` inside calc() (existing convention across the codebase)
    // and the literal `0` (unitless zero is the canonical "none"), but
    // disallow bare `padding: 8px` style literals on the property.
    const bareLiterals = block.match(
      /^\s*(padding|margin|gap|width|height|min-height|max-height|top|right|bottom|left)\s*:\s*[1-9]/gm,
    )
    expect(bareLiterals).toBeNull()
  })

  test("pill tones cover the semantic palette", () => {
    for (const tone of ["ok", "warn", "bad", "accent", "muted"]) {
      expect(SETTINGS_CSS).toMatch(new RegExp(`\\.s-pill\\[data-tone="${tone}"\\]\\s*\\{`))
    }
  })

  test("segmented active states wire through good/warn/bad/accent/neutral", () => {
    for (const tone of ["ok", "warn", "bad", "accent", "neutral"]) {
      expect(SETTINGS_CSS).toMatch(
        new RegExp(`\\.s-segmented-btn\\[data-active="true"\\]\\[data-tone="${tone}"\\]\\s*\\{`),
      )
    }
  })

  test("rows hover wash is opt-in via data-interactive", () => {
    expect(SETTINGS_CSS).toMatch(
      /\.s-row\[data-interactive="true"\]:hover,\s*\.s-row\[data-interactive="true"\]:focus-within\s*\{/,
    )
  })

  test("row+row separator stays out of layout flow", () => {
    // We want a hairline divider that does not contribute height —
    // box-shadow (inset 0 1px 0) gives that; border-bottom would add 1px.
    // The 1px hairline is wrapped in calc(... var(--ui-scale)) so the
    // surface-wide raw-px guard stays satisfied.
    expect(SETTINGS_CSS).toMatch(
      /\.s-row\s*\+\s*\.s-row\s*\{[^}]*box-shadow:\s*inset\s+0\s+calc\(1px\s*\*\s*var\(--ui-scale\)\)/,
    )
  })
})

describe("settings primitives — Solid exports", () => {
  test("primitives module exports every documented component", () => {
    for (const name of [
      "SettingsPanel",
      "SettingsGroup",
      "SettingsRow",
      "SettingsPill",
      "SettingsToolbar",
      "SettingsEmpty",
      "SettingsSelect",
      "SettingsSegmented",
    ]) {
      expect(PRIMITIVES_SRC).toContain(`export function ${name}`)
    }
  })

  test("Pill tone type is exported alongside the component", () => {
    expect(PRIMITIVES_SRC).toContain("export type SettingsPillTone")
    for (const tone of ["ok", "warn", "bad", "accent", "muted", "neutral"]) {
      expect(SEGMENTED_SRC).toContain(`"${tone}"`)
    }
  })

  test("Row exposes the documented slots", () => {
    for (const slot of ["leading", "title", "desc", "meta", "actions", "children"]) {
      expect(PRIMITIVES_SRC).toMatch(new RegExp(`${slot}\\?:`))
    }
  })

  test("Segmented compares before firing onChange to avoid duplicate writes", () => {
    // Important: PermissionsPanel.patchConfig hits the network on every
    // setPermission call. The primitive must early-return when the
    // clicked option is already active.
    expect(SEGMENTED_SRC).toMatch(/if\s*\(\s*next\s*&&\s*next\s*!==\s*props\.value\s*\)\s*props\.onChange/)
  })

  test("Segmented delegates toggle semantics to the shared Kobalte primitive", () => {
    expect(PRIMITIVES_SRC).toContain('import { SegmentedControl')
    expect(PRIMITIVES_SRC).toContain("<SegmentedControl")
    expect(PRIMITIVES_SRC).not.toContain("@kobalte/core/toggle-group")
    expect(SEGMENTED_SRC).toContain(
      'import { Item as KobalteToggleGroupItem, Root as KobalteToggleGroupRoot } from "@kobalte/core/toggle-group"',
    )
    expect(SEGMENTED_SRC).toContain("<KobalteToggleGroupRoot")
    expect(SEGMENTED_SRC).toContain("<KobalteToggleGroupItem")
    expect(SEGMENTED_SRC).toContain("onClick={() => props.onActivate?.(option.value)}")
    expect(PRIMITIVES_SRC).not.toContain('role="group"')
    expect(PRIMITIVES_SRC).not.toContain("aria-pressed")
  })

  test("Select delegates combobox semantics to Kobalte with one accessible label source", () => {
    expect(PRIMITIVES_SRC).toContain('import * as Select from "@kobalte/core/select"')
    expect(PRIMITIVES_SRC).toContain("export interface SettingsSelectOption")
    expect(PRIMITIVES_SRC).toContain("export function SettingsSelect")
    expect(PRIMITIVES_SRC).toContain("<Select.Root<T>")
    expect(PRIMITIVES_SRC).toContain("<Select.Trigger")
    expect(PRIMITIVES_SRC).toContain("<Select.HiddenSelect aria-label={props.ariaLabel}")
    expect(PRIMITIVES_SRC).toContain("aria-label={props.ariaLabel}")
    expect(PRIMITIVES_SRC).toContain("props.optionData?.(option())")
    expect(PRIMITIVES_SRC).toContain('props.optionTextClass ? `oc-select-option-copy ${props.optionTextClass}`')
    expect(PRIMITIVES_SRC).toContain("class={optionTextClass()}")
    expect(PRIMITIVES_SRC).toContain(
      "const selectedOption = () => props.options.find((option) => option.value === props.value) ?? null",
    )
    expect(PRIMITIVES_SRC).not.toContain("?? props.options[0]")
  })

  test("settings panels reuse SettingsSelect instead of local Select wrappers", () => {
    for (const source of [AGENT_MODELS_SRC, SKILL_MARKET_SRC]) {
      expect(source).toContain("SettingsSelect")
      expect(source).not.toContain('import * as Select from "@kobalte/core/select"')
      expect(source).not.toContain("<Select.Root")
      expect(source).not.toContain("<Select.Trigger")
      expect(source).not.toContain("<Select.HiddenSelect")
      expect(source).not.toMatch(/function \w*SelectOptionItem/)
    }
  })
})

describe("PermissionsPanel — primitive adoption", () => {
  const panelSrc = readFileSync(join(OVERLAY_ROOT, "src/components/settings/PermissionsPanel.tsx"), "utf8")

  test("imports the primitive components", () => {
    expect(panelSrc).toContain('from "./primitives"')
    for (const name of ["SettingsPanel", "SettingsGroup", "SettingsRow", "SettingsSegmented"]) {
      expect(panelSrc).toContain(name)
    }
  })

  test("does not reference any legacy perm-* class", () => {
    expect(panelSrc).not.toMatch(/perm-(?:panel|row|list|action-btn)/)
  })

  test("segmented tone map matches the perm semantic contract", () => {
    // allow → ok (good), ask → warn, deny → bad. The visual contract was
    // already baked into the old perm-action-btn[data-action="..."] CSS;
    // the migration must preserve it via data-tone on the primitive.
    expect(panelSrc).toMatch(/value:\s*"allow"[\s\S]{0,80}tone:\s*"ok"/)
    expect(panelSrc).toMatch(/value:\s*"ask"[\s\S]{0,80}tone:\s*"warn"/)
    expect(panelSrc).toMatch(/value:\s*"deny"[\s\S]{0,80}tone:\s*"bad"/)
  })
})
