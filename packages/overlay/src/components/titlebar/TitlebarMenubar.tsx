import * as Menubar from "@kobalte/core/menubar"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { appStore } from "../../store/app"
import { boardStore } from "../../store/board"
import { settingsStore, setSettingsStore, saveSettings } from "../../store/settings"
import { patchConfig, syncAgentPromptLocale } from "../../services/config"
import { openDocumentationEntry } from "../../services/documentation"
import { openConfigDialog } from "../../services/dialog"
import { CONFIG_SECTIONS } from "../../store/dialog"
import {
  applyOpacity,
  applyTheme,
  applyZoom,
  sanitizeOpacity,
  sanitizeZoom,
  toggleDevtools,
} from "../../services/theme"
import { themeOptionsForCurrentHost } from "../../services/theme-registry"
import {
  browseDirectory,
  closeProject,
  loadRecentDirectories,
  openDirectory,
  setDirectory,
} from "../../services/workspace"
import { getHostTransport } from "../../services/host-transport"
import { t } from "../../utils/i18n"
import { Button } from "../ui/Button"

type MenuID = "workspace" | "provider" | "run" | "view" | "settings" | "help"

type MenuDef = {
  id: MenuID
  label: string
  compact: string
  accessKey: string
}

const MENU_IDS: MenuID[] = ["workspace", "provider", "run", "view", "settings", "help"]
const MENU_ACCESS_KEYS: Record<MenuID, string> = {
  workspace: "p",
  provider: "a",
  run: "r",
  settings: "g",
  view: "v",
  help: "h",
}

function menuIDForAccessKey(key: string): MenuID | null {
  const normalized = key.toLowerCase()
  return MENU_IDS.find((id) => MENU_ACCESS_KEYS[id] === normalized) ?? null
}

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

