import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"
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

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch
  const base = target && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key]
    } else {
      base[key] = mergePatch(base[key], value)
    }
  }
  return base
}

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

test("expert squads settings renders package identity, projections, lifecycle actions, and active-only writes", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  let config: Record<string, unknown> = {
    model: "opencorvus/gpt-5-nano",
    prompt_profile: { active: "frontend-replica" },
  }
  const configPatches: Record<string, unknown>[] = []
  const lifecycleRequests: Array<{ path: string; query: Record<string, string>; body: unknown }> = []

  const catalog = expertSquadCatalogFixture({
    active: "frontend-replica",
    projectActive: "frontend-replica",
    targets: [
      {
        id: "build",
        label: "Build",
        description: "Implementation and verification.",
        editable: true,
        built_in_only: false,
      },
      {
        id: "orchestrator",
        label: "Orchestrator",
        description: "Visible scheduling prompt append.",
        editable: false,
        built_in_only: true,
      },
    ],
    squads: [
      {
        id: "general",
        label: "General",
        description: "Baseline expert squad.",
        built_in: true,
      },
      {
        id: "frontend-replica",
        label: "Frontend Replica",
        description: "Visual UI verification squad.",
        built_in: false,
        agents: {
          build: "Verify with a real browser screenshot.",
          orchestrator: "Append README guidance into scheduling.",
        },
      },
      {
        id: "backend",
        label: "Backend",
        description: "Route and persistence squad.",
        built_in: false,
        agents: {
          build: "Prove backend behavior with focused route tests.",
        },
      },
    ],
  })
  const frontendReplica = catalog.squads.find((squad) => squad.id === "frontend-replica")!
  frontendReplica.selector = {
    ref: "frontend-replica/selector",
    id: "frontend-replica",
    label: "Frontend Replica",
    summary: "Use for parity and rendered UI review.",
    selection_guidance: "Select when the task asks for desktop UI parity.",
    instructions_path: "selector.md",
    instructions: "# Selector\n\nUse browser evidence before selecting.",
  }
  frontendReplica.capability_projection.scheduler.package_tool_refs = ["frontend-replica/orchestrator/source-evidence"]
  frontendReplica.capability_projection.scheduler.package_skill_refs = ["frontend-replica/selector"]
  frontendReplica.capability_projection.agents.build.package_tool_refs = ["frontend-replica/build/visual-qa"]
  catalog.active_skill_projection = {
    ...catalog.active_skill_projection,
    active_squad_id: "frontend-replica",
    projected_agent_ids: ["build", "orchestrator"],
    projected_tool_ids: ["frontend-replica/orchestrator/source-evidence", "frontend-replica/build/visual-qa"],
    selector_skill_names: ["frontend-replica-expert-squad"],
    production_skill_names: ["frontend-replica-build"],
    projected_skill_names: ["frontend-replica-expert-squad", "frontend-replica-build"],
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
    if (path === "/session") return send([])
    if (path === "/mission") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs")
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
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/expert-squad/catalog") return send(catalog)
    if (path === "/config" && req.method === "GET") return send(config)
    if (path === "/config" && req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>
      configPatches.push(body)
      config = mergePatch(config, body) as Record<string, unknown>
      return send(config)
    }
    if (["/expert-squad/import-folder", "/expert-squad/import-file", "/expert-squad/export"].includes(path)) {
      const body = (await req.json()) as Record<string, unknown>
      lifecycleRequests.push({ path, query: Object.fromEntries(url.searchParams), body })
      if (path === "/expert-squad/export") {
        return send({ id: body.id, filename: `${body.id}.zip`, archiveBase64: "eA==", fileCount: 1 })
      }
      return send({
        id: "frontend-replica",
        targetRoot: "D:/overlay/workspace/app/.opencorvus/expert-squads/frontend-replica",
        replaced: Boolean(body.replace),
      })
    }
    if (path === "/task/events") return eventStream()
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/mounts")
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: { agents: {} }, unmounted_count: 0 })
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 960 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      ;(window as any).__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
                locale: "en-US",
                directory: "D:/overlay/workspace/app",
              }
            }
            if (command === "overlay_settings_save") return true
            if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
            if (command === "overlay_pick_dir") return "D:/incoming/frontend-replica"
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
    await page.waitForSelector('[data-menu-trigger="settings"]')
    await page.click('[data-menu-trigger="settings"]')
    await page.waitForSelector('[data-testid="titlebar-settings-expert-squad"]')
    await page.click('[data-testid="titlebar-settings-expert-squad"]')
    await page.waitForSelector('[data-config-panel="expert-squad"] [data-ui="expert-squad-panel"]')

    const state = await page.evaluate(() => {
      const text = (selector: string) =>
        document.querySelector<HTMLElement>(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
      const list = Array.from(document.querySelectorAll<HTMLElement>('[data-ui="expert-squad-list"] .expert-squad-list-row')).map(
        (node) => ({
          label: node.querySelector("strong")?.textContent?.trim() ?? "",
          active: node.dataset.active ?? "",
          current: node.getAttribute("aria-current") ?? "",
          tag: node.tagName,
        }),
      )
      return {
        tabText: text('[data-config-tab="expert-squad"]'),
        scope: text('[data-kind="scope"]'),
        projectActive: text('[data-kind="project-active"]'),
        effectiveActive: text('[data-kind="effective-active"]'),
        projection: text('[data-kind="projection"]'),
        list,
        readme: text(".expert-squad-markdown"),
        selector: text(".expert-squad-selector-summary"),
        projectionRows: Array.from(document.querySelectorAll<HTMLElement>(".expert-squad-projection-row")).map((node) =>
          node.textContent?.replace(/\s+/g, " ").trim() ?? "",
        ),
        targets: Array.from(document.querySelectorAll<HTMLElement>(".expert-squad-target")).map((node) => ({
          hasOverlay: node.dataset.hasOverlay ?? "",
          text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
        })),
        legacyPromptPanel: Boolean(document.querySelector('[data-config-panel="prompt"], #promptBody')),
        textareas: document.querySelectorAll(".expert-squad-panel textarea").length,
        deleteButtons: document.querySelectorAll('[data-ui="expert-squad-delete"]').length,
      }
    })

    assert.equal(state.tabText.includes("Expert Squads"), true)
    assert.match(state.scope, /Project/)
    assert.match(state.projectActive, /Frontend Replica/)
    assert.match(state.effectiveActive, /Frontend Replica/)
    assert.match(state.projection, /frontend-replica/)
    assert.deepEqual(state.list, [
      { label: "General", active: "false", current: "", tag: "BUTTON" },
      { label: "Frontend Replica", active: "true", current: "true", tag: "BUTTON" },
      { label: "Backend", active: "false", current: "", tag: "BUTTON" },
    ])
    assert.match(state.readme, /Frontend Replica/)
    assert.match(state.selector, /desktop UI parity/)
    assert.equal(state.projectionRows.some((row) => row.includes("package_tool_refs") && row.includes("source-evidence")), true)
    assert.equal(state.targets.every((target) => target.hasOverlay === "true" && target.text.includes("Read-only")), true)
    assert.equal(state.legacyPromptPanel, false)
    assert.equal(state.textareas, 0)
    assert.equal(state.deleteButtons, 0)

    mkdirSync(resolve(".scratch"), { recursive: true })
    const panel = await page.$("#expertSquadBody")
    assert.ok(panel)
    writeFileSync(resolve(".scratch/expert-squad-settings-panel.png"), await panel.screenshot({}))
    await page.$eval(".expert-squad-detail > .expert-squad-section:last-child", (node) => {
      node.scrollIntoView({ block: "start" })
    })
    const agentOverlays = await page.$(".expert-squad-detail > .expert-squad-section:last-child")
    assert.ok(agentOverlays)
    writeFileSync(resolve(".scratch/expert-squad-settings-agent-overlays.png"), await agentOverlays.screenshot({}))

    await page.click('[data-ui="expert-squad-list"] .expert-squad-list-row:nth-child(3)')
    await page.waitForFunction(() =>
      document.querySelector('[data-ui="expert-squad-detail"] .expert-squad-detail-copy strong')?.textContent?.includes("Backend"),
    )
    await page.click('[data-ui="expert-squad-activate-project"]')
    await page.waitForFunction(() => document.querySelector(".config-status-box")?.textContent?.length)
    assert.deepEqual(configPatches.filter((patch) => "prompt_profile" in patch), [{ prompt_profile: { active: "backend" } }])

    await page.click('[data-ui="expert-squad-list"] .expert-squad-list-row:nth-child(2)')
    await page.waitForSelector('[data-ui="expert-squad-export"]:not([disabled])')
    await page.click('[data-ui="expert-squad-export"]')
    await page.click('[data-ui="expert-squad-import-folder"]')
    await page.waitForFunction(() => document.querySelector(".config-status-box")?.textContent?.length)

    assert.equal(lifecycleRequests.some((request) => request.path === "/expert-squad/export"), true)
    assert.equal(lifecycleRequests.some((request) => request.path === "/expert-squad/import-folder"), true)
    assert.equal(
      lifecycleRequests.every((request) => request.query.directory === "D:/overlay/workspace/app"),
      true,
    )
  } finally {
    await browser.close()
    await server.close()
  }
})
