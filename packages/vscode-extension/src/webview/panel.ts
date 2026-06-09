import * as vscode from "vscode"
import {
  PROTOCOL_VERSION,
  type ExtensionHostThemeMessage,
  type ExtensionUiCommandMessage,
  type HostTheme,
} from "@opencorvus-ai/transport-protocol"
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

/**
 * audit-2026-04-29 W2-P8 — hard ceiling on a single ui-command
 * payload (post-JSON length, in bytes). 6 MiB sits above the
 * attach-file 4 MiB cap so a base64-encoded 4 MiB attachment fits
 * (4 × 4/3 ≈ 5.33 MiB encoded, plus envelope overhead) but a
 * runaway accidental payload (e.g. dump an open editor's full
 * AST through composer.attach) is rejected before postMessage
 * stalls the webview main thread.
 */
const UI_COMMAND_MAX_BYTES = 6 * 1024 * 1024

const VSCODE_THEME_KIND_TO_OVERLAY_THEME: Record<number, HostTheme> = {
  [vscode.ColorThemeKind.Light]: "light",
  [vscode.ColorThemeKind.Dark]: "vscode-dark",
  [vscode.ColorThemeKind.HighContrast]: "vscode-dark",
  [vscode.ColorThemeKind.HighContrastLight]: "light",
}

export function overlayThemeFromColorThemeKind(kind: vscode.ColorThemeKind): HostTheme {
  const theme = VSCODE_THEME_KIND_TO_OVERLAY_THEME[kind]
  if (!theme) {
    throw new Error(`OpenCorvus: unmapped VS Code color theme kind ${kind}.`)
  }
  return theme
}

export class OpencorvusPanel {
  /** The currently open panel, or undefined when none is shown. The
   *  attach-file command reads this to decide whether to push the
   *  composer.attach ui-command directly or prompt the user to open
   *  the panel first. */
  static current: OpencorvusPanel | undefined
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
    const panel = vscode.window.createWebviewPanel("opencorvus.panel", "OpenCorvus", vscode.ViewColumn.Beside, {
      // plan §19.2.2 webview安全锁 — pinned here so a future drift
      // is caught at code review.
      enableScripts: true,
      enableForms: false,
      enableCommandUris: false,
      retainContextWhenHidden: false,
      localResourceRoots: [mediaUiUri],
    })
    OpencorvusPanel.current = new OpencorvusPanel(panel, sidecar, context)
    panel.onDidDispose(() => {
      const c = OpencorvusPanel.current
      if (c) {
        c.disposeResources()
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
    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        this.postHostTheme(overlayThemeFromColorThemeKind(theme.kind))
      }),
    )
    this.refresh(sidecar)
  }

  refresh(sidecar: SidecarHandle): void {
    // audit-2026-04-29 W2-C11 / W2-P7 — panel.refresh used to
    // unconditionally reassign `webview.html`, which forces VS Code
    // to tear down and re-load the entire webview JS context. That
    // wiped composer state, scroll position, in-flight pending
    // promises, and the `composer.attach` subscription map every
    // time the same sidecar handle was passed (e.g. on `reveal`).
    // Only rebuild bridge + reassign HTML when the sidecar identity
    // actually changed; on no-op refresh do nothing.
    const sidecarChanged = this.sidecar.baseUrl !== sidecar.baseUrl || this.sidecar.token !== sidecar.token
    const needsBridgeInit = !this.bridge

    if (sidecarChanged && this.bridge) {
      this.bridge.dispose()
      this.bridge = new TransportBridge(this.panel.webview, sidecar)
    } else if (needsBridgeInit) {
      this.bridge = new TransportBridge(this.panel.webview, sidecar)
    }
    this.sidecar = sidecar

    if (!sidecarChanged && !needsBridgeInit) {
      // Same sidecar, bridge alive — nothing else to do. The webview
      // keeps its existing JS realm and state.
      return
    }

    const mediaUiUri = vscode.Uri.joinPath(this.context.extensionUri, "media", "ui")
    const rendered = renderOverlayHtml({
      extensionPath: this.context.extensionPath,
      webview: this.panel.webview,
      mediaUiUri,
      hostLocale: vscode.env.language,
      vscodeInitialTheme: overlayThemeFromColorThemeKind(vscode.window.activeColorTheme.kind),
    })
    this.panel.webview.html = rendered.html
  }

  private postHostTheme(theme: HostTheme): void {
    const msg: ExtensionHostThemeMessage = {
      protocol: PROTOCOL_VERSION,
      type: "host:theme",
      theme,
    }
    void this.panel.webview.postMessage(msg)
  }

  /**
   * Push a `ui-command` envelope to the webview. Used for
   * extension-driven UI mutations such as the composer.attach
   * payload from `opencorvus.attachFile` (plan §19.2.6).
   *
   * `kind` MUST match a subscriber registered on the webview side via
   * HostTransport.subscribeUiCommand — sending a kind nobody
   * subscribes to is loud-warned at the webview console rather than
   * silently dropped (plan §一-7).
   *
   * audit-2026-04-29 W2-P8 — size guard. Pre-fix any caller (today
   * just attach-file with its own MAX_ATTACH_BYTES check; tomorrow
   * any new ui-command source) could shove an arbitrarily large
   * payload through postMessage. VS Code's webview channel uses
   * structured clone, which a multi-MiB payload makes synchronously
   * stall on the extension main thread, then again on the webview
   * main thread. The cap below is post-JSON to also catch deeply
   * nested objects whose size doesn't show up on a shallow byte
   * estimate. Drop with a loud `console.error` and skip postMessage
   * — never silently truncate payloads (CLAUDE.md §一-7).
   */
  sendUiCommand(kind: string, payload: unknown): void {
    const msg: ExtensionUiCommandMessage = {
      protocol: PROTOCOL_VERSION,
      type: "ui-command",
      kind,
      payload,
    }
    let serialized: string
    try {
      serialized = JSON.stringify(msg)
    } catch (err) {
      console.error(`[opencorvus] sendUiCommand(${kind}): payload not JSON-serialisable, dropping.`, err)
      return
    }
    if (serialized.length > UI_COMMAND_MAX_BYTES) {
      console.error(
        `[opencorvus] sendUiCommand(${kind}): payload ${serialized.length} bytes exceeds ${UI_COMMAND_MAX_BYTES}-byte cap, dropping.`,
      )
      return
    }
    void this.panel.webview.postMessage(msg)
  }

  /** Bring the panel to the foreground (used after attachFile so the
   *  user sees the new pending attachment in the composer). */
  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, /* preserveFocus */ true)
  }

  dispose(): void {
    this.disposeResources()
    this.panel.dispose()
  }

  private disposeResources(): void {
    while (this.disposables.length) {
      const d = this.disposables.pop()
      try {
        d?.dispose()
      } catch {}
    }
    this.bridge?.dispose()
    this.bridge = undefined
  }
}
