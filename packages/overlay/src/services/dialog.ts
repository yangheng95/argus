// ── Dialog Service ──
// Manages dialog open/close, config tab switching, and backdrop close handlers.
// All legacy window-bridge calls (legacyFn) have been replaced with direct
// imports as of Phase 4 cleanup.

import { settingsStore, setSettingsStore, saveSettings } from "../store/settings";
import { boardStore } from "../store/board";
import { appStore } from "../store/app";
import { loadConfigInfo } from "./init";
import { apiJson, configure as configureApi } from "./api";
import { t } from "../utils/i18n";

// ── Public API ──

/**
 * Open the channel configuration dialog.
 *
 * ChannelsPanel.tsx handles its own inline editing, so this function
 * simply opens the config dialog and switches to the channel tab.
 */
export async function openChannelSettings(_channelID?: string): Promise<void> {
  openConfigDialog("channel");
}

/**
 * Open the server / connection settings dialog.
 *
 * Pre-populates the URL, password, and username inputs from settingsStore,
 * then shows the dialog.
 */
export function openServerSettings(): void {
  const serverUrl = document.getElementById(
    "serverUrl",
  ) as HTMLInputElement | null;
  const serverPassword = document.getElementById(
    "serverPassword",
  ) as HTMLInputElement | null;
  const serverUsername = document.getElementById(
    "serverUsername",
  ) as HTMLInputElement | null;
  const settingsDialog = document.getElementById(
    "settingsDialog",
  ) as HTMLDialogElement | null;

  if (serverUrl) serverUrl.value = settingsStore.serverUrl;
  if (serverPassword) serverPassword.value = settingsStore.password;
  if (serverUsername) serverUsername.value = settingsStore.username;

  settingsDialog?.showModal();
}

/**
 * Switch the active tab in the config sidebar.
 */
export function switchConfigTab(tabName: string): void {
  const sidebar = document.getElementById("configSidebar");
  const content = document.getElementById("configContent");
  if (!sidebar || !content) return;

  for (const btn of sidebar.querySelectorAll(".config-nav-item")) {
    const el = btn as HTMLElement;
    el.classList.toggle("active", el.dataset.configTab === tabName);
  }

  for (const panel of content.querySelectorAll(".config-tab-panel")) {
    const el = panel as HTMLElement;
    el.classList.toggle("active", el.dataset.configPanel === tabName);
  }
}

/**
 * Focus a named config section inside the config dialog.
 */
export function focusConfigSection(name: string): void {
  if (!name) return;
  switchConfigTab(name);
  if (name === "channel") {
    const channelList = document.getElementById("channelList") as HTMLElement | null;
    channelList?.scrollTo?.({ top: 0 });
  }
}

/**
 * Populate the About panel runtime grid with server/platform info.
 */
function renderAboutVersion(): void {
  const grid = document.getElementById("aboutRuntimeGrid");
  if (!grid) return;

  const config = appStore.config;
  const rows: Array<[string, string]> = [];

  if (config) {
    if ((config as any).version) rows.push([t("about.server_version"), (config as any).version]);
    if ((config as any).platform) rows.push([t("about.platform"), (config as any).platform]);
    if ((config as any).goVersion) rows.push([t("about.go_version"), (config as any).goVersion]);
  }

  // Tauri runtime info
  const tauri = (window as any).__TAURI__;
  if (tauri) {
    rows.push([t("about.runtime_type"), "Tauri Desktop"]);
  } else {
    rows.push([t("about.runtime_type"), "Browser"]);
  }

  if (rows.length === 0) {
    grid.textContent = t("about.no_info");
    return;
  }

  grid.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="about-info-label">${label}</div><div class="about-info-value">${value}</div>`,
    )
    .join("");
}

/**
 * Open the config dialog, optionally scrolling to a specific section.
 * Pre-loads config info and refreshes the about panel.
 */
export function openConfigDialog(section?: string): void {
  const configDialog = document.getElementById(
    "configDialog",
  ) as HTMLDialogElement | null;
  if (!configDialog) return;

  if (!configDialog.open) {
    configDialog.showModal();
  }

  // Load config info (populates appStore) then refresh about panel.
  void loadConfigInfo().then(() => renderAboutVersion());

  if (section) {
    focusConfigSection(section);
  }
}

/**
 * Bind submit/cancel handlers to the server settings form (#settingsForm).
 * On submit: updates settingsStore, reconfigures API, saves, closes dialog.
 */
export function installSettingsFormHandlers(): void {
  const form = document.getElementById("settingsForm") as HTMLFormElement | null;
  const dialog = document.getElementById("settingsDialog") as HTMLDialogElement | null;
  const cancelBtn = document.getElementById("btnCancelSettings") as HTMLButtonElement | null;
  if (!form || !dialog) return;
  if ((form as any).__handlersBound) return;
  (form as any).__handlersBound = true;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = (document.getElementById("serverUrl") as HTMLInputElement | null)?.value || "";
    const password = (document.getElementById("serverPassword") as HTMLInputElement | null)?.value || "";
    const username = (document.getElementById("serverUsername") as HTMLInputElement | null)?.value || "opencorvus";

    setSettingsStore({ serverUrl: url, password, username });
    configureApi({ serverUrl: url, password, username });
    saveSettings();
    dialog.close();
  });

  cancelBtn?.addEventListener("click", () => {
    dialog.close();
  });
}

/**
 * Attach a click-to-close handler to every `dialog.dialog` element.
 */
export function setupDialogBackdropClose(): void {
  document.querySelectorAll("dialog.dialog").forEach((dialog) => {
    const el = dialog as HTMLDialogElement;
    if (el.dataset.backdropClose === "true") return;
    el.dataset.backdropClose = "true";
    el.addEventListener("click", (event) => {
      if (event.target !== el) return;
      el.close();
    });
  });
}