function configNumber(path: "max_executor_groups"): number | null {
  const raw = (appStore.config as any)?.assistant?.max_executor_groups
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function projectModel(): string {
  const model = (appStore.config as any)?.model
  return typeof model === "string" ? model : ""
}

function providerLabel(): string {
  const model = projectModel()
  if (!model.includes("/")) return t("agent_models.option_not_set")
  return model
}

function activeTaskLabel(): string {
  const task = (boardStore.board as any)?.task
  const status = String(task?.status || "").trim()
  return status || t("task.status.idle")
}

function MenuItem(props: {
  children: any
  onClick: () => void | Promise<void>
  meta?: string
  title?: string
  ariaLabel?: string
  disabled?: boolean
  testid?: string
}) {
  const fallbackTitle = () => (typeof props.children === "string" ? props.children : undefined)
  const tooltip = () => props.title || props.meta || fallbackTitle()
  return (
    <Menubar.Item
      as="button"
      type="button"
      class="titlebar-menubar-item"
      disabled={props.disabled}
      data-testid={props.testid}
      title={tooltip()}
      aria-label={props.ariaLabel || tooltip()}
      onSelect={() => void props.onClick()}
    >
      <span class="titlebar-menubar-item-title">{props.children}</span>
      <Show when={props.meta}>
        <span class="titlebar-menubar-item-meta">{props.meta}</span>
      </Show>
    </Menubar.Item>
  )
}

function MenuGroup(props: { title: string; children: any }) {
  return (
    <Menubar.Group class="titlebar-menubar-group">
      <Menubar.GroupLabel class="titlebar-menubar-group-title">{props.title}</Menubar.GroupLabel>
      {props.children}
    </Menubar.Group>
  )
}

function directoryLeaf(dir: string): string {
  return dir.split(/[\\/]/).filter(Boolean).at(-1) || dir
}

function RecentDirectoryMenuItem(props: { dir: string; onClick: () => void | Promise<void> }) {
  return (
    <Menubar.Item
      as="button"
      type="button"
      class="titlebar-menubar-item titlebar-menubar-recent-item"
      title={props.dir}
      onSelect={() => void props.onClick()}
    >
      <span class="titlebar-menubar-recent-name">{directoryLeaf(props.dir)}</span>
      <span class="titlebar-menubar-recent-path">{props.dir}</span>
    </Menubar.Item>
  )
}

function MenuRange(props: {
  label: string
  description: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  disabled?: boolean
  testid?: string
  onChange: (value: number) => void | Promise<void>
}) {
  function commit(event: Event) {
    void props.onChange(Number((event.target as HTMLInputElement).value))
  }

  return (
    <label class="titlebar-menubar-range">
      <span class="titlebar-menubar-range-copy">
        <span class="titlebar-menubar-item-title">{props.label}</span>
        <span class="titlebar-menubar-item-meta">{props.description}</span>
      </span>
      <span class="titlebar-menubar-range-control">
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          disabled={props.disabled}
          aria-label={props.label}
          data-testid={props.testid}
          onInput={commit}
          onChange={commit}
        />
        <span class="titlebar-menubar-range-value" aria-hidden="true">
          {props.value}
          {props.unit || ""}
        </span>
      </span>
    </label>
  )
}

export function TitlebarMenubar() {
  const [openMenu, setOpenMenu] = createSignal<MenuID | null>(null)
  const [autoFocusMenu, setAutoFocusMenu] = createSignal(false)
  const [recentDirs, setRecentDirs] = createSignal<string[]>([])
  let rootRef: HTMLDivElement | undefined
  let altPressedOnly = false

  const menus = createMemo<MenuDef[]>(() => [
    { id: "workspace", label: t("titlebar.menu.workspace"), compact: "P", accessKey: MENU_ACCESS_KEYS.workspace },
    { id: "provider", label: t("titlebar.menu.provider"), compact: "Pr", accessKey: MENU_ACCESS_KEYS.provider },
    { id: "run", label: t("titlebar.menu.run"), compact: "R", accessKey: MENU_ACCESS_KEYS.run },
    { id: "view", label: t("titlebar.menu.view"), compact: "V", accessKey: MENU_ACCESS_KEYS.view },
    { id: "settings", label: t("titlebar.menu.settings"), compact: "Se", accessKey: MENU_ACCESS_KEYS.settings },
    { id: "help", label: t("titlebar.menu.help"), compact: "?", accessKey: MENU_ACCESS_KEYS.help },
  ])

  function closeMenu() {
    setAutoFocusMenu(false)
    setOpenMenu(null)
  }

  function handleMenuValueChange(value: string | null | undefined) {
    if (value && MENU_IDS.includes(value as MenuID)) {
      setRecentDirs(loadRecentDirectories())
      setMenuAnchor(value as MenuID)
      setAutoFocusMenu(true)
      setOpenMenu(value as MenuID)
      return
    }
    closeMenu()
  }

  function setMenuAnchor(id: MenuID) {
    const trigger = document.querySelector<HTMLElement>(`[data-menu-trigger="${id}"]`)
    const left = trigger?.getBoundingClientRect().left ?? 0
    document.documentElement.style.setProperty("--titlebar-menu-anchor-left", `${left}px`)
  }

  function toggleMenuFromTrigger(event: PointerEvent, id: MenuID) {
    if (event.button !== 0 || event.isPrimary === false) return
    event.preventDefault()
    setRecentDirs(loadRecentDirectories())
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    document.documentElement.style.setProperty(
      "--titlebar-menu-anchor-left",
      `${trigger?.getBoundingClientRect().left ?? 0}px`,
    )
    setAutoFocusMenu(false)
    setOpenMenu((current) => (current === id ? null : id))
  }

  function menuTrigger(id: MenuID): HTMLButtonElement {
    const trigger = document.querySelector<HTMLButtonElement>(`[data-menu-trigger="${id}"]`)
    if (!trigger) {
      throw new Error(`Missing titlebar menu trigger: ${id}`)
    }
    return trigger
  }

  function focusTrigger(id: MenuID) {
    menuTrigger(id).focus()
  }

  function focusInitialMenuItem(id: MenuID) {
    queueMicrotask(() => {
      const menu = document.getElementById(`titlebar-menu-${id}`)
      if (!menu) {
        throw new Error(`Missing titlebar menu content: ${id}`)
      }
      const checkedRadio = menu.querySelector<HTMLElement>(
        '[role="menuitemradio"][aria-checked="true"]:not([aria-disabled="true"])',
      )
      const firstItem =
        checkedRadio ??
        menu.querySelector<HTMLElement>(
          '[role="menuitemradio"]:not([aria-disabled="true"]), [role="menuitem"]:not([aria-disabled="true"])',
        )
      if (!firstItem) {
        throw new Error(`Missing focusable titlebar menu item: ${id}`)
      }
      firstItem.focus()
    })
  }

  function openFromKeyboard(id: MenuID) {
    setRecentDirs(loadRecentDirectories())
    setMenuAnchor(id)
    setAutoFocusMenu(true)
    setOpenMenu(id)
    focusInitialMenuItem(id)
  }

  function openConfig(section: string) {
    openConfigDialog(section)
    closeMenu()
  }

  function openDocumentation(id: "quickstart" | "sdk") {
    void openDocumentationEntry(id, settingsStore.locale).finally(closeMenu)
  }

  function openLogs() {
    window.dispatchEvent(new CustomEvent("oc:open-logs"))
    closeMenu()
  }

  async function handlePatchGoalParallelism(value: number) {
    await patchConfig({ assistant: { max_executor_groups: value } })
  }

  async function handlePatchCompactionThreshold(percent: number) {
    const clamped = Math.min(100, Math.max(10, Math.round(percent)))
    const ratio = Math.round(clamped) / 100
    await patchConfig({ compaction: { threshold: ratio } })
  }

  async function handlePatchProposedTaskConfirmation(enabled: boolean) {
    await patchConfig({ experimental: { confirm_proposed_tasks: enabled } })
  }

  function setTheme(value: string) {
    setSettingsStore("theme", value)
    applyTheme(value)
    saveSettings()
  }

  function setLocale(value: string) {
    setSettingsStore("locale", value)
    void syncAgentPromptLocale(value)
    saveSettings()
  }

  function setOpacityPercent(value: number) {
    const next = sanitizeOpacity(value / 100)
    setSettingsStore("opacity", next)
    applyOpacity(next)
    saveSettings()
  }

  function setZoomPercent(value: number) {
    const next = sanitizeZoom(value / 100)
    setSettingsStore("zoom", next)
    applyZoom(next)
    saveSettings()
  }

  function resetLayout() {
    setSettingsStore({
      sidebarWidth: null,
      sectionsWidth: null,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
    })
    saveSettings()
    closeMenu()
  }

  function focusExecutorSelector() {
    closeMenu()
    const activeExecutor = settingsStore.executor === "opencorvus" ? "mirror" : "external"
    const button = document.querySelector<HTMLButtonElement>(`[data-ui="executor-chip-${activeExecutor}"]`)
    button?.focus()
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        altPressedOnly = true
        event.preventDefault()
        return
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const id = menuIDForAccessKey(event.key)
        altPressedOnly = false
        event.preventDefault()
        if (id) {
          openFromKeyboard(id)
          return
        }
        closeMenu()
        return
      } else if (event.key !== "Alt") {
        altPressedOnly = false
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt" || !altPressedOnly) return
      altPressedOnly = false
      event.preventDefault()
      const current = openMenu()
      if (current) {
        closeMenu()
        focusTrigger(current)
      } else {
        focusTrigger("workspace")
      }
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("keyup", onKeyUp)
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("keyup", onKeyUp)
    })
  })

  const maxGroups = createMemo(() => clampInt(configNumber("max_executor_groups"), 1, 10))
  const compactionThresholdPercent = createMemo(() => {
    const raw = Number((appStore.config as any)?.compaction?.threshold)
    const ratio = Number.isFinite(raw) && raw > 0 ? raw : 0.9
    return Math.round(ratio * 100)
  })
  const opacityPercent = createMemo(() => Math.round(settingsStore.opacity * 100))
  const zoomPercent = createMemo(() => Math.round(settingsStore.zoom * 100))
  const themeOptions = themeOptionsForCurrentHost()
  const hostCapabilities = getHostTransport().capabilities
  const nativeCommands = hostCapabilities.nativeCommands

  return (
    /* OpenCorvus is the product brand name, so this menubar landmark keeps the literal brand label. */
    <Menubar.Root
      class="titlebar-menubar"
      aria-label="OpenCorvus"
      data-no-drag="true"
      value={openMenu()}
      onValueChange={handleMenuValueChange}
      autoFocusMenu={autoFocusMenu()}
      onAutoFocusMenuChange={setAutoFocusMenu}
      ref={(el) => (rootRef = el)}
    >
      <For each={menus()}>
        {(menu) => (
          <Menubar.Menu value={menu.id} placement="bottom-start" gutter={7} fitViewport slide={false} flip={false}>
            <div class="titlebar-menubar-slot">
              <Menubar.Trigger
                as={Button}
                type="button"
                variant="ghost"
                size="sm"
                tone="neutral"
                data-ui="titlebar-menubar-trigger"
                data-menu-trigger={menu.id}
                data-compact={menu.compact}
                data-access-key={menu.accessKey}
                data-active={openMenu() === menu.id ? "true" : "false"}
                title={menu.label}
                aria-label={menu.label}
                aria-keyshortcuts={`Alt+${menu.accessKey.toUpperCase()}`}
                onPointerDown={(event) => toggleMenuFromTrigger(event, menu.id)}
              >
                <span class="titlebar-menu-trigger-label">{menu.label}</span>
                <span class="titlebar-menu-trigger-compact" aria-hidden="true">
                  {menu.compact}
                </span>
              </Menubar.Trigger>
            </div>
            <Portal>
              <Menubar.Content
                id={`titlebar-menu-${menu.id}`}
                class="titlebar-menubar-panel"
                data-menu={menu.id}
                data-testid={`titlebar-menu-${menu.id}`}
                style={{ transform: "translateX(var(--titlebar-menu-viewport-shift, 0px))" }}
              >
                <Show when={menu.id === "workspace"}>
                  <MenuGroup title={t("titlebar.menu.workspace")}>
                    <div class="titlebar-menubar-note" title={settingsStore.directory}>
                      {settingsStore.directory || t("workspace.no_directory")}
                    </div>
                    <Show when={nativeCommands["workspace.pickDir"]}>
                      <MenuItem onClick={() => void browseDirectory().finally(closeMenu)}>{t("cwd.browse")}</MenuItem>
                    </Show>
                    <Show when={nativeCommands["open-path"]}>
                      <MenuItem
                        onClick={() => void openDirectory().finally(closeMenu)}
                        disabled={!settingsStore.directory}
                      >
                        {t("cwd.open")}
                      </MenuItem>
                    </Show>
                    <MenuItem
                      onClick={() => {
                        closeProject()
                        closeMenu()
                      }}
                      disabled={!settingsStore.directory}
                      testid="titlebar-close-project"
                    >
                      {t("project.close")}
                    </MenuItem>
                  </MenuGroup>
                  <Show when={recentDirs().length > 0}>
                    <MenuGroup title={t("cwd.recent")}>
                      <For each={recentDirs().slice(0, 6)}>
                        {(dir) => (
                          <RecentDirectoryMenuItem
                            dir={dir}
                            onClick={() => void setDirectory(dir).finally(closeMenu)}
                          />
                        )}
                      </For>
                    </MenuGroup>
                  </Show>
                </Show>

                <Show when={menu.id === "provider"}>
                  <MenuGroup title={t("titlebar.menu.provider")}>
                    <div class="titlebar-menubar-note">{providerLabel()}</div>
                    <MenuItem onClick={() => openConfig("providers")} testid="titlebar-open-providers">
                      {t("cmdk.settings.providers")}
                    </MenuItem>
                    <MenuItem onClick={() => openConfig("agent-models")} testid="titlebar-open-agent-models">
                      {t("cmdk.settings.agent_models")}
                    </MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "run"}>
                  <MenuGroup title={t("titlebar.menu.run")}>
                    <MenuItem onClick={focusExecutorSelector} meta={settingsStore.executor}>
                      {t("executor.group")}
                    </MenuItem>
                    <MenuItem onClick={() => undefined} meta={activeTaskLabel()} disabled>
                      {t("task.status.running")}
                    </MenuItem>
                    <label class="titlebar-menubar-toggle">
                      <span>
                        <span class="titlebar-menubar-item-title">{t("titlebar.auto_question")}</span>
                        <span class="titlebar-menubar-item-meta">{t("titlebar.auto_question_hint")}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={(appStore.config as any)?.experimental?.auto_question === true}
                        aria-label={t("titlebar.auto_question")}
                        onChange={(event) =>
                          void patchConfig({
                            experimental: { auto_question: (event.currentTarget as HTMLInputElement).checked },
                          })
                        }
                      />
                    </label>
                    <label class="titlebar-menubar-toggle">
                      <span>
                        <span class="titlebar-menubar-item-title">{t("titlebar.confirm_proposed_tasks")}</span>
                        <span class="titlebar-menubar-item-meta">{t("titlebar.confirm_proposed_tasks_hint")}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={(appStore.config as any)?.experimental?.confirm_proposed_tasks === true}
                        aria-label={t("titlebar.confirm_proposed_tasks")}
                        data-testid="titlebar-confirm-proposed-tasks"
                        onChange={(event) =>
                          void handlePatchProposedTaskConfirmation((event.currentTarget as HTMLInputElement).checked)
                        }
                      />
                    </label>
                    <MenuRange
                      label={t("titlebar.budget_max_executor_groups")}
                      description={t("titlebar.budget_max_executor_groups_hint")}
                      value={maxGroups() ?? 1}
                      min={1}
                      max={10}
                      step={1}
                      disabled={maxGroups() === null}
                      onChange={(value) => handlePatchGoalParallelism(value)}
                    />
                    <MenuRange
                      label={t("titlebar.compaction_threshold")}
                      description={t("titlebar.compaction_threshold_hint")}
                      value={compactionThresholdPercent()}
                      min={10}
                      max={100}
                      step={5}
                      unit="%"
                      testid="titlebar-compaction-threshold-range"
                      onChange={(value) => handlePatchCompactionThreshold(value)}
                    />
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "settings"}>
                  <MenuGroup title={t("config.title")}>
                    <For each={CONFIG_SECTIONS}>
                      {(section) => (
                        <MenuItem onClick={() => openConfig(section.id)} testid={`titlebar-settings-${section.id}`}>
                          {t(section.labelKey)}
                        </MenuItem>
                      )}
                    </For>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "view"}>
                  <MenuGroup title={t("titlebar.menu.view")}>
                    <Menubar.RadioGroup
                      class="titlebar-theme-options titlebar-theme-options-menubar"
                      aria-label={t("settings.theme.label")}
                      value={settingsStore.theme}
                      onChange={setTheme}
                    >
                      <For each={themeOptions}>
                        {(item) => (
                          <Menubar.RadioItem
                            as="button"
                            type="button"
                            class="titlebar-theme-option"
                            value={item.id}
                            textValue={t(`settings.theme.${item.i18nSlug}`)}
                            closeOnSelect={false}
                            data-testid={`titlebar-theme-${item.id}`}
                          >
                            <span class="titlebar-theme-option-swatch" data-theme={item.id} aria-hidden="true" />
                            <span class="titlebar-theme-option-label">{t(`settings.theme.${item.i18nSlug}`)}</span>
                          </Menubar.RadioItem>
                        )}
                      </For>
                    </Menubar.RadioGroup>
                    <MenuItem
                      onClick={() => setLocale(settingsStore.locale === "zh-CN" ? "en-US" : "zh-CN")}
                      meta={settingsStore.locale}
                      testid="titlebar-toggle-locale"
                    >
                      {t("settings.language")}
                    </MenuItem>
                    <MenuRange
                      label={t("settings.opacity.label")}
                      description={t("settings.opacity.hint")}
                      value={opacityPercent()}
                      min={50}
                      max={100}
                      step={1}
                      unit="%"
                      testid="titlebar-opacity-range"
                      onChange={setOpacityPercent}
                    />
                    <MenuRange
                      label={t("titlebar.zoom")}
                      description={t("titlebar.zoom_hint")}
                      value={zoomPercent()}
                      min={80}
                      max={160}
                      step={5}
                      unit="%"
                      testid="titlebar-zoom-range"
                      onChange={setZoomPercent}
                    />
                    <MenuItem onClick={resetLayout}>{t("titlebar.reset_layout")}</MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "help"}>
                  <MenuGroup title={t("titlebar.menu.help")}>
                    <Show when={nativeCommands["open-url"]}>
                      <MenuItem
                        onClick={() => openDocumentation("quickstart")}
                        meta={t("titlebar.docs_hint")}
                        testid="titlebar-help-docs"
                      >
                        {t("titlebar.docs")}
                      </MenuItem>
                      <MenuItem
                        onClick={() => openDocumentation("sdk")}
                        meta={t("titlebar.sdk_hint")}
                        testid="titlebar-help-sdk"
                      >
                        {t("titlebar.sdk")}
                      </MenuItem>
                    </Show>
                    <MenuItem onClick={openLogs} meta={t("titlebar.logs_hint")} testid="titlebar-help-logs">
                      {t("titlebar.logs")}
                    </MenuItem>
                    <Show when={nativeCommands["devtools.toggle"]}>
                      <MenuItem
                        onClick={() => {
                          toggleDevtools()
                          closeMenu()
                        }}
                        meta={t("titlebar.devtools_hint")}
                        testid="titlebar-help-devtools"
                      >
                        {t("titlebar.devtools")}
                      </MenuItem>
                    </Show>
                    <MenuItem
                      onClick={() => openConfig("about")}
                      meta={t("titlebar.about_hint")}
                      testid="titlebar-help-about"
                    >
                      {t("about.title")}
                    </MenuItem>
                  </MenuGroup>
                </Show>
              </Menubar.Content>
            </Portal>
          </Menubar.Menu>
        )}
      </For>
    </Menubar.Root>
  )
}
