import {
  getHostTransport,
  UnsupportedNativeCommandError,
  type BrowserPreviewNativeBounds,
  type BrowserPreviewNativeNavigationAction,
  type BrowserPreviewNativeSelection,
  type BrowserPreviewNativeSelectionResult,
} from "./host-transport"

export interface BrowserPreviewNativeSyncInput {
  url: string
  bounds: BrowserPreviewNativeBounds
}

const REQUIRED_BROWSER_PREVIEW_COMMANDS = [
  "browserPreview.sync",
  "browserPreview.navigate",
  "browserPreview.close",
] as const

export function browserPreviewNativeSurfaceAvailable(): boolean {
  const nativeCommands = getHostTransport().capabilities.nativeCommands
  return REQUIRED_BROWSER_PREVIEW_COMMANDS.every((kind) => nativeCommands[kind])
}

export async function syncBrowserPreviewNativeSurface(input: BrowserPreviewNativeSyncInput): Promise<void> {
  assertBrowserPreviewNativeSurfaceAvailable()
  await getHostTransport().native({ kind: "browserPreview.sync", url: input.url, bounds: input.bounds })
}

export async function navigateBrowserPreviewNativeSurface(
  action: BrowserPreviewNativeNavigationAction,
): Promise<void> {
  assertBrowserPreviewNativeSurfaceAvailable()
  await getHostTransport().native({ kind: "browserPreview.navigate", action })
}

export async function closeBrowserPreviewNativeSurface(): Promise<void> {
  assertBrowserPreviewNativeSurfaceAvailable()
  await getHostTransport().native({ kind: "browserPreview.close" })
}

export async function setNativeSelectionEnabled(enabled: boolean): Promise<void> {
  if (!getHostTransport().capabilities.nativeCommands["browserPreview.selection.setEnabled"]) return
  await getHostTransport().native({ kind: "browserPreview.selection.setEnabled", enabled })
}

export async function takeNativeSelection(): Promise<BrowserPreviewNativeSelectionResult> {
  if (!getHostTransport().capabilities.nativeCommands["browserPreview.selection.take"]) return { kind: "waiting" }
  const result = await getHostTransport().native({ kind: "browserPreview.selection.take" })
  if (!result) return { kind: "waiting" }
  const r = result as Record<string, unknown>
  if (r.kind === "canceled") return { kind: "canceled" }
  if (r.kind !== "captured" || !r.selection || typeof r.selection !== "object" || Array.isArray(r.selection)) {
    return { kind: "waiting" }
  }
  const selection = r.selection as Record<string, unknown>
  if (
    typeof selection.x === "number" &&
    typeof selection.y === "number" &&
    typeof selection.width === "number" &&
    typeof selection.height === "number" &&
    typeof selection.label === "string"
  ) {
    return { kind: "captured", selection: selection as unknown as BrowserPreviewNativeSelection }
  }
  return { kind: "waiting" }
}

function assertBrowserPreviewNativeSurfaceAvailable(): void {
  if (browserPreviewNativeSurfaceAvailable()) return
  const host = getHostTransport()
  throw new UnsupportedNativeCommandError(host.kind, { kind: "browserPreview.close" })
}
