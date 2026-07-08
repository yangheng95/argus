import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const PROJECT_DIRECTORY = "D:/overlay/workspace/app"

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
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(":\n\n"))
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      },
    },
  )
}

async function fixtureResponse(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = route(url)
  const directory = url.searchParams.get("directory") ?? PROJECT_DIRECTORY
  if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
  if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
  const staticResponse = await overlayStaticResponse(path)
  if (staticResponse) return staticResponse
  if (path === "/global/health") return send({ version: "1.2.3" })
  if (path === "/global/tasks") return send({ tasks: [] })
  if (path === "/work-ledger") return send({ rows: [], nextCursor: null })
  if (path === "/session" || path === "/mission") return send([])
  if (path === "/path") return send({ directory })
  if (path === "/vcs") {
    return send({
      initialized: true,
      branch: "dev",
      clean: true,
      dirty: false,
      staged: 0,
      modified: 0,
      untracked: 0,
      conflicts: 0,
      ahead: 0,
      behind: 0,
      commit: "0123456789abcdef",
    })
  }
  if (path === "/project/current/worktrees") {
    return send([
      {
        name: "worktree",
        branch: "opencorvus/w/02n7Ucxv",
        directory: "D:/overlay/workspace/app/.opencorvus/r/w/02n7Ucxv/worktree",
        goalID: "gol_one_line_a",
        status: "expired",
        removable: true,
      },
      {
        name: "long-worktree-name-for-ellipsis",
        branch: "opencorvus/s/18ikOXOX",
        directory: "D:/overlay/workspace/app/.opencorvus/r/s/18ikOXOX/worktree",
        goalID: "gol_one_line_b",
        status: "active",
        removable: false,
      },
    ])
  }
  if (path === "/global/projects/discover") {
    return send({
      root: "D:/overlay/workspace",
      defaultDirectory: PROJECT_DIRECTORY,
      projects: [{ directory: PROJECT_DIRECTORY, name: "app", marker: "package.json" }],
    })
  }
  if (path === "/provider") return send({ all: [], connected: [], default: {} })
  if (path === "/provider/auth") return send({})
  if (path === "/config/providers") return send({ providers: [], default: {} })
  if (path === "/config/prompt") return send([])
  if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
  if (path === "/config" && (req.method === "GET" || req.method === "PATCH")) return send({ model: "" })
  if (path === "/skill/mounts") {
    return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
  }
  if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
  if (path === "/coding/cli/profiles") return send({ profiles: [] })
  if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
  if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) return eventStream()
  if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
  if (path === "/skill/installed" || path === "/skill") return send([])
  if (path === "/mcp") return send({})
  if (path === "/panel/knowledge/memory") return send([])
  if (path === "/panel/knowledge/preference") return send([])
  if (path === "/log" && req.method === "POST") return send({ ok: true })
  return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
}

async function saveScreenshot(page: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await page.screenshot({ fullPage: false }))
  return target
}

async function saveElementScreenshot(
  page: { $(selector: string): Promise<{ screenshot(options?: Record<string, unknown>): Promise<Buffer> } | null> },
  selector: string,
  name: string,
) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const screenshot = await element.screenshot({})
  assert.ok(screenshot.length > 0, `${name} screenshot should not be empty`)
  await writeFile(target, screenshot)
  return target
}

async function revealRightToolbar(page: {
  $eval(selector: string, pageFunction: (node: Element) => { x: number; y: number }): Promise<{ x: number; y: number }>
  mouse: { move(x: number, y: number, options?: Record<string, unknown>): Promise<void> }
  waitForFunction(pageFunction: () => boolean): Promise<unknown>
}) {
  const point = await page.$eval("#solidRightActivityToolbar", (node) => {
    const rect = (node as HTMLElement).getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.bottom - Math.min(24, Math.max(4, rect.height / 2)),
    }
  })
  await page.mouse.move(point.x, point.y)
  await page.waitForFunction(() => {
    const toolbar = document.querySelector<HTMLElement>("#solidRightActivityToolbar .side-activity-toolbar")
    const trigger = document.querySelector<HTMLElement>('[data-ui="project-runtime-status-dropdown"]')
    if (!toolbar || !trigger) return false
    if (getComputedStyle(toolbar).pointerEvents !== "auto") return false
    const rect = trigger.getBoundingClientRect()
    const element = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return element === trigger || !!element?.closest('[data-ui="project-runtime-status-dropdown"]')
  })
}

