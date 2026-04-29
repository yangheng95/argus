import * as vscode from "vscode"
import type { SidecarHandle } from "../sidecar/manager"
import { TransportBridge } from "../transport/bridge"

/**
 * Webview panel host. Owns the `vscode.WebviewPanel`, instantiates the
 * postMessage TransportBridge, and renders a thin bootstrap HTML that
 * verifies the bridge round-trip end-to-end. The real overlay UI lands
 * in M5 — at that point this module loads the bundled overlay assets
 * via asWebviewUri instead of rendering inline HTML.
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
    const panel = vscode.window.createWebviewPanel(
      "opencorvus.panel",
      "OpenCorvus",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        // localResourceRoots will be set in M5 alongside asWebviewUri;
        // M4.B's HTML is fully inline so the default empty roots are
        // safe (no local file access from the webview).
      },
    )
    OpencorvusPanel.current = new OpencorvusPanel(panel, sidecar)
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

  private constructor(panel: vscode.WebviewPanel, sidecar: SidecarHandle) {
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
    // Token MUST NOT appear in webview HTML (plan §7). Show only
    // non-sensitive sidecar metadata.
    const safe = {
      pid: sidecar.pid,
      workspace: sidecar.workspace,
    }
    this.panel.webview.html = this.renderHtml(safe)
  }

  private renderHtml(state: { pid: number; workspace: string }): string {
    const escape = (s: string): string =>
      s.replace(/[&<>"']/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
      )
    // M4.B bootstrap: exercises the postMessage bridge by issuing a
    // transport-protocol request envelope for /global/health. The real
    // overlay UI replaces this in M5. The script is inline so we don't
    // need localResourceRoots yet; CSP allows inline script via a
    // nonce. baseUrl deliberately not displayed — the webview should
    // never know the sidecar URL (plan §7).
    const cspSource = this.panel.webview.cspSource
    const nonce = crypto.randomUUID().replace(/-/g, "")
    const script = `
const vscode = acquireVsCodeApi();
const PROTOCOL = 1;
const out = document.getElementById('healthcheck');
const set = (s) => { out.textContent = s; };
const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now();
const pending = new Map();
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'protocol-mismatch') {
    set('protocol mismatch — expected ' + m.expected + ', got ' + m.received);
    return;
  }
  if (m.type !== 'response' || m.protocol !== PROTOCOL) return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.body && m.body.kind === 'json') {
    set('ok status=' + m.status + ' body=' + JSON.stringify(m.body.value));
  } else if (m.body && m.body.kind === 'error') {
    set('error: ' + m.body.message);
  } else {
    set('non-json response status=' + m.status);
  }
});
pending.set(id, true);
vscode.postMessage({ protocol: PROTOCOL, type: 'request', id, method: 'GET', path: 'global/health', query: {}, headers: {}, body: { kind: 'none' }, responseKind: 'json' });
set('requesting /global/health …');
`
    return [
      "<!doctype html>",
      `<html lang="en">`,
      "<head>",
      `<meta charset="utf-8">`,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${cspSource}; style-src 'unsafe-inline' ${cspSource};">`,
      "<title>OpenCorvus</title>",
      "<style>body{font-family:system-ui;padding:1.5rem;line-height:1.5}h1{margin-top:0;font-size:1.1rem;font-weight:600}dl{display:grid;grid-template-columns:8rem 1fr;gap:.25rem .75rem;font-family:ui-monospace,monospace;font-size:.85rem}dt{opacity:.6}#healthcheck{padding:.5rem .75rem;background:rgba(127,127,127,.1);border-radius:.25rem;font-family:ui-monospace,monospace;font-size:.85rem;margin-top:1rem}</style>",
      "</head>",
      "<body>",
      "<h1>OpenCorvus sidecar — M4.B bridge bootstrap</h1>",
      `<p>The full overlay UI ships in M5. This page exercises the postMessage bridge by issuing a transport-protocol request envelope for <code>/global/health</code>.</p>`,
      "<dl>",
      `<dt>pid</dt><dd>${state.pid}</dd>`,
      `<dt>workspace</dt><dd>${escape(state.workspace)}</dd>`,
      "</dl>",
      `<div id="healthcheck">starting bridge…</div>`,
      `<script nonce="${nonce}">${script}</script>`,
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
