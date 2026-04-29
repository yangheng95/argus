import * as vscode from "vscode"
import type { SidecarHandle } from "../sidecar/manager"
import { TransportBridge } from "../transport/bridge"
import { renderOverlayHtml } from "./html"

/**
 * Webview panel host. Owns the `vscode.WebviewPanel`, instantiates the
 * postMessage TransportBridge, and loads the bundled overlay UI from
 * `media/ui/` (plan-vscode-extension.md §6 / §19.2.1 / §19.2.2 /
 * §19.3.2). All asset URLs are rewritten via `asWebviewUri`, the
 * `localResourceRoots` is locked to `media/ui`, and a strict CSP keeps
 * inline scripts gated by a per-render nonce.
 */

export class OpencorvusPanel {
  private static current: OpencorvusPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []
  private bridge: TransportBridge | undefined
  private sidecar: SidecarHandle

  static show(context: vscode.ExtensionContext, sidecar: SidecarHandle): OpencorvusPanel {
    if (OpencorvusPanel.current) {
      OpencorvusPanel.current.panel.reveal(vscode.ViewColumn.Beside)
      OpencorvusPanel.current.refresh(sidecar)
      return OpencorvusPanel.current
    }
    const mediaUiUri = vscode.Uri.joinPath(context.extensionUri, "media", "ui")
    const panel = vscode.window.createWebviewPanel(
      "opencorvus.panel",
      "OpenCorvus",
      vscode.ViewColumn.Beside,
      {
        // plan §19.2.2 webview安全锁 — pinned here so a future drift
        // is caught at code review.
        enableScripts: true,
        enableForms: false,
        enableCommandUris: false,
        retainContextWhenHidden: false,
        localResourceRoots: [mediaUiUri],
      },
    )
    OpencorvusPanel.current = new OpencorvusPanel(panel, sidecar, context)
    panel.onDidDispose(() => {
      const c = OpencorvusPanel.current
      if (c) {
        c.bridge?.dispose()
        c.bridge = undefined
      }
      OpencorvusPanel.current = undefined
    })
    return OpencorvusPanel.current
  }

  private constructor(
    panel: vscode.WebviewPanel,
    sidecar: SidecarHandle,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel
    this.sidecar = sidecar
    this.bridge = new TransportBridge(panel.webview, sidecar)
    this.refresh(sidecar)
  }

  refresh(sidecar: SidecarHandle): void {
    // If the sidecar identity changed (e.g. extension restarted it),
    // recreate the bridge so it talks to the new baseUrl/token.
    if (this.bridge && (this.sidecar.baseUrl !== sidecar.baseUrl || this.sidecar.token !== sidecar.token)) {
      this.bridge.dispose()
      this.bridge = new TransportBridge(this.panel.webview, sidecar)
    } else if (!this.bridge) {
      this.bridge = new TransportBridge(this.panel.webview, sidecar)
    }
    this.sidecar = sidecar

    const mediaUiUri = vscode.Uri.joinPath(this.context.extensionUri, "media", "ui")
    const rendered = renderOverlayHtml({
      extensionPath: this.context.extensionPath,
      webview: this.panel.webview,
      mediaUiUri,
      hostLocale: vscode.env.language,
    })
    this.panel.webview.html = rendered.html
  }

  dispose(): void {
    while (this.disposables.length) {
      const d = this.disposables.pop()
      try { d?.dispose() } catch {}
    }
    this.panel.dispose()
  }
}
