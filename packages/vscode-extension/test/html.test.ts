import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { renderOverlayHtml, sanitizeLocale } from "../src/webview/html"

/**
 * Mock vscode.Uri / vscode.Webview just enough to satisfy renderOverlayHtml.
 * We cannot import the real `vscode` module from a unit test because it is
 * provided by the extension host at runtime; mocking matches what every
 * VS Code extension's unit-test harness does.
 */
function mockUri(file: string): any {
  return {
    fsPath: file,
    toString: () => `vscode-test:${file}`,
  }
}

function mockWebview(opts: { mediaUiUri: string; cspSource?: string }): any {
  return {
    cspSource: opts.cspSource ?? "vscode-webview://test-source",
    asWebviewUri(uri: any) {
      // The real implementation maps a file URI to a vscode-webview URI.
      // For tests we just produce a deterministic string keyed by the
      // input fsPath so assertions can match it.
      return {
        toString: () => `https://test-cdn/${encodeURIComponent(uri.fsPath)}`,
      }
    },
  }
}

describe("sanitizeLocale", () => {
  test("normalizes Chinese variants to zh-CN", () => {
    expect(sanitizeLocale("zh-cn")).toBe("zh-CN")
    expect(sanitizeLocale("zh-TW")).toBe("zh-CN")
    expect(sanitizeLocale("zh")).toBe("zh-CN")
  })

  test("falls back to en-US for everything else", () => {
    expect(sanitizeLocale("en")).toBe("en-US")
    expect(sanitizeLocale("ja-JP")).toBe("en-US")
    expect(sanitizeLocale("")).toBe("en-US")
    expect(sanitizeLocale("garbage")).toBe("en-US")
  })

  test("trims whitespace", () => {
    expect(sanitizeLocale("  zh-CN  ")).toBe("zh-CN")
  })
})

describe("renderOverlayHtml", () => {
  let extensionRoot: string

  beforeEach(() => {
    extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-html-"))
    const mediaUi = path.join(extensionRoot, "media", "ui")
    fs.mkdirSync(mediaUi, { recursive: true })
    const indexHtml = `<!DOCTYPE html>
<html lang="en-US">
<head>
  <meta charset="UTF-8">
  <title>OpenCorvus</title>
  <script type="module" crossorigin src="/assets/index-abc.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-def.css">
</head>
<body>
  <script>(function () { window.__bootstrap = true; })();</script>
  <img src="/assets/logo.svg" alt="logo">
  <div id="root"></div>
</body>
</html>`
    fs.writeFileSync(path.join(mediaUi, "index.html"), indexHtml, "utf8")
  })

  afterEach(() => {
    try {
      fs.rmSync(extensionRoot, { recursive: true, force: true })
    } catch {}
  })

  function render(hostLocale: string) {
    const mediaUiUri = mockUri(path.join(extensionRoot, "media", "ui"))
    const webview = mockWebview({ mediaUiUri: mediaUiUri.fsPath })
    return renderOverlayHtml({
      extensionPath: extensionRoot,
      webview,
      mediaUiUri,
      hostLocale,
      vscodeInitialTheme: "vscode-dark",
    })
  }

  test("rewrites /assets and /i18n absolute paths via asWebviewUri", () => {
    const { html } = render("en-US")
    expect(html).not.toMatch(/(?:src|href)="\/(assets|i18n)\//)
    expect(html).toContain('src="https://test-cdn/')
    expect(html).toContain("/assets/index-abc.js")
    expect(html).toContain("/assets/index-def.css")
    expect(html).toContain("/assets/logo.svg")
  })

  test("sets <html lang> from the host locale (zh)", () => {
    const { html, locale } = render("zh-cn")
    expect(locale).toBe("zh-CN")
    expect(html).toMatch(/<html lang="zh-CN"/)
  })

  test("sets <html lang> from the host locale (en)", () => {
    const { html, locale } = render("en")
    expect(locale).toBe("en-US")
    expect(html).toMatch(/<html lang="en-US"/)
  })

  test("emits a CSP meta with a per-render nonce that matches every script tag", () => {
    const { html, nonce } = render("en-US")
    expect(nonce).toMatch(/^[a-f0-9]+$/i)
    expect(html).toContain(`'nonce-${nonce}'`)
    expect(html).toContain(`default-src 'none'`)
    expect(html).toContain(`connect-src vscode-webview://test-source`)
    // CSP must NOT allow http://127.0.0.1:* — webview never connects
    // directly to the sidecar (plan §19.2.1).
    expect(html).not.toMatch(/connect-src[^;]*127\.0\.0\.1/)
    // Both the inline theme script and the external module script
    // must carry the same nonce after the rewrite.
    const scriptTags = html.match(/<script\b[^>]*>/g) ?? []
    expect(scriptTags.length).toBeGreaterThan(1)
    for (const tag of scriptTags) {
      expect(tag).toContain(`nonce="${nonce}"`)
    }
  })

  test("injects <base href> pointing at the media/ui webview URI", () => {
    const { html } = render("en-US")
    expect(html).toMatch(/<base href="https:\/\/test-cdn\/[^"]+\/"/)
  })

  test("injects window.__OPENCORVUS_LOCALE__ bootstrap with the resolved locale", () => {
    const { html } = render("zh-CN")
    expect(html).toContain('window.__OPENCORVUS_LOCALE__="zh-CN"')
  })

  test("injects window.__OPENCORVUS_ASSET_BASE__ bootstrap for runtime locale fetches", () => {
    const { html } = render("en-US")
    expect(html).toMatch(/window\.__OPENCORVUS_ASSET_BASE__="https:\/\/test-cdn\/[^"]+\/"/)
  })

  test("injects the initial VS Code theme contract", () => {
    const { html } = render("en-US")
    expect(html).toContain('window.__OC_VSCODE_INITIAL_THEME__="vscode-dark"')
  })

  test("each render produces a fresh nonce", () => {
    const a = render("en-US")
    const b = render("en-US")
    expect(a.nonce).not.toBe(b.nonce)
  })

  test("throws a clear error when the bundled UI is missing", () => {
    fs.rmSync(path.join(extensionRoot, "media", "ui", "index.html"))
    expect(() => render("en-US")).toThrow(/bundled overlay UI not found/)
  })
})
