// ── Dialog Service ──
// Manages dialog open/close, config tab switching, and backdrop close handlers.
// Uses direct imports.
// imports as of Phase 4 cleanup.

import { settingsStore } from "../store/settings";
import { boardStore, loadTasks } from "../store/board";
import { appStore } from "../store/app";
import { loadConfigInfo } from "./init";
import { apiJson } from "./api";
import { getHostTransport } from "./host-transport";
import { selectedTaskDirectory } from "../store/board";
import { t } from "../utils/i18n";
import { renderMarkdown, escapeHtml } from "../utils/markdown";
import { describeToolPart } from "../utils/tool";

function renderSessionToolChip(part: any): string {
  const display = describeToolPart(part, selectedTaskDirectory());
  if (!display) return "";
  const statusAttr = display.status
    ? ` data-status="${escapeHtml(display.status)}"`
    : "";
  const detail = display.detail
    ? `<span class="tool-detail">${escapeHtml(display.detail)}</span>`
    : "";
  const status = display.statusLabel
    ? `<span class="tool-status" data-status="${escapeHtml(display.status || "pending")}" title="${escapeHtml(display.statusLabel)}">${escapeHtml(display.statusLabel)}</span>`
    : "";
  return `<div class="msg-tool"${statusAttr}>
    <span class="tool-icon">${escapeHtml(display.icon)}</span>
    <span class="tool-name">${escapeHtml(display.label)}</span>
    ${detail}
    ${status}
  </div>`;
}

// ── Public API ──

/**
 * Open the channel configuration dialog.
 * ChannelsPanel.tsx handles its own inline editing, so this function
 * simply opens the config dialog and switches to the channel tab.
 */
export async function openChannelSettings(_channelID?: string): Promise<void> {
  openConfigDialog("channel");
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
const OVERLAY_VERSION = "0.0.1-alpha";

function escapeAboutHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderAboutVersion(): void {
  const grid = document.getElementById("aboutRuntimeGrid");
  if (!grid) return;

  const config = appStore.config;
  const connected = appStore.config !== null;
  const rows: Array<[string, string]> = [
    [t("about.rt_overlay"), "v" + OVERLAY_VERSION],
    [t("about.rt_core"), (config as any)?.version || t("about.rt_unavailable")],
    [t("about.rt_server"), settingsStore.serverUrl || "-"],
    [t("about.rt_connection"), connected ? t("about.rt_connected") : t("about.rt_disconnected")],
    [t("about.rt_directory"), settingsStore.directory || "-"],
    [t("about.rt_executor"), settingsStore.executor || "-"],
    [t("about.rt_tasks"), String(boardStore.tasks?.length || 0)],
  ];

  // Additional server info
  if ((config as any)?.platform) rows.push([t("about.platform"), (config as any).platform]);
  if ((config as any)?.goVersion) rows.push([t("about.go_version"), (config as any).goVersion]);

  const hostKind = getHostTransport().kind;
  const runtimeLabel =
    hostKind === "tauri" ? "Tauri Desktop" : hostKind === "vscode" ? "VS Code Webview" : "Browser";
  rows.push([t("about.runtime_type"), runtimeLabel]);

  grid.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="about-info-label">${escapeAboutHtml(label)}</div><div class="about-info-value">${escapeAboutHtml(value)}</div>`,
    )
    .join("");

  // Version is shown as a tooltip on the copyright footer (hover to see
  // "Overlay vX.Y.Z / core ..."). The inline children are static markup in
  // ChatComposer.tsx; we only mutate the title attribute here.
  const chatVersion = document.getElementById("chatVersion");
  if (chatVersion) {
    const connected = config !== null;
    const text = connected
      ? t("version.overlay", { version: OVERLAY_VERSION })
      : `${t("version.overlay", { version: OVERLAY_VERSION })} / ${t("version.core_unknown")}`;
    chatVersion.title = text;
  }
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
 * Open the Executor Session dialog, loading messages for a given session.
 * Shared by the sidebar Goals panel (GoalWorkflowGroup "Open session" button)
 * and the main conversation (Card step body) so the render logic isn't
 * duplicated across surfaces.
 */
export async function openBuildSessionDialog(
  sessionID: string,
  title: string,
): Promise<void> {
  const dialog = document.getElementById("sessionDialog") as HTMLDialogElement | null;
  const titleEl = document.getElementById("sessionDialogTitle");
  const bodyEl = document.getElementById("sessionDialogBody");
  if (!dialog || !titleEl || !bodyEl) return;
  titleEl.textContent = title || "Build Session";
  bodyEl.innerHTML = '<p class="empty-hint">Loading…</p>';
  dialog.showModal();
  try {
    const messages: any[] = await apiJson(`session/${sessionID}/message`);
    if (!messages || messages.length === 0) {
      bodyEl.innerHTML = '<p class="empty-hint">No messages yet.</p>';
      return;
    }
    const html = messages
      .map((msg: any) => {
        const role: string = msg.info?.role ?? msg.role ?? "unknown";
        const parts: any[] = Array.isArray(msg.parts) ? msg.parts : [];
        const textParts = parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => `<div class="session-msg-text md-content">${renderMarkdown(p.text)}</div>`)
          .join("");
        const toolParts = parts
          .filter((p) => p.type === "tool-invocation" || p.type === "tool-call")
          .map((p) => renderSessionToolChip(p))
          .filter(Boolean)
          .join("");
        if (!textParts && !toolParts) return "";
        return `<div class="session-msg" data-role="${escapeHtml(role)}">
          <span class="session-msg-role">${escapeHtml(role)}</span>
          ${textParts}${toolParts}
        </div>`;
      })
      .filter(Boolean)
      .join("");
    bodyEl.innerHTML = html || '<p class="empty-hint">No displayable messages.</p>';
  } catch (e) {
    bodyEl.innerHTML = `<p class="empty-hint">Failed to load session: ${escapeHtml(String(e))}</p>`;
  }
}

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
