export interface EmbeddedOverlayUiFile {
  path: string
  file: string
}

// UI means User Interface. The package script replaces this empty table during
// Bun compile so the Linux executable can serve /ui/ without a sidecar folder.
export const EMBEDDED_OVERLAY_UI: readonly EmbeddedOverlayUiFile[] = []
