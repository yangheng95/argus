// ── Dialog Service ──
// Exact port of app.js dialog management functions to TypeScript.
//
// Responsibilities:
//   - Open the channel settings dialog (optionally for a specific channel)
//   - Open the server settings dialog
//   - Switch the active config sidebar tab
//   - Focus a specific config section
//   - Open the config dialog (optionally jumping to a section)
//   - Set up backdrop-click-to-close on all `dialog.dialog` elements
//
// This module is intentionally DOM-oriented: it manipulates dialog elements
// directly via document.getElementById / querySelector so that it can serve
// as a drop-in replacement for the legacy app.js globals while the Solid
// migration is in progress.
//
// External functions referenced here (loadConfigInfo, renderChannelFields,
// renderAboutVersion) remain in app.js during the transition and are accessed
// via the `window` global so that no circular import is introduced.
//
// Integration:
//   - Uses settingsStore for server connection values.
//   - Reads boardStore.channels for the default channel ID.

import { settingsStore } from "../store/settings";
import { boardStore } from "../store/board";

// ── Helpers: window-scoped legacy functions ──

/**
 * Call a function that is still defined on `window` in app.js.
 * This avoids circular imports during the migration period.
 */
function legacyFn(name: string, ...args: unknown[]): unknown {
  const fn = (window as any)[name];
  if (typeof fn === "function") return fn(...args);
  console.warn(`[dialog] legacy function not found on window: ${name}`);
  return undefined;
}

// ── Public API ──

/**
 * Open the channel configuration dialog.
 *
 * If channelID is provided, the dialog opens with that channel selected;
 * otherwise the first channel in boardStore.channels is used.
 *
 * Mirrors app.js openChannelSettings (lines 9876–9882).
 */
export async function openChannelSettings(channelID?: string): Promise<void> {
  await legacyFn("loadConfigInfo");

  const target = channelID || (boardStore.board as any)?.channels?.[0]?.id;
  if (!target) return;

  legacyFn("renderChannelFields", target);

  const channelDialog = document.getElementById(
    "channelDialog",
  ) as HTMLDialogElement | null;
  channelDialog?.showModal();
}

/**
 * Open the server / connection settings dialog.
 *
 * Pre-populates the URL, password, and username inputs from settingsStore,
 * then shows the dialog.
 *
 * Mirrors app.js openServerSettings (lines 9884–9889).
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
 *
 * Updates `.config-nav-item` buttons and `.config-tab-panel` panels so that
 * only the items matching `tabName` receive the "active" class.
 *
 * Mirrors app.js switchConfigTab (lines 9891–9901).
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
 *
 * Calls switchConfigTab with the given name, and additionally scrolls the
 * channel list to the top when name is "channel".
 *
 * Mirrors app.js focusConfigSection (lines 9903–9907).
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
 * Open the config dialog, optionally scrolling to a specific section.
 *
 * If the dialog is already open it is not re-opened.  After opening (or if
 * already open) the about-version panel is refreshed, and if a section name
 * is supplied focusConfigSection is called.
 *
 * Mirrors app.js openConfigDialog (lines 9909–9918).
 */
export function openConfigDialog(section?: string): void {
  const configDialog = document.getElementById(
    "configDialog",
  ) as HTMLDialogElement | null;
  if (!configDialog) return;

  if (!configDialog.open) {
    configDialog.showModal();
  }

  legacyFn("renderAboutVersion");

  if (section) {
    focusConfigSection(section);
  }
}

/**
 * Attach a click-to-close handler to every `dialog.dialog` element that has
 * not yet received the handler.
 *
 * Guards against double-binding using the `data-backdrop-close` dataset flag.
 * A click directly on the `<dialog>` element (i.e. on the backdrop area
 * outside the modal content) closes the dialog.
 *
 * Mirrors app.js setupDialogBackdropClose (lines 10474–10483).
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
