// Regression for the bottom-of-composer dual chip contract (2026-05-11):
//
//   1. ExecutorSelector renders two side-by-side chips —
//      [data-ui="executor-chip-mirror"] and
//      [data-ui="executor-chip-external"] — instead of a single chip with
//      embedded dual-model display.
//   2. Each chip has its own popover anchored to the same slot. The mirror
//      popover lists only providers reported as connected; the external
//      popover lists every provider mapped to that executor, but does not
//      claim provider-auth state for executor-managed CLIs.
//   3. The bar fills the composer row so the controls align with the
//      textarea above (flex: 1 1 100% on the meta-left container; the bar
//      itself flexes to span 100%).

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SRC = readFileSync(path.resolve(import.meta.dir, "..", "src", "components", "ExecutorSelector.tsx"), "utf8")
const APP_STORE_SRC = readFileSync(path.resolve(import.meta.dir, "..", "src", "store", "app.ts"), "utf8")
const INIT_SRC = readFileSync(path.resolve(import.meta.dir, "..", "src", "services", "init.ts"), "utf8")
const TITLEBAR_SRC = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "components", "titlebar", "TitlebarMenubar.tsx"),
  "utf8",
)
const CSS = readFileSync(path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "composer.css"), "utf8")

function cssBlock(selector: string): string {
  const marker = `${selector} {`
  const start = CSS.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = CSS.indexOf("\n}", start)
  expect(end).toBeGreaterThan(start)
  return CSS.slice(start, end + 2)
}

