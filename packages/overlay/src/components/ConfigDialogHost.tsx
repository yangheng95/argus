import { For, Show, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import PromptCatalog from "./settings/PromptCatalog";
import ChannelsPanel from "./settings/ChannelsPanel";
import SkillMarketPanel from "./settings/SkillMarketPanel";
import ProvidersPanel from "./settings/ProvidersPanel";
import GeneralPanel from "./settings/GeneralPanel";
import AgentModelsPanel from "./settings/AgentModelsPanel";
import { PermissionsPanel } from "./settings/PermissionsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { Dialog } from "./primitives/Dialog";
import { appStore } from "../store/app";
import { boardStore } from "../store/board";
import { settingsStore } from "../store/settings";
import { closeConfigDialog, setConfigSidebarWidth, switchConfigTab } from "../services/dialog";
import { dialogStore, type ConfigDialogTab } from "../store/dialog";
import { getHostTransport } from "../services/host-transport";
import { t } from "../utils/i18n";
import { currentUIScale } from "../services/pane";
import { Icon } from "./Icon";

interface ConfigTabDef {
  id: ConfigDialogTab;
  labelKey: string;
  icon: JSX.Element;
  badgeID?: string;
}

const CONFIG_TABS: ConfigTabDef[] = [
  {
    id: "general",
    labelKey: "settings.title",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" stroke-width="1.5" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5" />
      </svg>
    ),
  },
  {
    id: "permissions",
    labelKey: "permissions.title",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    ),
  },
  {
    id: "prompt",
    labelKey: "prompt.title",
    badgeID: "promptBadge",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    ),
  },
  {
    id: "channel",
    labelKey: "channel.title",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <path d="M4 11a9 9 0 0 1 9-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <path d="M4 16a14 14 0 0 1 14-14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="5" cy="19" r="2" stroke="currentColor" stroke-width="1.5" />
      </svg>
    ),
  },
  {
    id: "tools",
    labelKey: "extensions.title",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a6 6 0 0 1-7.9 7.9l-5.7 5.7a2.1 2.1 0 0 1-3-3l5.7-5.7a6 6 0 0 1 7.9-7.9l-3.1 3.1z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    ),
  },
  {
    id: "memory",
    labelKey: "memory.title",
    badgeID: "memoryBadge",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M9 18h6M10 21h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    ),
  },
  {
    id: "providers",
    labelKey: "cmdk.settings.providers",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M2 17l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    ),
  },
  {
    id: "agent-models",
    labelKey: "cmdk.settings.agent_models",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.5" />
        <path d="M7 9h10M7 13h6M7 17h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    ),
  },
  {
    id: "about",
    labelKey: "about.title",
    icon: (
      <svg class="config-nav-icon" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" />
        <path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    ),
  },
];

function runtimeTypeLabel(): string {
  const hostKind = getHostTransport().kind;
  if (hostKind === "tauri") return "Tauri Desktop";
  if (hostKind === "vscode") return "VS Code Webview";
  return "Browser";
}