test(
  "right toolbar runtime status panel merges Git status with worktree controls",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture(fixtureResponse)
    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowRequestFailure(failure) {
          return (
            failure.errorText === "net::ERR_ABORTED" &&
            (failure.path === "/task/events" || /^\/task\/[^/]+\/events$/.test(failure.path))
          )
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") return true
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_open_path") return true
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
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"][data-vcs-tone="good"]', {
        visible: true,
      })

      const triggerSemantics = await page.$eval('[data-ui="project-runtime-status-dropdown"]', (node) => {
        const element = node as HTMLElement
        return {
          tag: element.tagName,
          type: element.getAttribute("type") ?? "",
          className: element.className,
          chrome: element.dataset.chrome ?? "",
          toolbarCompact: element.dataset.toolbarCompact ?? "",
          vcsTone: element.dataset.vcsTone ?? "",
          label: element.getAttribute("aria-label") ?? "",
          title: element.getAttribute("title") ?? "",
          badge: element.querySelector(".project-runtime-trigger-badge")?.textContent?.trim() ?? "",
          dotTone: element.querySelector<HTMLElement>(".project-runtime-trigger-dot")?.dataset.tone ?? "",
          svgCount: element.querySelectorAll("svg").length,
        }
      })
      assert.equal(triggerSemantics.tag, "BUTTON")
      assert.equal(triggerSemantics.type, "button")
      assert.match(triggerSemantics.className, /\boc-button\b/)
      assert.equal(triggerSemantics.chrome, "icon-action")
      assert.equal(triggerSemantics.toolbarCompact, "true")
      assert.equal(triggerSemantics.vcsTone, "good")
      assert.match(triggerSemantics.label, /Project runtime/)
      assert.equal(triggerSemantics.title, triggerSemantics.label)
      assert.equal(triggerSemantics.badge, "2")
      assert.equal(triggerSemantics.dotTone, "good")
      assert.ok(triggerSemantics.svgCount >= 1, JSON.stringify(triggerSemantics))

      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.waitForSelector(".project-runtime-git-section[data-tone='good']", { visible: true })
      await page.waitForSelector(".project-worktree-row", { visible: true })

      const panelState = await page.evaluate(() => {
        const trigger = document.querySelector('[data-ui="project-runtime-status-dropdown"]') as HTMLElement | null
        const panel = document.querySelector(".project-runtime-status-panel") as HTMLElement | null
        const gitSection = document.querySelector(".project-runtime-git-section") as HTMLElement | null
        return {
          panelVisible: !!panel && !panel.hidden,
          panelRole: panel?.getAttribute("role") ?? "",
          ariaExpanded: trigger?.getAttribute("aria-expanded") ?? "",
          dataExpanded: trigger?.hasAttribute("data-expanded") ?? false,
          dataOpen: trigger?.getAttribute("data-open") ?? null,
          title: panel?.querySelector(".project-runtime-panel-title")?.textContent?.trim() ?? "",
          gitTitle: gitSection?.querySelector(".project-runtime-section-title")?.textContent?.trim() ?? "",
          gitState: gitSection?.querySelector(".project-runtime-git-state")?.textContent?.trim() ?? "",
          gitRows: [...document.querySelectorAll<HTMLElement>(".project-runtime-git-row")].map((row) =>
            row.textContent?.trim(),
          ),
          worktreeTitle:
            [...document.querySelectorAll<HTMLElement>(".project-runtime-section-title")]
              .map((node) => node.textContent?.trim() ?? "")
              .find((value) => value === "Project worktrees") ?? "",
          cleanupVisible: !!document.querySelector('[data-ui="project-worktree-cleanup-expired"]'),
          removeButtons: document.querySelectorAll('[data-ui="project-worktree-remove"]').length,
          initGitVisible: !!document.querySelector('[data-ui="project-init-git"]'),
        }
      })
      assert.deepEqual(
        {
          panelVisible: panelState.panelVisible,
          panelRole: panelState.panelRole,
          ariaExpanded: panelState.ariaExpanded,
          dataExpanded: panelState.dataExpanded,
          dataOpen: panelState.dataOpen,
          title: panelState.title,
          gitTitle: panelState.gitTitle,
          gitState: panelState.gitState,
          worktreeTitle: panelState.worktreeTitle,
          cleanupVisible: panelState.cleanupVisible,
          removeButtons: panelState.removeButtons,
          initGitVisible: panelState.initGitVisible,
        },
        {
          panelVisible: true,
          panelRole: "menu",
          ariaExpanded: "true",
          dataExpanded: true,
          dataOpen: null,
          title: "Project runtime",
          gitTitle: "Git status",
          gitState: "Working tree clean",
          worktreeTitle: "Project worktrees",
          cleanupVisible: true,
          removeButtons: 2,
          initGitVisible: false,
        },
      )
      assert.ok(
        panelState.gitRows.some((row) => row?.includes("Branch") && row.includes("dev")),
        panelState.gitRows,
      )
      assert.ok(
        panelState.gitRows.every((row) => !row?.includes("Git is not initialized")),
        panelState.gitRows,
      )

      const worktreeRows = await page.evaluate(() => {
        return [...document.querySelectorAll<HTMLElement>(".project-worktree-row")].map((row) => {
          const item = row.querySelector<HTMLElement>(".project-worktree-item")
          const path = row.querySelector<HTMLElement>(".project-worktree-path")
          const branch = row.querySelector<HTMLElement>(".project-worktree-branch")
          const state = row.querySelector<HTMLElement>(".project-worktree-state")
          const rowRect = row.getBoundingClientRect()
          const itemRect = item?.getBoundingClientRect()
          const pathRect = path?.getBoundingClientRect()
          return {
            rowHeight: Math.round(rowRect.height),
            itemHeight: Math.round(itemRect?.height ?? 0),
            pathHeight: Math.round(pathRect?.height ?? 0),
            itemTag: item?.tagName ?? "",
            itemRole: item?.getAttribute("role") ?? "",
            pathWhiteSpace: path ? getComputedStyle(path).whiteSpace : "",
            branchWhiteSpace: branch ? getComputedStyle(branch).whiteSpace : "",
            stateWhiteSpace: state ? getComputedStyle(state).whiteSpace : "",
            gridTemplateAreas: item ? getComputedStyle(item).gridTemplateAreas : "",
          }
        })
      })
      assert.ok(worktreeRows.length >= 2, JSON.stringify(worktreeRows))
      for (const row of worktreeRows) {
        assert.ok(row.rowHeight <= 34, JSON.stringify(row))
        assert.ok(row.itemHeight <= 34, JSON.stringify(row))
        assert.ok(row.pathHeight <= 20, JSON.stringify(row))
        assert.equal(row.itemTag, "BUTTON")
        assert.equal(row.itemRole, "menuitem")
        assert.equal(row.gridTemplateAreas, '"name path state branch"')
        assert.equal(row.pathWhiteSpace, "nowrap")
        assert.equal(row.branchWhiteSpace, "nowrap")
        assert.equal(row.stateWhiteSpace, "nowrap")
      }

      await page.hover('[data-ui="project-runtime-status-dropdown"]')
      const hoverState = await page.$eval('[data-ui="project-runtime-status-dropdown"]', (node) => {
        const style = getComputedStyle(node as HTMLElement)
        return {
          background: style.backgroundColor,
          color: style.color,
          expanded: (node as HTMLElement).hasAttribute("data-expanded"),
        }
      })
      assert.notEqual(hoverState.color, "rgba(0, 0, 0, 0)")
      assert.equal(hoverState.expanded, true)

      const panelScreenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-runtime-status-panel-merged.png",
      )
      assert.ok(panelScreenshot.endsWith("task-dirbar-runtime-status-panel-merged.png"))
      const pageScreenshot = await saveScreenshot(page, "task-dirbar-runtime-status-expanded-state.png")
      assert.ok(pageScreenshot.endsWith("task-dirbar-runtime-status-expanded-state.png"))

      await page.keyboard.press("Escape")
      await page.waitForFunction(() => document.querySelector(".project-runtime-status-panel") === null)
      await page.focus('[data-ui="project-runtime-status-dropdown"]')
      await page.keyboard.press("Enter")
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.keyboard.press("Escape")
      await page.waitForFunction(() => document.querySelector(".project-runtime-status-panel") === null)
      const closedState = await page.$eval('[data-ui="project-runtime-status-dropdown"]', (node) => ({
        ariaExpanded: node.getAttribute("aria-expanded") ?? "",
        dataExpanded: (node as HTMLElement).hasAttribute("data-expanded"),
      }))
      assert.deepEqual(closedState, {
        ariaExpanded: "false",
        dataExpanded: false,
      })

      errors.assertNoUnexpectedErrors()
    } catch (error) {
      console.error(error instanceof Error ? error.stack : error)
      throw error
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)
