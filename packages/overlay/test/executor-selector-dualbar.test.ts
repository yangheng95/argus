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
const TITLEBAR_SRC = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "components", "titlebar", "TitlebarMenubar.tsx"),
  "utf8",
)
const CSS = readFileSync(path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "composer.css"), "utf8")

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
    expect(CSS).toMatch(/\.executor-dualbar\s*\{[\s\S]*?width:\s*100%/)
    expect(CSS).toMatch(/\.chat-compose-meta-left[\s\S]*?flex:\s*1\s*1\s*100%/)
    expect(CSS).toMatch(/\.executor-popover\s*\{[\s\S]*?left:\s*0/)
    expect(CSS).not.toMatch(/\.executor-chip-slot\[data-side="external"\] \.executor-popover/)
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
