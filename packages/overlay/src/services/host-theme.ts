import type { HostTheme } from "@opencorvus-ai/transport-protocol"

type HostThemeHandler = (theme: HostTheme) => void

const handlers = new Set<HostThemeHandler>()

export function isHostTheme(value: unknown): value is HostTheme {
  return value === "light" || value === "vscode-dark"
}

export function readInitialVsCodeHostTheme(): HostTheme | undefined {
  const value =
    (globalThis as any).__OC_VSCODE_INITIAL_THEME__ ?? (globalThis as any).window?.__OC_VSCODE_INITIAL_THEME__
  return isHostTheme(value) ? value : undefined
}

export function requireInitialVsCodeHostTheme(): HostTheme {
  const theme = readInitialVsCodeHostTheme()
  if (!theme) {
    throw new Error("OpenCorvus: VS Code webview started without __OC_VSCODE_INITIAL_THEME__.")
  }
  return theme
}

export function publishHostTheme(theme: unknown): void {
  if (!isHostTheme(theme)) {
    throw new Error(`OpenCorvus: invalid host theme "${String(theme)}".`)
  }
  for (const handler of [...handlers]) {
    handler(theme)
  }
}

export function subscribeHostTheme(handler: HostThemeHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function __resetHostThemeForTest(): void {
  handlers.clear()
}
