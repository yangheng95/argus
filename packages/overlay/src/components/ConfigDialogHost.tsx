import { For, Show, createMemo, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import PromptCatalog from "./settings/PromptCatalog"
import ChannelsPanel from "./settings/ChannelsPanel"
import { McpPanel, SkillMarketPanel, SkillsPanel } from "./settings/SkillMarketPanel"
import ProvidersPanel from "./settings/ProvidersPanel"
import GeneralPanel from "./settings/GeneralPanel"
import AgentModelsPanel from "./settings/AgentModelsPanel"
import NetworkPanel from "./settings/NetworkPanel"
import { PermissionsPanel } from "./settings/PermissionsPanel"
import { MemoryPanel } from "./MemoryPanel"
import { Dialog } from "./primitives/Dialog"
import { Tab, TabList, TabPanel, Tabs } from "./ui/Tabs"
import { appStore } from "../store/app"
import { boardStore, activeTaskID } from "../store/board"
import { settingsStore } from "../store/settings"
import { closeConfigDialog, setConfigSidebarWidth, switchConfigTab } from "../services/dialog"
import { dialogStore, CONFIG_SECTIONS, type ConfigDialogTab } from "../store/dialog"
import { getHostTransport } from "../services/host-transport"
import { t } from "../utils/i18n"
import { OVERLAY_VERSION } from "../utils/version"
import { currentUIScale } from "../services/pane"
import { Icon, type IconName } from "./Icon"
import {
  clampConfigSidebarWidth,
  configSidebarResizeBounds,
  nextConfigSidebarKeyboardWidth,
} from "./settings/config-resizer"

interface ConfigTabDef {
  id: ConfigDialogTab
  labelKey: string
  icon: IconName
  badgeID?: string
}

// Per-section icons (and badge anchors) are dialog chrome and stay local;
// the section list, labels, and order come from CONFIG_SECTIONS
// (store/dialog.ts — single source). CONFIG_TABS merges the two.
const SECTION_ICONS: Record<ConfigDialogTab, IconName> = {
  general: "config-general",
  permissions: "config-permissions",
  prompt: "config-prompt",
  channel: "config-channel",
  skill: "config-skill",
  "skill-market": "config-skill-market",
  mcp: "config-mcp",
  memory: "config-memory",
  network: "config-network",
  providers: "config-providers",
  "agent-models": "config-agent-models",
  about: "config-about",
}

const SECTION_BADGES: Partial<Record<ConfigDialogTab, string>> = {
  prompt: "promptBadge",
  memory: "memoryBadge",
}

const CONFIG_TABS: ConfigTabDef[] = CONFIG_SECTIONS.map((section) => ({
  id: section.id,
  labelKey: section.labelKey,
  icon: SECTION_ICONS[section.id],
  badgeID: SECTION_BADGES[section.id],
}))

const MAIN_CONFIG_TABS = CONFIG_TABS.filter((tab) => tab.id !== "about")
const ABOUT_CONFIG_TAB = CONFIG_TABS.find((tab) => tab.id === "about") as ConfigTabDef

function activePanelBodyID(tab: ConfigDialogTab): string {
  switch (tab) {
    case "general":
      return "generalBody"
    case "permissions":
      return "permissionsBody"
    case "prompt":
      return "promptBody"
    case "channel":
      return "channelConfigBody"
    case "skill":
      return "skillConfigBody"
    case "skill-market":
      return "skillMarketConfigBody"
    case "mcp":
      return "mcpConfigBody"
    case "memory":
      return "memoryBody"
    case "network":
      return "networkBody"
    case "providers":
      return "providersConfigBody"
    case "agent-models":
      return "agentModelsBody"
    case "about":
      return "aboutBody"
  }
}

function runtimeTypeLabel(): string {
  const hostKind = getHostTransport().kind
  if (hostKind === "tauri") return "Tauri Desktop"
  if (hostKind === "vscode") return "VS Code Webview"
  return "Browser"
}

interface ResizableOptions {
  onStart?: (event: PointerEvent) => boolean | void
  onMove: (dx: number, dy: number, event: PointerEvent) => void
  onEnd?: () => void
}

function useResizable(opts: ResizableOptions) {
  let cleanupSession: (() => void) | undefined

  const clearSession = () => {
    if (!cleanupSession) return
    cleanupSession()
    cleanupSession = undefined
    opts.onEnd?.()
  }

  const startResize = (event: PointerEvent) => {
    clearSession()
    if (opts.onStart?.(event) === false) return
    const startX = event.clientX
    const startY = event.clientY
    const onMove = (moveEvent: PointerEvent) => {
      opts.onMove(moveEvent.clientX - startX, moveEvent.clientY - startY, moveEvent)
    }
    const onEnd = () => clearSession()
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onEnd)
    window.addEventListener("pointercancel", onEnd)
    cleanupSession = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onEnd)
      window.removeEventListener("pointercancel", onEnd)
    }
  }

  onCleanup(clearSession)
  return startResize
}