export function ConfigDialogHost() {
  const sidebarStyle = createMemo<Record<string, string>>(() => {
    const width = dialogStore.config.sidebarWidth;
    if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
      return {};
    }
    return {
      width: `${width}px`,
      "min-width": `${width}px`,
    };
  });

  const aboutRows = createMemo(() => {
    const config = appStore.config;
    const rows: Array<[string, string]> = [
      [t("about.rt_overlay"), "v0.0.1-alpha"],
      [t("about.rt_core"), (config as any)?.version || t("about.rt_unavailable")],
      [t("about.rt_server"), settingsStore.serverUrl || "-"],
      [t("about.rt_pid"), typeof appStore.serverPid === "number" ? String(appStore.serverPid) : "-"],
      [t("about.rt_connection"), appStore.config !== null ? t("about.rt_connected") : t("about.rt_disconnected")],
      [t("about.rt_directory"), settingsStore.directory || "-"],
      [t("about.rt_executor"), settingsStore.executor || "-"],
      [t("about.rt_tasks"), String(boardStore.tasks?.length || 0)],
    ];
    if ((config as any)?.platform) rows.push([t("about.platform"), String((config as any).platform)]);
    if ((config as any)?.goVersion) rows.push([t("about.go_version"), String((config as any).goVersion)]);
    rows.push([t("about.runtime_type"), runtimeTypeLabel()]);
    return rows;
  });

  const startResize = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (event.button !== 0) return;
    const sidebar = document.getElementById("configSidebar");
    const layout = sidebar?.parentElement;
    if (!sidebar || !layout) return;
    event.currentTarget.dataset.active = "true";
    document.body.dataset.resizing = "true";
    event.preventDefault();
    const scale = currentUIScale();
    const min = 140 * scale;
    const max = 320 * scale;
    const onMove = (moveEvent: PointerEvent) => {
      const rect = layout.getBoundingClientRect();
      const next = Math.round(Math.min(max, Math.max(min, moveEvent.clientX - rect.left)));
      setConfigSidebarWidth(next);
    };
    const onUp = () => {
      delete event.currentTarget.dataset.active;
      delete document.body.dataset.resizing;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

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
      <div class="config-dialog-layout">
        <nav class="config-sidebar" id="configSidebar" style={sidebarStyle()}>
          <For each={CONFIG_TABS.slice(0, 8)}>
            {(tab) => (
              <button
                type="button"
                classList={{
                  "config-nav-item": true,
                  active: dialogStore.config.activeTab === tab.id,
                }}
                data-config-tab={tab.id}
                onClick={() => switchConfigTab(tab.id)}
              >
                {tab.icon}
                <span>{t(tab.labelKey)}</span>
                <Show when={tab.badgeID}>
                  <span class="config-nav-badge" id={tab.badgeID} />
                </Show>
              </button>
            )}
          </For>
          <div class="config-nav-spacer" />
          <button
            type="button"
            classList={{
              "config-nav-item": true,
              active: dialogStore.config.activeTab === "about",
            }}
            data-config-tab="about"
            onClick={() => switchConfigTab("about")}
          >
            {CONFIG_TABS[8].icon}
            <span>{t(CONFIG_TABS[8].labelKey)}</span>
          </button>
        </nav>
        <div class="config-resizer" id="configResizer" onPointerDown={startResize} />
        <div class="config-content" id="configContent">
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "general" }} data-config-panel="general">
            <div class="config-section-body" id="generalBody">
              <GeneralPanel />
            </div>
          </div>
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "permissions" }} data-config-panel="permissions">
            <div class="config-section-body" id="permissionsBody">
              <PermissionsPanel />
            </div>
          </div>
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "prompt" }} data-config-panel="prompt">
            <div class="config-section-body" id="promptBody">
              <PromptCatalog />
            </div>
          </div>
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "channel" }} id="channelSection" data-config-panel="channel">
            <div class="config-section-body" id="channelConfigBody">
              <ChannelsPanel />
            </div>
          </div>
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "tools" }} data-config-panel="tools">
            <div class="config-section-body" id="toolsConfigBody">
              <SkillMarketPanel />
            </div>
          </div>
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "memory" }} data-config-panel="memory">
            <div class="config-section-body" id="memoryBody">
              <MemoryPanel taskID={boardStore.selectedTaskID || undefined} />
            </div>
          </div>
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "providers" }} data-config-panel="providers">
            <div class="config-section-body" id="providersConfigBody">
              <ProvidersPanel />
            </div>
          </div>
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "agent-models" }} data-config-panel="agent-models">
            <div class="config-section-body" id="agentModelsBody">
              <AgentModelsPanel />
            </div>
          </div>
          <div classList={{ "config-tab-panel": true, active: dialogStore.config.activeTab === "about" }} data-config-panel="about">
            <div class="config-section-body about-body" id="aboutBody">
              <div class="about-section">
                <h4 class="about-section-title">{t("about.author_name")}</h4>
                <div class="about-author-card">
                  <div class="about-author-avatar">
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                      <circle cx="20" cy="20" r="19" stroke="var(--accent)" stroke-width="1.5" />
                      <circle cx="20" cy="16" r="6" stroke="var(--text-soft)" stroke-width="1.3" />
                      <path d="M8 34c0-6.6 5.4-12 12-12s12 5.4 12 12" stroke="var(--text-soft)" stroke-width="1.3" />
                    </svg>
                  </div>
                  <div class="about-author-info">
                    <strong class="about-author-name">杨恒@代码生成组</strong>
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
                  <kbd>F12</kbd><span>{t("about.shortcut_devtools")}</span>
                  <kbd>Ctrl +</kbd><span>{t("about.shortcut_zoom_in")}</span>
                  <kbd>Ctrl -</kbd><span>{t("about.shortcut_zoom_out")}</span>
                  <kbd>Ctrl 0</kbd><span>{t("about.shortcut_zoom_reset")}</span>
                  <kbd>Enter</kbd><span>{t("about.shortcut_send")}</span>
                  <kbd>Shift+Enter</kbd><span>{t("about.shortcut_newline")}</span>
                  <kbd>Esc</kbd><span>{t("about.shortcut_close")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
