import * as vscode from "vscode"
import type { SidecarHandle } from "../sidecar/manager"

/**
 * Stub webview panel for M2.
 *
 * M2 only needs to prove activate → spawn sidecar → render *something*
 * end-to-end. Real overlay-UI rendering, the postMessage TransportBridge,
 * SSE batching, full CSP, and resource Blob caching all land in M3 / M4 /
 * M5 — no shortcuts here, just a placeholder that surfaces the live
 * sidecar state so we can verify the wiring without the heavy parts.
 */

export class OpencorvusPanel {
  private static current: OpencorvusPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []

  static show(context: vscode.ExtensionContext, sidecar: SidecarHandle): OpencorvusPanel {
    if (OpencorvusPanel.current) {
      OpencorvusPanel.current.panel.reveal(vscode.ViewColumn.Beside)
      OpencorvusPanel.current.refresh(sidecar)
      return OpencorvusPanel.current
    }
    const panel = vscode.window.createWebviewPanel(
      "opencorvus.panel",
      "OpenCorvus",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        // No need for retainContextWhenHidden in M2 — defaults are fine.
      },
    )
    OpencorvusPanel.current = new OpencorvusPanel(panel, sidecar)
    panel.onDidDispose(() => {
      OpencorvusPanel.current = undefined
    })
    return OpencorvusPanel.current
  }

  private constructor(panel: vscode.WebviewPanel, sidecar: SidecarHandle) {
    this.panel = panel
    this.refresh(sidecar)
  }

  refresh(sidecar: SidecarHandle): void {
    // Token MUST NOT appear in webview HTML (plan §7). Show only
    // non-sensitive sidecar metadata.
    const safe = {
      pid: sidecar.pid,
      workspace: sidecar.workspace,
      // baseUrl includes the host-bound port; that's fine — webview is
      // a sandbox per VS Code, no network egress unless CSP allows it.
      baseUrl: sidecar.baseUrl,
    }
    this.panel.webview.html = this.renderHtml(safe)
  }

  private renderHtml(state: { pid: number; workspace: string; baseUrl: string }): string {
    const escape = (s: string): string =>
      s.replace(/[&<>"']/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
      )
    return [
      "<!doctype html>",
      `<html lang="en">`,
      "<head>",
      `<meta charset="utf-8">`,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">`,
      "<title>OpenCorvus</title>",
      "<style>body{font-family:system-ui;padding:1.5rem;line-height:1.5}h1{margin-top:0;font-size:1.1rem;font-weight:600}dl{display:grid;grid-template-columns:8rem 1fr;gap:.25rem .75rem;font-family:ui-monospace,monospace;font-size:.85rem}dt{opacity:.6}</style>",
      "</head>",
      "<body>",
      "<h1>OpenCorvus sidecar — M2 placeholder</h1>",
      `<p>The full UI ships in M5. This stub confirms the extension host is connected to a managed sidecar.</p>`,
      "<dl>",
      `<dt>pid</dt><dd>${state.pid}</dd>`,
      `<dt>workspace</dt><dd>${escape(state.workspace)}</dd>`,
      `<dt>base url</dt><dd>${escape(state.baseUrl)}</dd>`,
      "</dl>",
      "</body>",
      "</html>",
    ].join("\n")
  }

  dispose(): void {
    while (this.disposables.length) {
      const d = this.disposables.pop()
      try { d?.dispose() } catch {}
    }
    this.panel.dispose()
  }
}
