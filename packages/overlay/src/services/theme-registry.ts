import type { HostKind } from "./host-transport"
import { getHostTransport } from "./host-transport"

export type OverlayThemeID = "dark" | "light" | "system" | "vscode-dark"

export type OverlayThemeOption = {
  id: OverlayThemeID
  i18nSlug: "dark" | "light" | "system" | "vscode_dark"
}

export const DEFAULT_THEME_ID: OverlayThemeID = "light"

const DESKTOP_THEME_OPTIONS: OverlayThemeOption[] = [
  { id: "dark", i18nSlug: "dark" },
  { id: "vscode-dark", i18nSlug: "vscode_dark" },
  { id: "light", i18nSlug: "light" },
  { id: "system", i18nSlug: "system" },
]

export function themeOptionsForHost(host: HostKind): OverlayThemeOption[] {
  void host
  return DESKTOP_THEME_OPTIONS
}

export function themeOptionsForCurrentHost(): OverlayThemeOption[] {
  return themeOptionsForHost(getHostTransport().kind)
}

export function isThemeID(value: unknown): value is OverlayThemeID {
  return value === "dark" || value === "light" || value === "system" || value === "vscode-dark"
}

export function isThemeAllowedForHost(value: unknown, host: HostKind): value is OverlayThemeID {
  return isThemeID(value) && themeOptionsForHost(host).some((theme) => theme.id === value)
}

export function sanitizeThemeForHost(value: unknown, host: HostKind = getHostTransport().kind): OverlayThemeID {
  const text = String(value || "").trim()
  return isThemeAllowedForHost(text, host) ? text : DEFAULT_THEME_ID
}
