import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

const promptProfileCatalog = {
  active: "general",
  project_active: "general",
  session_active: null,
  default: "general",
  targets: [],
  profiles: [
    {
      id: "general",
      label: "General",
      description: "Default prompt profile",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

const syntaxMarkdown = [
  "```ts",
  'import { readFileSync } from "node:fs"',
  "const answer = 42",
  "const enabled = false",
  "// syntax contrast sample",
  "function greet(name: string): Promise<string> {",
  "  return Promise.resolve(`hi ${name}`)",
  "}",
  "```",
  "",
  "```css",
  ".panel.warning { color: var(--accent); }",
  "```",
  "",
  "```xml",
  '<article data-state="open">Hello</article>',
  "```",
  "",
  "```yaml",
  "---",
  "title: &title Example",
  "items:",
  "  - *title",
  "```",
  "",
  "```markdown",
  "> quoted",
  "- bullet",
  "[link](https://example.com)",
  "```",
  "",
  "```bash",
  'echo "$HOME" && export NAME=value',
  "```",
  "",
  "```rust",
  "pub enum Mode { Fast }",
  'let value: Option<String> = Some(String::from("x"));',
  "```",
  "",
  "```diff",
  "@@ -1,2 +1,2 @@",
  "-const stale = true",
  "+const fresh = true",
  "```",
].join("\n")

test("rendered Markdown syntax highlighting stays readable across overlay themes", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/global/projects/discover") return send([])
    if (path === "/mission") return send([])
    if (path === "/session") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs") {
      return send({
        branch: "dev",
        clean: true,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      })
    }
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config") return send({ model: "" })
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/task/events") return eventStream()
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return send({})
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on("console", (item) => {
      const type = item.type()
      if (type === "error" || type === "warning") consoleErrors.push(`[${type}] ${item.text()}`)
    })
    page.on("pageerror", (error) => {
      pageErrors.push(`${error.message}\n${error.stack ?? ""}`)
    })
    await page.setViewport({ width: 900, height: 620 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
      ;(window as any).__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
                locale: "en-US",
                theme: "light",
                directory: "D:/overlay/workspace/app",
                workspaceDirectory: "D:/overlay/workspace/app",
              }
            }
            if (command === "overlay_settings_save") return true
            if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              hide: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, server.origin)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForFunction(() => typeof (window as any).renderMarkdown === "function")

    await page.evaluate((source) => {
      const style = document.createElement("style")
      style.textContent = `
        .markdown-syntax-stage {
          width: min(760px, calc(100vw - 48px));
          margin: 24px;
          padding: 16px;
          border: var(--oc-border-width) solid var(--border);
          border-radius: var(--oc-radius-large);
          background: var(--surface);
        }
        .markdown-syntax-stage .md-code-toolbar {
          opacity: var(--ui-opacity-full);
          pointer-events: auto;
        }
      `
      document.head.append(style)
      const stage = document.createElement("main")
      stage.className = "markdown-syntax-stage msg-text"
      stage.dataset.ui = "markdown-syntax-stage"
      stage.innerHTML = (window as any).renderMarkdown(source)
      document.body.append(stage)
    }, syntaxMarkdown)

    for (const theme of ["light", "dark", "vscode-dark"]) {
      const result = await page.evaluate((themeName) => {
        document.documentElement.dataset.theme = themeName
        document.body.dataset.theme = themeName

        interface Rgba {
          r: number
          g: number
          b: number
          a: number
        }
        function parseAlpha(value: string | undefined): number {
          if (!value) return 1
          if (value.endsWith("%")) return Number.parseFloat(value) / 100
          return Number.parseFloat(value)
        }
        function parseColor(value: string): Rgba {
          const normalized = value.trim().toLowerCase()
          if (normalized === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
          const rgb = normalized.match(/^rgba?\((.*)\)$/)
          if (rgb) {
            const body = rgb[1]!.trim()
            const [channels, alpha] = body.split("/").map((part) => part.trim())
            const parts = channels!.split(/[\s,]+/).filter(Boolean)
            const [r, g, b] = parts.map((part) => Number.parseFloat(part))
            const a = alpha === undefined ? (parts[3] === undefined ? 1 : parseAlpha(parts[3])) : parseAlpha(alpha)
            if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Invalid rgb color: ${value}`)
            return { r, g, b, a }
          }
          const srgb = normalized.match(/^color\(\s*srgb\s+(.+)\)$/)
          if (srgb) {
            const [channels, alpha] = srgb[1]!.split("/").map((part) => part.trim())
            const [r, g, b] = channels!.split(/\s+/).map((part) => Number.parseFloat(part) * 255)
            const a = alpha === undefined ? 1 : parseAlpha(alpha)
            if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Invalid srgb color: ${value}`)
            return { r, g, b, a }
          }
          const oklab = normalized.match(/^oklab\((.+)\)$/)
          if (oklab) {
            const [channels, alpha] = oklab[1]!.split("/").map((part) => part.trim())
            const [l, aa, bb] = channels!.split(/\s+/).map((part) => Number.parseFloat(part))
            const alphaValue = alpha === undefined ? 1 : parseAlpha(alpha)
            if (![l, aa, bb, alphaValue].every(Number.isFinite)) throw new Error(`Invalid oklab color: ${value}`)
            const ll = l + 0.3963377774 * aa + 0.2158037573 * bb
            const mm = l - 0.1055613458 * aa - 0.0638541728 * bb
            const ss = l - 0.0894841775 * aa - 1.291485548 * bb
            const l3 = ll ** 3
            const m3 = mm ** 3
            const s3 = ss ** 3
            const linearR = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
            const linearG = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
            const linearB = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
            const encode = (channel: number) => {
              const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
              return Math.min(255, Math.max(0, encoded * 255))
            }
            return { r: encode(linearR), g: encode(linearG), b: encode(linearB), a: alphaValue }
          }
          throw new Error(`Unsupported color: ${value}`)
        }
        function composite(foreground: Rgba, background: Rgba): Rgba {
          const alpha = foreground.a + background.a * (1 - foreground.a)
          if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
          return {
            r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
            g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
            b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
            a: alpha,
          }
        }
        function channel(value: number): number {
          const scaled = value / 255
          return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
        }
        function luminance(color: Rgba): number {
          return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
        }
        function contrastRatio(foreground: Rgba, background: Rgba): number {
          const lighter = Math.max(luminance(foreground), luminance(background))
          const darker = Math.min(luminance(foreground), luminance(background))
          return (lighter + 0.05) / (darker + 0.05)
        }
        function effectiveSurface(element: HTMLElement): Rgba {
          const ancestors: HTMLElement[] = []
          for (let node: HTMLElement | null = element; node; node = node.parentElement) {
            ancestors.push(node)
            if (node === document.body) break
          }
          let surface: Rgba = { r: 255, g: 255, b: 255, a: 1 }
          for (const ancestor of ancestors.reverse()) {
            const background = parseColor(getComputedStyle(ancestor).backgroundColor)
            if (background.a > 0) surface = composite(background, surface)
          }
          return surface
        }
        const sampleGroups = [
          {
            intent: "keyword",
            selector: ".hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-type",
          },
          {
            intent: "string",
            selector: ".hljs-string, .hljs-attr, .hljs-symbol, .hljs-bullet",
          },
          {
            intent: "comment",
            selector: ".hljs-comment, .hljs-quote",
          },
          {
            intent: "number",
            selector: ".hljs-number, .hljs-literal",
          },
          {
            intent: "function",
            selector: ".hljs-function .hljs-title, .hljs-title.function_",
          },
          {
            intent: "variable",
            selector: ".hljs-variable, .hljs-template-variable",
          },
          {
            intent: "meta",
            selector: ".hljs-meta, .hljs-selector-class",
          },
          {
            intent: "addition",
            selector: ".hljs-addition",
          },
          {
            intent: "deletion",
            selector: ".hljs-deletion",
          },
          {
            intent: "code-language",
            selector: ".md-code-lang",
          },
        ]
        const stage = document.querySelector<HTMLElement>(".markdown-syntax-stage")
        if (!stage) throw new Error("Missing Markdown syntax stage")
        const samples = sampleGroups
          .flatMap((group) =>
            Array.from(stage.querySelectorAll<HTMLElement>(group.selector), (node) => {
              const style = getComputedStyle(node)
              const rect = node.getBoundingClientRect()
              const color = parseColor(style.color)
              const surface = effectiveSurface(node)
              return {
                intent: group.intent,
                className: node.className,
                text: node.textContent?.trim() ?? "",
                display: style.display,
                visibility: style.visibility,
                rectWidth: rect.width,
                rectHeight: rect.height,
                color: style.color,
                background: style.backgroundColor,
                surfaceAlpha: surface.a,
                contrast: contrastRatio(color, surface),
              }
            }),
          )
          .filter((sample) => sample.text)
        const seenIntents = new Set(samples.map((sample) => sample.intent))
        const missingIntents = sampleGroups
          .filter((group) => !seenIntents.has(group.intent))
          .map((group) => group.intent)
        return { theme: themeName, samples, missingIntents }
      }, theme)

      assert.deepEqual(result.missingIntents, [], `${theme} should render every syntax token intent`)
      for (const sample of result.samples) {
        const label = `${theme} ${sample.intent} ${sample.className} ${sample.text}`
        assert.notEqual(sample.display, "none", label)
        assert.equal(sample.visibility, "visible", label)
        assert.ok(sample.rectWidth > 0 && sample.rectHeight > 0, `${label} rect`)
        assert.equal(sample.surfaceAlpha, 1, `${label} surface`)
        assert.ok(sample.contrast >= 4.5, `${label} contrast ${sample.contrast}`)
      }
    }

    const screenshotPath = resolve(".scratch/markdown-syntax-contrast-light.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light"
      document.body.dataset.theme = "light"
    })
    const stage = await page.$('[data-ui="markdown-syntax-stage"]')
    assert.ok(stage)
    writeFileSync(screenshotPath, await stage.screenshot({}))
    assert.deepEqual(consoleErrors, [])
    assert.deepEqual(pageErrors, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