describe("ExecutorSelector dual chip bar", () => {
  test("renders two distinct chip buttons rather than a single chip", () => {
    expect(SRC).toMatch(/data-ui=\{`executor-chip-\$\{props\.side\}`\}/)
    expect(SRC).toMatch(/side="mirror"/)
    expect(SRC).toMatch(/side="external"/)
    expect(SRC).not.toMatch(/data-ui="executor-chip"/)
  })

  test("titlebar run menu targets the current dual-chip selectors", () => {
    expect(TITLEBAR_SRC).toContain('`[data-ui="executor-chip-${activeExecutor}"]`')
    expect(TITLEBAR_SRC).toContain('settingsStore.executor === "opencorvus" ? "mirror" : "external"')
    expect(TITLEBAR_SRC).not.toContain('[data-ui="executor-chip"]')
  })

  test("each chip has its own disclosure that closes the other on open", () => {
    expect(SRC).toMatch(/const mirror = useDisclosure\(\)/)
    expect(SRC).toMatch(/const external = useDisclosure\(\)/)
    expect(SRC).toMatch(/function openMirror\(\)[\s\S]*?external\.close\(\)/)
    expect(SRC).toMatch(/function openExternal\(\)[\s\S]*?mirror\.close\(\)/)
  })

  test("chip popover behavior is delegated to Kobalte", () => {
    expect(SRC).toContain('import * as Popover from "@kobalte/core/popover"')
    expect(SRC).toContain("<Popover.Root")
    expect(SRC).toContain("<Popover.Trigger")
    expect(SRC).toContain("<Popover.Portal")
    expect(SRC).toContain("<Popover.Content")
    expect(SRC).not.toContain('document.addEventListener("pointerdown"')
    expect(SRC).not.toContain("useHotkey({")
  })

  test("external picker tabs do not hand-roll focus suppression", () => {
    expect(SRC).toContain('data-ui="executor-popover-tabs"')
    expect(SRC).toContain('data-ui="executor-popover-tab"')
    expect(SRC).not.toContain("onMouseDown")
    expect(SRC).not.toContain("preventDefault")
  })

  test("mirror picker only surfaces models from connected providers", () => {
    expect(SRC).toMatch(/connectedProviderIDs/)
    expect(SRC).toMatch(/function mirrorProviderGroups\(\)[\s\S]*?filter\(\(group\) => group\.available\)/)
  })

  test("Hexin budget row is requested only for the current OpenCorvus Hexin model", () => {
    expect(SRC).toMatch(/getHexinBudget/)
    expect(SRC).toContain("const HEXIN_BUDGET_REFRESH_MS = 10 * 60 * 1000")
    expect(SRC).toContain("const HEXIN_BUDGET_LOW_USD = 20")
    expect(SRC).toMatch(/const hexinBudgetBaseKey = createMemo/)
    expect(SRC).toMatch(/const hexinBudgetKey = createMemo/)
    expect(SRC).toMatch(/parts\.provider !== "hexin" \|\| !parts\.name/)
    expect(SRC).toMatch(/directory: activeDirectory\(\)\.trim\(\)/)
    expect(SRC).toMatch(/providerAuthRefresh: appStore\.providerAuthRefreshRevision/)
    expect(APP_STORE_SRC).toMatch(/providerAuthRefreshRevision: number/)
    expect(INIT_SRC).toMatch(/providerAuthRefreshRevision: appStore\.providerAuthRefreshRevision \+ 1/)
    expect(SRC).toMatch(/window\.setInterval\([\s\S]*?HEXIN_BUDGET_REFRESH_MS/)
    expect(SRC).toMatch(/setHexinBudgetRefreshTick\(\(value\) => value \+ 1\)/)
    expect(SRC).toMatch(/onCleanup\(\(\) => window\.clearInterval\(timer\)\)/)
    expect(SRC).toMatch(/remaining < HEXIN_BUDGET_LOW_USD/)
    expect(SRC).toMatch(/createResource\(hexinBudgetKey/)
    expect(SRC).toMatch(/data-ui="executor-hexin-budget"/)
    expect(SRC).toMatch(/data-low-budget=\{lowBudget\(\) \? "true" : "false"\}/)
    expect(SRC).toMatch(/aria-label=\{title\(\)\}/)
    expect(SRC).toMatch(/executor\.hexin_budget_retry_context/)
    expect(SRC).toMatch(/<Show when=\{hexinBudgetKey\(\)\}>/)
    expect(SRC).toMatch(/meta=\{[\s\S]*?<Show when=\{hexinBudgetKey\(\)\}>/)
    expect(SRC).toMatch(/executor\.hexin_budget_inline/)
  })

  test("external picker lists all configured providers for the executor without provider-auth status badges", () => {
    expect(SRC).toMatch(/EXECUTOR_PROVIDER_MAP\[executorID\]/)
    expect(SRC).toMatch(/buildProviderGroups\(\(id\) => wantedSet\.has\(id\), false, "native"\)/)
    expect(SRC).not.toMatch(/data-available=\{props\.group\.available \? "true" : "false"\}/)
    expect(SRC).not.toMatch(/showAvailability/)
  })

  test("external picker writes native executor model IDs, not provider/model refs", () => {
    expect(SRC).toMatch(/modelIDFormat: "qualified" \| "native" = "qualified"/)
    expect(SRC).toMatch(
      /modelIDFormat === "qualified" \? modelIDs\.map\(\(modelID\) => `\$\{id\}\/\$\{modelID\}`\) : modelIDs/,
    )
    expect(SRC).toMatch(/await setExecutorModel\(executorID, model\)/)
  })

  test("model picker delegates selection semantics to Kobalte listbox", () => {
    expect(SRC).toContain('import * as Listbox from "@kobalte/core/listbox"')
    expect(SRC).toContain("<Listbox.Root<ExecutorModelOption>")
    expect(SRC).toContain('class="executor-model-listbox"')
    expect(SRC).toContain('class="executor-model-option"')
    expect(SRC).toContain('data-model-value={option.id}')
    expect(SRC).not.toContain("<ComboboxControl<ExecutorModelOption>")
    expect(SRC).not.toContain('class="executor-model-combobox"')
    expect(SRC).not.toContain('class="executor-popover-model"')
    expect(SRC).not.toMatch(/data-active=\{modelID === props\.currentModel/)
    expect(SRC).not.toMatch(/aria-current=\{modelID === props\.currentModel/)
    expect(SRC).not.toMatch(/aria-pressed=\{modelID === props\.currentModel/)
  })

  test("mirror selection writes task root session config before project config", () => {
    expect(SRC).toMatch(/import \{ activeTaskID, hasSelectedTask \} from "\.\.\/store\/board"/)
    expect(SRC).toMatch(/import \{[\s\S]*?getTaskOperatorModelContext,[\s\S]*?patchConfig,[\s\S]*?patchSessionConfig/)
    expect(SRC).toMatch(/const \[taskOperatorContext/)
    expect(SRC).toMatch(
      /const taskOperatorContextKey = createMemo\([\s\S]*?if \(!appStore\.connected\) return null[\s\S]*?return \{ taskID: id, refresh: sessionConfigRefreshToken\(\) \}/,
    )
    expect(SRC).toMatch(/return await getTaskOperatorModelContext\(key\.taskID\)/)
    expect(SRC).toMatch(
      /await patchSessionConfig\(ctx\.sessionID, \{[\s\S]*?agent: \{[\s\S]*?\[ctx\.agent\]: \{[\s\S]*?model: value \? value : null/,
    )
    expect(SRC).toMatch(/mutateTaskOperatorContext\(/)
    expect(SRC).toMatch(/await patchConfig\(\{ model: value \? value : null \}\)/)
    expect(SRC.indexOf("patchSessionConfig(ctx.sessionID")).toBeLessThan(SRC.indexOf("patchConfig({ model"))
  })

  test("selected task without resolved root session disables mirror writes without disabling the chip", () => {
    expect(SRC).toMatch(
      /const mirrorWriteDisabled = createMemo\(\(\) => hasSelectedTask\(\) && !currentTaskOperatorContext\(\)\?\.sessionID\)/,
    )
    expect(SRC).toMatch(/refetch: refetchTaskOperatorContext/)
    expect(SRC).toMatch(/function openMirror\(\)[\s\S]*?mirror\.openIt\(\)/)
    expect(SRC).not.toMatch(/function openMirror\(\)[\s\S]*?if \(mirrorWriteDisabled\(\)\) return/)
    expect(SRC).toMatch(/if \(hasSelectedTask\(\)\)[\s\S]*?if \(!ctx\?\.agent \|\| !ctx\.sessionID\)[\s\S]*?return/)
    expect(SRC).toMatch(/data-ui="executor-mirror-context-error"/)
    expect(SRC).toMatch(/onClick=\{retryTaskOperatorContext\}/)
    expect(SRC).toMatch(/disabled=\{props\.disabled\}/)
  })

  test("external selection switches settingsStore.executor and calls setExecutorModel", () => {
    expect(SRC).toMatch(/setSettingsStore\("executor", sanitizeExecutor\(executorID\)\)/)
    expect(SRC).toMatch(/await setExecutorModel\(executorID, model\)/)
  })

  test("none-tab in external popover disables external by switching back to opencorvus", () => {
    expect(SRC).toMatch(/function disableExternal\(\)/)
    expect(SRC).toMatch(/sanitizeExecutor\(INTERNAL_EXECUTOR_ID\)/)
  })

  test("dual bar CSS spans the composer width and both popovers share left-edge anchoring", () => {
    const selectorStackBlock = cssBlock(".executor-selector-stack")
    const metaBlock = cssBlock(".chat-compose-meta")
    const metaLeftBlock = cssBlock(".chat-compose-meta-left")
    const chipButtonBlock = cssBlock('.executor-chip-slot .oc-button[data-ui^="executor-chip-"]')

    expect(selectorStackBlock).toContain("display: block;")
    expect(CSS).toMatch(/\.executor-dualbar\s*\{[\s\S]*?width:\s*100%/)
    expect(metaLeftBlock).toContain("flex: 1 1 100%;")
    const popoverBlock = cssBlock(".executor-popover")
    expect(popoverBlock).not.toContain("left:")
    expect(popoverBlock).not.toContain("bottom:")
    expect(popoverBlock).not.toContain("position:")
    expect(CSS).not.toMatch(/\.executor-chip-slot\[data-side="external"\] \.executor-popover/)
    expect(selectorStackBlock).not.toContain("grid-column: 1 / -1")
    expect(metaBlock).not.toContain("flex-direction: column")
    expect(chipButtonBlock).toContain("--oc-button-padding-x: var(--ui-btn-mini-padding-x);")
    expect(chipButtonBlock).toContain("--oc-button-gap: var(--ui-btn-mini-padding-x);")
    expect(chipButtonBlock).not.toContain("calc(10px * var(--ui-scale))")
    expect(CSS).toMatch(
      /\.executor-chip-slot \.oc-button\[data-ui\^="executor-chip-"\]:hover,\s*\.executor-chip-slot \.oc-button\[data-ui\^="executor-chip-"\]:focus-visible\s*\{[\s\S]*?--oc-button-bg:[\s\S]*?--oc-button-color:[\s\S]*?box-shadow:/,
    )
    expect(CSS).not.toMatch(/\.executor-chip-slot \.oc-button\[data-ui\^="executor-chip-"\]:focus\s*\{/)
  })

  test("Hexin budget CSS belongs to the composer selector surface", () => {
    expect(SRC).toContain('class="executor-budget-inline"')
    expect(SRC).not.toContain('class="executor-budget-row"')
    expect(CSS).toMatch(/\.executor-budget-inline\s*\{/)
    expect(CSS).toMatch(/\.executor-budget-inline\[data-over-budget="true"\]/)
    expect(CSS).toMatch(/\.executor-budget-inline\[data-low-budget="true"\] \.executor-budget-value/)
    expect(CSS).toMatch(/\.executor-budget-value\s*\{[\s\S]*?text-overflow:\s*ellipsis/)
    expect(CSS).not.toMatch(/\.executor-budget-row(?:\s|\.|:|\{|,|\[)/)
    expect(CSS).not.toMatch(/\.executor-budget-error(?:\s|\.|:|\{|,|\[)/)
    expect(CSS).toMatch(/\.executor-chip-label-row\s*\{[\s\S]*?display:\s*flex/)
    expect(CSS).toMatch(/\.executor-chip-slot\s*\{[\s\S]*?flex-direction:\s*row/)
  })

  test("retired key names from the old single-chip design are gone", () => {
    expect(SRC).not.toMatch(/executor\.model_explainer_pair/)
    expect(SRC).not.toMatch(/executor\.role_opencorvus/)
    expect(SRC).not.toMatch(/executor\.role_external/)
    expect(SRC).not.toMatch(/executor\.change_model/)
    expect(SRC).not.toMatch(/executor\.custom_agent_models/)
  })
})

describe("i18n keys for the dual bar exist in both locales", () => {
  const EN = JSON.parse(readFileSync(path.resolve(import.meta.dir, "..", "src", "i18n", "en-US.json"), "utf8"))
  const ZH = JSON.parse(readFileSync(path.resolve(import.meta.dir, "..", "src", "i18n", "zh-CN.json"), "utf8"))
  for (const key of [
    "executor.mirror_chip_title",
    "executor.mirror_chip_aria",
    "executor.hexin_budget_label",
    "executor.hexin_budget_inline",
    "executor.hexin_budget_inline_loading",
    "executor.hexin_budget_inline_error",
    "executor.hexin_budget_retry_context",
    "executor.hexin_budget_value",
    "sidebar.reset_db_missing_context",
    "executor.mirror_popover_title",
    "executor.mirror_popover_hint",
    "executor.mirror_no_connected_providers",
    "executor.external_chip_title",
    "executor.external_chip_title_disabled",
    "executor.external_chip_aria_active",
    "executor.external_chip_aria_disabled",
    "executor.external_popover_title",
    "executor.external_popover_hint",
    "executor.external_disabled",
    "executor.external_disabled_hint",
    "executor.external_no_models",
  ]) {
    test(`${key} present in en-US.json`, () => {
      expect(typeof EN[key]).toBe("string")
      expect((EN[key] as string).length).toBeGreaterThan(0)
    })
    test(`${key} present in zh-CN.json`, () => {
      expect(typeof ZH[key]).toBe("string")
      expect((ZH[key] as string).length).toBeGreaterThan(0)
    })
  }
})
