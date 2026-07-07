import {
  getHostTransport,
  UnsupportedNativeCommandError,
  type BrowserPreviewNativeBounds,
  type BrowserPreviewNativeNavigationAction,
} from "./host-transport"

export interface BrowserPreviewNativeSyncInput {
  scopeKey: string
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
  await getHostTransport().native({
    kind: "browserPreview.sync",
    scopeKey: input.scopeKey,
    url: input.url,
    bounds: input.bounds,
  })
}

export async function navigateBrowserPreviewNativeSurface(action: BrowserPreviewNativeNavigationAction): Promise<void> {
  assertBrowserPreviewNativeSurfaceAvailable()
  await getHostTransport().native({ kind: "browserPreview.navigate", action })
}

export async function closeBrowserPreviewNativeSurface(): Promise<void> {
  assertBrowserPreviewNativeSurfaceAvailable()
  await getHostTransport().native({ kind: "browserPreview.close" })
}

function assertBrowserPreviewNativeSurfaceAvailable(): void {
  if (browserPreviewNativeSurfaceAvailable()) return
  const host = getHostTransport()
  throw new UnsupportedNativeCommandError(host.kind, { kind: "browserPreview.close" })
}