export function ConfigDialogHost() {
  const sidebarStyle = createMemo<Record<string, string>>(() => {
    const width = dialogStore.config.sidebarWidth
    if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
      return {}
    }
    return {
      width: `${width}px`,
      "min-width": `${width}px`,
    }
  })
  const resizeBounds = createMemo(() => configSidebarResizeBounds(currentUIScale()))
  const currentSidebarWidth = () => {
    const width = dialogStore.config.sidebarWidth
    if (typeof width === "number" && Number.isFinite(width) && width > 0) {
      return clampConfigSidebarWidth(width, resizeBounds())
    }
    const rendered = document.getElementById("configSidebar")?.getBoundingClientRect().width
    if (typeof rendered === "number" && Number.isFinite(rendered) && rendered > 0) {
      return clampConfigSidebarWidth(rendered, resizeBounds())
    }
    return clampConfigSidebarWidth(220 * currentUIScale(), resizeBounds())
  }

  const aboutRows = createMemo(() => {
    const config = appStore.config
    const rows: Array<[string, string]> = [
      [t("about.rt_overlay"), `v${OVERLAY_VERSION}`],
      [t("about.rt_core"), (config as any)?.version || t("about.rt_unavailable")],
      [t("about.rt_server"), settingsStore.serverUrl || "-"],
      [t("about.rt_pid"), typeof appStore.serverPid === "number" ? String(appStore.serverPid) : "-"],
      [t("about.rt_connection"), appStore.config !== null ? t("about.rt_connected") : t("about.rt_disconnected")],
      [t("about.rt_directory"), settingsStore.directory || "-"],
      [t("about.rt_executor"), settingsStore.executor || "-"],
      [t("about.rt_tasks"), String(boardStore.tasks?.length || 0)],
    ]
    if ((config as any)?.platform) rows.push([t("about.platform"), String((config as any).platform)])
    if ((config as any)?.goVersion) rows.push([t("about.go_version"), String((config as any).goVersion)])
    rows.push([t("about.runtime_type"), runtimeTypeLabel()])
    return rows
  })

  const renderActivePanel = () => {
    switch (dialogStore.config.activeTab) {
      case "general":
        return <GeneralPanel />
      case "permissions":
        return <PermissionsPanel />
      case "prompt":
        return <PromptCatalog />
      case "channel":
        return <ChannelsPanel />
      case "skill":
        return <SkillsPanel />
      case "skill-market":
        return <SkillMarketPanel active={true} />
      case "mcp":
        return <McpPanel />
      case "memory":
        return <MemoryPanel taskID={() => activeTaskID() || undefined} />
      case "network":
        return <NetworkPanel />
      case "providers":
        return <ProvidersPanel />
      case "agent-models":
        return (
          <AgentModelsPanel
            scope={dialogStore.config.agentModelsScope}
            sessionID={dialogStore.config.agentModelsSessionID ?? undefined}
          />
        )
      case "about":
        return (
          <>
            <div class="about-section">
              <h4 class="about-section-title">{t("about.author_name")}</h4>
              <div class="about-author-card">
                <div class="about-author-avatar">
                  <Icon name="avatar-user" size={40} />
                </div>
                <div class="about-author-info">
                  <strong class="about-author-name">杨恒@Hithink Research</strong>
                </div>
              </div>
            </div>
            <div class="about-section">
              <h4 class="about-section-title">{t("about.runtime")}</h4>
              <div class="about-info-grid" id="aboutRuntimeGrid">
                <For each={aboutRows()}>
                  {(row) => (
                    <>
                      <div class="about-info-label">{row[0]}</div>
                      <div class="about-info-value">{row[1]}</div>
                    </>
                  )}
                </For>
              </div>
            </div>
            <div class="about-section">
              <h4 class="about-section-title">{t("about.links")}</h4>
              <div class="about-links">
                <a class="about-link" href="https://github.com/yangheng95" target="_blank" rel="noopener">
                  <Icon name="github" />
                  <span>GitHub</span>
                </a>
                <a class="about-link" href="https://github.com/yangheng95" target="_blank" rel="noopener">
                  <Icon name="info-circle" />
                  <span>{t("about.issues")}</span>
                </a>
              </div>
            </div>
            <div class="about-section">
              <h4 class="about-section-title">{t("about.shortcuts")}</h4>
              <div class="about-shortcut-grid">
                <kbd>F12</kbd>
                <span>{t("about.shortcut_devtools")}</span>
                <kbd>Ctrl +</kbd>
                <span>{t("about.shortcut_zoom_in")}</span>
                <kbd>Ctrl -</kbd>
                <span>{t("about.shortcut_zoom_out")}</span>
                <kbd>Ctrl 0</kbd>
                <span>{t("about.shortcut_zoom_reset")}</span>
                <kbd>Enter</kbd>
                <span>{t("about.shortcut_send")}</span>
                <kbd>Shift+Enter</kbd>
                <span>{t("about.shortcut_newline")}</span>
                <kbd>Esc</kbd>
                <span>{t("about.shortcut_close")}</span>
              </div>
            </div>
          </>
        )
    }
  }

  let resizeHandle: HTMLDivElement | undefined
  let resizeStartWidth = 0
  let resizeMin = 0
  let resizeMax = 0
  const startResize = useResizable({
    onStart: (event) => {
      if (event.button !== 0) return false
      const sidebar = document.getElementById("configSidebar")
      if (!sidebar) return false
      resizeHandle = event.currentTarget as HTMLDivElement
      resizeHandle.dataset.active = "true"
      document.body.dataset.resizing = "true"
      event.preventDefault()
      const bounds = resizeBounds()
      resizeStartWidth = sidebar.getBoundingClientRect().width
      resizeMin = bounds.min
      resizeMax = bounds.max
      return true
    },
    onMove: (dx) => {
      const next = clampConfigSidebarWidth(resizeStartWidth + dx, { min: resizeMin, max: resizeMax, step: 1 })
      setConfigSidebarWidth(next)
    },
    onEnd: () => {
      if (resizeHandle) delete resizeHandle.dataset.active
      resizeHandle = undefined
      delete document.body.dataset.resizing
    },
  })
  const handleResizeKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    const next = nextConfigSidebarKeyboardWidth(currentSidebarWidth(), event.key, resizeBounds())
    if (next === undefined) return
    event.preventDefault()
    setConfigSidebarWidth(next)
  }

  return (
    <Dialog
      id="configDialog"
      open={dialogStore.config.open}
      wider={true}
      title={t("config.title")}
      onClose={closeConfigDialog}
      headerActions={
        <button
          type="button"
          class="config-close-btn"
          id="btnCloseConfigDialog"
          aria-label={t("common.close")}
          onClick={closeConfigDialog}
        >
          <Icon name="close" size={14} strokeWidth={1.5} />
        </button>
      }
    >
      <Show when={dialogStore.config.open}>
        <Tabs
          value={dialogStore.config.activeTab}
          onValueChange={switchConfigTab}
          orientation="vertical"
          class="config-dialog-layout"
        >
          <nav class="config-sidebar" id="configSidebar" style={sidebarStyle()}>
            <TabList size="md" tone="neutral" data-ui="settings-dialog-tablist">
              <For each={MAIN_CONFIG_TABS}>
                {(tab) => (
                  <Tab
                    value={tab.id}
                    active={dialogStore.config.activeTab === tab.id}
                    size="md"
                    tone="neutral"
                    data-config-tab={tab.id}
                  >
                    <Icon class="config-nav-icon" name={tab.icon} size={18} />
                    <span>{t(tab.labelKey)}</span>
                    <Show when={tab.badgeID}>
                      <span class="config-nav-badge" id={tab.badgeID} />
                    </Show>
                  </Tab>
                )}
              </For>
              <Tab
                value="about"
                active={dialogStore.config.activeTab === "about"}
                size="md"
                tone="neutral"
                data-config-tab="about"
              >
                <Icon class="config-nav-icon" name={ABOUT_CONFIG_TAB.icon} size={18} />
                <span>{t(ABOUT_CONFIG_TAB.labelKey)}</span>
              </Tab>
            </TabList>
          </nav>
          <div
            class="config-resizer"
            id="configResizer"
            role="separator"
            aria-orientation="vertical"
            aria-controls="configSidebar"
            aria-label={t("config.title")}
            aria-valuemin={Math.round(resizeBounds().min)}
            aria-valuemax={Math.round(resizeBounds().max)}
            aria-valuenow={currentSidebarWidth()}
            tabIndex={0}
            title={t("config.title")}
            onPointerDown={startResize}
            onKeyDown={handleResizeKeyDown}
          />
          <div class="config-content" id="configContent">
            <For each={CONFIG_TABS}>
              {(tab) => (
                <TabPanel
                  value={tab.id}
                  class="config-tab-panel"
                  data-config-panel={tab.id}
                  id={tab.id === "channel" ? "channelSection" : undefined}
                >
                  <Show when={dialogStore.config.activeTab === tab.id}>
                    <div
                      classList={{ "config-section-body": true, "about-body": tab.id === "about" }}
                      id={activePanelBodyID(tab.id)}
                    >
                      {renderActivePanel()}
                    </div>
                  </Show>
                </TabPanel>
              )}
            </For>
          </div>
        </Tabs>
      </Show>
    </Dialog>
  )
}
