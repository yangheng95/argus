import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"
import type { HostTheme } from "@opencorvus-ai/transport-protocol"

/**
 * Load and transform the bundled overlay index.html for VS Code webview
 * use (plan-vscode-extension.md §6 / §19.2.1 / §19.2.2 / §19.3.2).
 *
 * Transforms applied:
 *   1. Rewrite Vite's absolute `/assets/*` and `/i18n/*` paths to the
 *      webview's `asWebviewUri` form so they resolve against the
 *      bundled media/ui directory.
 *   2. Set `<html lang>` to the VS Code UI language so the overlay's
 *      i18n loader (which reads document.documentElement.lang) picks
 *      up the right locale.
 *   3. Inject a strict CSP <meta> tag with a fresh nonce. The nonce is
 *      added to every `<script>` element (including the inline theme
 *      init script Vite emits) so the CSP can refuse `unsafe-inline`
 *      script.
 *   4. Inject a tiny bootstrap script that sets
 *      `window.__OPENCORVUS_LOCALE__` so any code path that prefers a
 *      runtime probe over `document.lang` can find the locale too.
 *      The bootstrap also exposes `window.__OPENCORVUS_ASSET_BASE__`
 *      so runtime `fetch("i18n/...")` calls do not depend on <base>
 *      behavior inside VS Code's webview CSP sandbox.
 */

const HTML_FILENAME = "index.html"

export interface RenderedWebviewHtml {
  html: string
  nonce: string
  locale: string
}

export interface RenderOptions {
  /** Absolute path to the extension root (context.extensionPath). */
  extensionPath: string
  /** Webview instance — used for asWebviewUri + cspSource. */
  webview: vscode.Webview
  /** Webview-resource URI for the bundled media/ui directory. */
  mediaUiUri: vscode.Uri
  /** VS Code UI language (`vscode.env.language`), e.g. "zh-cn", "en". */
  hostLocale: string
  /** Initial overlay theme resolved from the active VS Code color theme. */
  vscodeInitialTheme: HostTheme
}

export function renderOverlayHtml(opts: RenderOptions): RenderedWebviewHtml {
  const indexPath = path.join(opts.extensionPath, "media", "ui", HTML_FILENAME)
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `OpenCorvus: bundled overlay UI not found at ${indexPath}. ` +
        `Run "bun run build" inside packages/vscode-extension to build it.`,
    )
  }
  let html = fs.readFileSync(indexPath, "utf8")

  const cspSource = opts.webview.cspSource
  const nonce = makeNonce()
  const locale = sanitizeLocale(opts.hostLocale)
  const baseHref = `${opts.webview.asWebviewUri(opts.mediaUiUri).toString()}/`

  // 1. Asset URL rewrite: /assets/* and /i18n/* → ${baseHref}assets/* etc.
  //    Captures common src/href patterns Vite emits; the trailing slash on
  //    baseHref is significant.
  html = html.replace(
    /(\b(?:src|href)=)["']\/(assets|i18n)\//g,
    (_match, prefix, dir) => `${prefix}"${baseHref}${dir}/`,
  )

  // 2. <html lang>: replace whatever Vite shipped with the host locale so
  //    the overlay's i18n loader resolves the right locale on first paint.
  html = html.replace(/<html\b[^>]*>/i, (tag) => {
    const without = tag.replace(/\s+lang=["'][^"']*["']/, "")
    return without.replace(/<html\b/, `<html lang="${escapeAttr(locale)}"`)
  })

  // 3. Add nonce to every <script> tag. Both inline (theme init) and
  //    external (Vite-emitted module) scripts need it under our CSP.
  html = html.replace(/<script\b([^>]*)>/g, (_match, attrs) => {
    const cleaned = String(attrs).replace(/\s+nonce=["'][^"']*["']/g, "")
    return `<script${cleaned} nonce="${nonce}">`
  })

  // 4. Inject <meta CSP> + <base> + locale bootstrap into <head>. The
  //    base href makes the overlay's `fetch("i18n/...")` calls resolve
  //    against the media/ui directory rather than the webview origin
  //    root. base-uri 'self' in CSP allows the tag to take effect.
  //    VS Code's CSP handling can still block <base> in practice, so the
  //    overlay also consumes the explicit asset-base contract below.
  const headInjection = [
    `<meta http-equiv="Content-Security-Policy" content="${buildCsp(cspSource, nonce)}">`,
    `<base href="${baseHref}">`,
    `<script nonce="${nonce}">window.__OPENCORVUS_LOCALE__=${JSON.stringify(locale)};window.__OPENCORVUS_ASSET_BASE__=${JSON.stringify(baseHref)};window.__OC_VSCODE_INITIAL_THEME__=${JSON.stringify(opts.vscodeInitialTheme)};</script>`,
  ].join("\n")
  html = html.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n${headInjection}`)

  return { html, nonce, locale }
}

// ── CSP ──

function buildCsp(cspSource: string, nonce: string): string {
  // plan §19.2.1 — strict CSP. `connect-src` is intentionally NOT
  // `127.0.0.1:*` because the webview never talks to the sidecar
  // directly — every request goes through postMessage.
  return [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}' ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource} data:`,
    `img-src ${cspSource} data: blob:`,
    `connect-src ${cspSource}`,
    `worker-src blob:`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'none'`,
  ].join("; ")
}

// ── Helpers ──

export function sanitizeLocale(value: string): string {
  // Mirror the overlay's sanitizeLocale: only zh-CN and en-US are
  // bundled, anything else maps to en-US. VS Code returns lowercase
  // locale codes (e.g. "zh-cn", "en"); normalise to BCP-47.
  const text = String(value || "")
    .trim()
    .toLowerCase()
  if (text.startsWith("zh")) return "zh-CN"
  return "en-US"
}

function makeNonce(): string {
  // crypto.randomUUID is available in Node 16.7+ and VS Code's bundled
  // node environment; bridge.ts already uses it so no shim needed.
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "")
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  )
}
