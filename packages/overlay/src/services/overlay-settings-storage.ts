import { DEFAULT_SERVER } from "./default-server";

export type BrowserOverlaySettings = Record<string, unknown>;

const BADGE_ACKS_KEY = "oc_badge_acks";

function storage(): Storage | undefined {
  try {
    return (globalThis as any).window?.localStorage ?? (globalThis as any).localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  return storage()?.getItem(key) ?? null;
}

function write(key: string, value: unknown): void {
  storage()?.setItem(key, String(value));
}

function remove(key: string): void {
  storage()?.removeItem(key);
}

function writeOptional(key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    remove(key);
  } else {
    write(key, value);
  }
}

export function loadBrowserOverlaySettings(): BrowserOverlaySettings {
  const serverUrl = read("oc_server_url") || DEFAULT_SERVER;
  const autoServerRaw = read("oc_auto_server");
  const rightPanelCollapsedRaw = read("oc_right_panel_collapsed");
  return {
    serverUrl,
    autoServer: autoServerRaw === null ? !serverUrl || serverUrl === DEFAULT_SERVER : autoServerRaw !== "false",
    password: read("oc_password") || "",
    username: read("oc_username") || "opencorvus",
    executor: read("oc_executor") || undefined,
    projectEditor: read("oc_project_editor") || undefined,
    initGit: true,
    sidebarCollapsed: read("oc_sidebar_collapsed") === "true",
    rightPanelCollapsed: rightPanelCollapsedRaw === null ? undefined : rightPanelCollapsedRaw === "true",
    sidebarWidth: read("oc_sidebar_width") || undefined,
    sectionsWidth: read("oc_sections_width") || undefined,
    workspacePanelHeight: read("oc_workspace_height") || undefined,
    opacity: read("oc_opacity") || undefined,
    zoom: read("oc_zoom") || undefined,
    theme: read("oc_theme") || undefined,
    locale: read("oc_locale") || undefined,
    directory: (read("oc_directory") || "").trim(),
    preferredProjectEditor: read("oc_preferred_project_editor") || undefined,
    workspaceTaskId: read("oc_workspace_task") || undefined,
    workspaceDirectory: read("oc_workspace_directory") || undefined,
    desktopNotifications: read("oc_desktop_notifications") !== "false",
  };
}

export function saveBrowserOverlaySettings(input: BrowserOverlaySettings): boolean {
  write("oc_server_url", input.serverUrl ?? DEFAULT_SERVER);
  write("oc_auto_server", input.autoServer ?? true);
  write("oc_password", input.password ?? "");
  write("oc_username", input.username ?? "opencorvus");
  write("oc_executor", input.executor ?? "opencorvus");
  write("oc_project_editor", input.projectEditor ?? "vscode");
  write("oc_sidebar_collapsed", input.sidebarCollapsed === true);
  write("oc_right_panel_collapsed", input.rightPanelCollapsed === true);
  writeOptional("oc_sidebar_width", input.sidebarWidth);
  writeOptional("oc_sections_width", input.sectionsWidth);
  writeOptional("oc_workspace_height", input.workspacePanelHeight);
  write("oc_opacity", input.opacity ?? 0.99);
  write("oc_zoom", input.zoom ?? 1);
  write("oc_theme", input.theme ?? "light");
  writeOptional("oc_locale", input.locale);
  write("oc_desktop_notifications", input.desktopNotifications !== false);
  writeOptional("oc_preferred_project_editor", input.preferredProjectEditor);
  writeOptional("oc_workspace_task", input.workspaceTaskId ?? input.workspaceTaskID);
  writeOptional("oc_workspace_directory", input.workspaceDirectory);
  writeOptional("oc_directory", input.directory);
  return true;
}

export function loadBadgeAckKeys(): string[] {
  const raw = read(BADGE_ACKS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

export function saveBadgeAckKeys(keys: Iterable<string>): void {
  const unique = Array.from(new Set(Array.from(keys).filter((item) => item.trim().length > 0))).sort();
  write(BADGE_ACKS_KEY, JSON.stringify(unique));
}
