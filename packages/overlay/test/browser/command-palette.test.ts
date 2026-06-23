import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
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
  targets: [{ id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false }],
  profiles: [
    {
      id: "general",
      label: "General",
      description: "General implementation profile.",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

const installedSkills = [
  {
    name: "alpha-skill",
    description: "Initial test skill",
    location: "D:/skills/alpha",
    source_type: "config_path",
    source: "D:/skills/alpha",
  },
]

const skillMarket = [
  {
    id: "market-install",
    name: "market-install",
    provider: "OpenCorvus",
    trust: "curated",
    install_kind: "git",
    source: "https://market.example.com/.well-known/skills/",
    description: "Installable skill entry",
    recommended_policy: "trusted",
  },
]

const mcpStatus = {
  docs: {
    status: "connected",
    type: "remote",
    url: "https://mcp.example.com",
  },
}

test("command palette uses the shared Dialog primitive while preserving hotkey focus flow", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")
  const errors: string[] = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/projects/discover") {
      return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
    }
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission") return send([])
    if (path === "/task/events") return eventStream()
    if (path === "/session") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/project/current/worktrees") return send([])
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
    if (path === "/provider/hexin/budget") return send({ ok: false, error: "HEXIN_API_KEY unset" })
    if (path === "/config/providers") return send({ providers: [] })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/config") return send({ model: "" })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/executor") return send([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/skill/installed" || path === "/skill") return send(installedSkills)
    if (path === "/skill/directories")
      return send({
        global_config: "D:/skills/config",
        managed_skills: "D:/skills/config/skills-market",
        remote_cache: "D:/skills/cache",
      })
    if (path === "/skill/market") return send(skillMarket)
    if (path === "/mcp") return send(mcpStatus)
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
  })

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    async function openCommandPaletteFromKeyboard() {
      await page.keyboard.down("Control")
      await page.keyboard.press("k")
      await page.keyboard.up("Control")
      await page.waitForSelector(".cmdk-panel")
    }
    async function assertConfigCloseButtonPrimitive(screenshotPath?: string) {
      const rest = await page.$eval("#btnCloseConfigDialog", (node) => {
        const button = node as HTMLButtonElement
        const style = window.getComputedStyle(button)
        const rect = button.getBoundingClientRect()
        return {
          tagName: button.tagName,
          className: button.className,
          variant: button.dataset.variant || "",
          size: button.dataset.size || "",
          tone: button.dataset.tone || "",
          ui: button.dataset.ui || "",
          title: button.getAttribute("title") || "",
          ariaLabel: button.getAttribute("aria-label") || "",
          width: rect.width,
          height: rect.height,
          color: style.color,
          backgroundColor: style.backgroundColor,
        }
      })
      assert.equal(rest.tagName, "BUTTON")
      assert.match(rest.className, /\boc-button\b/)
      assert.equal(rest.variant, "ghost")
      assert.equal(rest.size, "icon")
      assert.equal(rest.tone, "neutral")
      assert.equal(rest.ui, "config-dialog-close")
      assert.equal(rest.title, "Close")
      assert.equal(rest.ariaLabel, "Close")
      assert.ok(rest.width > 0)
      assert.ok(rest.height > 0)
      assert.ok(Math.abs(rest.width - rest.height) <= 1)

      await page.hover("#btnCloseConfigDialog")
      const hover = await page.$eval("#btnCloseConfigDialog", (node) => {
        const style = window.getComputedStyle(node as HTMLElement)
        return {
          color: style.color,
          backgroundColor: style.backgroundColor,
        }
      })
      assert.notEqual(hover.backgroundColor, "rgba(0, 0, 0, 0)")
      assert.notEqual(hover.backgroundColor, "transparent")

      await page.focus("#btnCloseConfigDialog")
      const focus = await page.$eval("#btnCloseConfigDialog", (node) => {
        const button = node as HTMLButtonElement
        const style = window.getComputedStyle(button)
        return {
          active: document.activeElement === button,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          focusVisible: button.matches(":focus-visible"),
        }
      })
      assert.equal(focus.active, true)
      assert.equal(focus.focusVisible, true)
      assert.notEqual(focus.outlineStyle, "none")
      assert.notEqual(focus.outlineWidth, "0px")

      if (screenshotPath) {
        const screenshot = await page.screenshot({ fullPage: false })
        assert.ok(screenshot.length > 0)
        writeFileSync(screenshotPath, screenshot)
      }
    }
    async function runConfigCommand(query: string, panelID: string, expectedText: string, screenshotPath?: string) {
      await openCommandPaletteFromKeyboard()
      await page.click(".cmdk-input")
      await page.keyboard.type(query)
      await page.waitForFunction(
        (targetPanelID) => {
          const activeID = document
            .querySelector<HTMLInputElement>(".cmdk-input")
            ?.getAttribute("aria-activedescendant")
          const active = activeID ? document.getElementById(activeID) : null
          return (
            active instanceof HTMLElement &&
            active.dataset.commandId === `settings:${targetPanelID}` &&
            active.hasAttribute("data-highlighted")
          )
        },
        {},
        panelID,
      )
      await page.keyboard.press("Enter")
      await page.waitForFunction(
        (targetPanelID) =>
          document.querySelector("#configDialog") !== null &&
          document.querySelector(`[data-config-panel="${targetPanelID}"] .config-section-body`) !== null,
        {},
        panelID,
      )
      await page.waitForFunction((text) => document.body.textContent?.includes(text), {}, expectedText)
      await assertConfigCloseButtonPrimitive(screenshotPath)
      await page.click("#btnCloseConfigDialog")
      await page.waitForFunction(() => document.querySelector("#configDialog") === null)
    }
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`)
    })
    page.on("requestfailed", (request) => {
      if (/\/task\/events(?:\?.*)?$/.test(request.url())) return
      errors.push(`requestfailed: ${request.url()}`)
    })
    page.on("response", (response) => {
      if (response.status() === 404) errors.push(`response404: ${response.url()}`)
    })
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
    })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
    }, server.port)
    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-menu-trigger="help"]')
    await page.focus('[data-menu-trigger="help"]')

    await openCommandPaletteFromKeyboard()

    const openState = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>(".cmdk-dialog")
      const panel = document.querySelector<HTMLElement>(".cmdk-panel")
      const header = document.querySelector<HTMLElement>(".cmdk-header")
      const panelRect = panel?.getBoundingClientRect()
      return {
        role: dialog?.getAttribute("role"),
        ariaModal: dialog?.getAttribute("aria-modal"),
        activeClass: (document.activeElement as HTMLElement | null)?.className || "",
        dialogClass: dialog?.className || "",
        panelClass: panel?.className || "",
        headerWidth: header?.getBoundingClientRect().width ?? 0,
        panelTop: panelRect?.top ?? 0,
        panelWidth: panelRect?.width ?? 0,
        viewportWidth: window.innerWidth,
      }
    })
    assert.equal(openState.role, "dialog")
    assert.equal(openState.ariaModal, "true")
    assert.match(String(openState.activeClass), /cmdk-input/)
    assert.match(String(openState.dialogClass), /dialog/)
    assert.match(String(openState.dialogClass), /cmdk-dialog/)
    assert.match(String(openState.panelClass), /dialog-form/)
    assert.match(String(openState.panelClass), /cmdk-panel/)
    assert.ok(
      openState.headerWidth <= 1,
      `expected command palette title header to be visually hidden: ${JSON.stringify(openState)}`,
    )
    assert.ok(
      openState.panelTop > 48 && openState.panelTop < 160,
      `unexpected command palette top offset: ${JSON.stringify(openState)}`,
    )
    assert.ok(
      openState.viewportWidth - openState.panelWidth >= 64,
      `expected command palette side breathing room: ${JSON.stringify(openState)}`,
    )
    const initialRelation = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(".cmdk-input")
      const list = document.querySelector<HTMLElement>(".cmdk-list")
      const activeID = input?.getAttribute("aria-activedescendant") || ""
      const active = activeID ? document.getElementById(activeID) : null
      return {
        inputRole: input?.getAttribute("role") || "",
        autocomplete: input?.getAttribute("aria-autocomplete") || "",
        expanded: input?.getAttribute("aria-expanded") || "",
        controls: input?.getAttribute("aria-controls") || "",
        listID: list?.id || "",
        listRole: list?.getAttribute("role") || "",
        activeID,
        activeRole: active?.getAttribute("role") || "",
        activeSelected: active?.getAttribute("aria-selected") || "",
        activeHighlighted: active instanceof HTMLElement && active.hasAttribute("data-highlighted") ? "true" : "false",
        activeCommandID: active instanceof HTMLElement ? active.dataset.commandId || "" : "",
        activeClass: active?.className || "",
      }
    })
    assert.deepEqual(initialRelation, {
      inputRole: "combobox",
      autocomplete: "list",
      expanded: "true",
      controls: "commandPaletteListbox",
      listID: "commandPaletteListbox",
      listRole: "listbox",
      activeID: initialRelation.activeID,
      activeRole: "option",
      activeSelected: "false",
      activeHighlighted: "true",
      activeCommandID: initialRelation.activeCommandID,
      activeClass: initialRelation.activeClass,
    })
    assert.ok(initialRelation.activeID.length > 0)
    assert.ok(initialRelation.activeCommandID.length > 0)
    assert.match(initialRelation.activeClass, /cmdk-item/)

    await page.keyboard.press("ArrowDown")
    const activeRelation = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(".cmdk-input")
      const activeID = input?.getAttribute("aria-activedescendant") || ""
      const active = activeID ? document.getElementById(activeID) : null
      return {
        activeID,
        activeRole: active?.getAttribute("role") || "",
        activeSelected: active?.getAttribute("aria-selected") || "",
        activeHighlighted: active instanceof HTMLElement && active.hasAttribute("data-highlighted") ? "true" : "false",
        activeCommandID: active instanceof HTMLElement ? active.dataset.commandId || "" : "",
        activeClass: active?.className || "",
      }
    })
    assert.ok(activeRelation.activeID.length > 0)
    assert.equal(activeRelation.activeRole, "option")
    assert.equal(activeRelation.activeHighlighted, "true")
    assert.ok(activeRelation.activeCommandID.length > 0)
    assert.match(activeRelation.activeClass, /cmdk-item/)

    await page.keyboard.press("ArrowDown")
    const afterArrow = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(".cmdk-input")
      const activeID = input?.getAttribute("aria-activedescendant") || ""
      const active = activeID ? document.getElementById(activeID) : null
      return {
        activeID,
        activeRole: active?.getAttribute("role") || "",
        activeSelected: active?.getAttribute("aria-selected") || "",
        activeHighlighted: active instanceof HTMLElement && active.hasAttribute("data-highlighted") ? "true" : "false",
        activeCommandID: active instanceof HTMLElement ? active.dataset.commandId || "" : "",
        activeClass: active?.className || "",
      }
    })
    assert.notEqual(afterArrow.activeID, activeRelation.activeID)
    assert.ok(afterArrow.activeID.length > 0)
    assert.equal(afterArrow.activeRole, "option")
    assert.equal(afterArrow.activeHighlighted, "true")
    assert.notEqual(afterArrow.activeCommandID, activeRelation.activeCommandID)
    assert.match(afterArrow.activeClass, /cmdk-item/)
    const visibleErrors = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.app-notification[data-tone="error"], .app-notification[data-tone="warning"]',
        ),
      ).map((item) => item.textContent?.replace(/\s+/g, " ").trim() || ""),
    )
    assert.deepEqual(visibleErrors, [])

    const screenshotPath = resolve(".scratch/command-palette-dialog-primitive.png")
    mkdirSync(resolve(".scratch"), { recursive: true })
    const screenshot = await page.screenshot({ fullPage: false })
    assert.ok(screenshot.length > 0)
    writeFileSync(screenshotPath, screenshot)

    await page.keyboard.press("Escape")
    await page.waitForFunction(() => !document.querySelector(".cmdk-panel"))
    const restored = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.menuTrigger || "",
    )
    assert.equal(restored, "help")
    await runConfigCommand("MCP", "mcp", "docs")
    await runConfigCommand(
      "skill market",
      "skill-market",
      "market-install",
      resolve(".scratch/command-palette-skill-market-command.png"),
    )
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
