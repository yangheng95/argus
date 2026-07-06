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

const SESSION_TASK_ID = "expert-squad-session-scope"
const SESSION_ID = "ses_expert_squad_root"
const DIRECTORY = "D:/overlay/workspace/app"
const SESSION_TASK_TIME = 1_777_000_000_000

function orderKey(domain: string, rank: number, time: number, id: string, sequence = 0): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:${String(sequence).padStart(16, "0")}:${domain}:${id}`
}

function taskOrderKey(id: string, time: number): string {
  return orderKey("task", 10, time, id)
}

function taskItem() {
  return {
    updated_at: SESSION_TASK_TIME + 1,
    pending_interactions: 0,
    overview: { headline: "Expert squad session scope", summary: "Expert squad session scope" },
    task: {
      id: SESSION_TASK_ID,
      requestID: "req-expert-squad-session-scope",
      title: "Expert squad session scope",
      request: "Expert squad session scope",
      directory: DIRECTORY,
      status: "active",
      sessionID: SESSION_ID,
      orderKey: taskOrderKey(SESSION_TASK_ID, SESSION_TASK_TIME),
      time: { created: SESSION_TASK_TIME, started: SESSION_TASK_TIME + 1, updated: SESSION_TASK_TIME + 2 },
    },
  }
}

function conversationForTask(item: ReturnType<typeof taskItem>) {
  return {
    board: {
      task: item.task,
      overview: item.overview,
      goalWorkflows: [],
      interactions: [],
      lastSequence: 1,
      snapshotVersion: `snapshot-${item.task.id}`,
    },
    transcript: [],
    timeline: [],
    events: [],
    view: { topLevelSessionIDs: [], sessions: [], messages: [] },
    agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
    eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
    history: { hasMore: false, oldestTimestamp: null, oldestMessageID: null, limit: 160 },
    messageWatermark: 0,
    lastSequence: 0,
  }
}

function panelCatalog(sessionOverride: string | null) {
  return expertSquadCatalogFixture({
    active: sessionOverride ?? "frontend-replica",
    projectActive: "frontend-replica",
    sessionOverride,
    squads: [
      {
        id: "general",
        label: "General",
        display_prefix: "Builtin",
        description: "Baseline expert squad.",
        built_in: true,
      },
      {
        id: "frontend-replica",
        label: "Frontend Replica",
        namespace: "builtin",
        display_prefix: "Builtin",
        description: "Visual UI verification squad.",
        built_in: false,
      },
      {
        id: "backend",
        label: "Backend",
        namespace: "builtin",
        display_prefix: "Builtin",
        description: "Route and persistence squad.",
        built_in: false,
      },
    ],
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
        display_prefix: "Builtin",
        description: "Baseline expert squad.",
        built_in: true,
      },
      {
        id: "frontend-replica",
        label: "Frontend Replica",
        display_prefix: "Builtin",
        description: "Visual UI verification squad.",
        built_in: false,
        agents: {
          build: "Verify with a real browser screenshot.",
          orchestrator: "Append README guidance into scheduling.",
        },
        virtual_agents: [
          {
            base_role: "build",
            virtual_agent_id: "frontend-replica-builder",
            label: "Frontend Replica Builder",
            description: "Projected package expert on the build base role.",
            package_skill_refs: ["frontend-replica/build/implementation"],
            package_tool_refs: ["frontend-replica/build/visual-qa"],
          },
        ],
      },
      {
        id: "backend",
        label: "Backend",
        display_prefix: "Builtin",
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
        namespace: "builtin",
        id: "frontend-replica",
        targetRoot: "D:/overlay/workspace/app/.opencorvus/expert-squads/builtin/frontend-replica",
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
        selectorHeading:
          Array.from(document.querySelectorAll<HTMLElement>(".expert-squad-section"))
            .find((node) => node.querySelector(".expert-squad-selector-summary"))
            ?.querySelector<HTMLElement>(".expert-squad-section-head strong")
            ?.textContent?.replace(/\s+/g, " ")
            .trim() ?? "",
        selector: text(".expert-squad-selector-summary"),
        projectionRows: Array.from(document.querySelectorAll<HTMLElement>(".expert-squad-projection-row")).map((node) =>
          node.textContent?.replace(/\s+/g, " ").trim() ?? "",
        ),
        virtualAgents: Array.from(
          document.querySelectorAll<HTMLElement>('[data-ui="expert-squad-active-agent-projection"] .expert-squad-projection-row'),
        ).map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""),
        virtualAgentLayout: Array.from(
          document.querySelectorAll<HTMLElement>('[data-ui="expert-squad-active-agent-projection"] .expert-squad-projection-row'),
        ).map((node) => {
          const strong = node.querySelector<HTMLElement>("strong")
          const small = node.querySelector<HTMLElement>("small")
          const strongRect = strong?.getBoundingClientRect()
          const smallRect = small?.getBoundingClientRect()
          const rowRect = node.getBoundingClientRect()
          const smallStyle = small ? getComputedStyle(small) : undefined
          return {
            gridColumnStart: smallStyle?.gridColumnStart ?? "",
            gridColumnEnd: smallStyle?.gridColumnEnd ?? "",
            smallLeft: smallRect?.left ?? 0,
            strongLeft: strongRect?.left ?? 0,
            smallRight: smallRect?.right ?? 0,
            rowRight: rowRect.right,
          }
        }),
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
      { label: "Builtin/General", active: "false", current: "", tag: "BUTTON" },
      { label: "Builtin/Frontend Replica", active: "true", current: "true", tag: "BUTTON" },
      { label: "Builtin/Backend", active: "false", current: "", tag: "BUTTON" },
    ])
    assert.match(state.readme, /Frontend Replica/)
    assert.equal(state.selectorHeading, "Selector Guidance")
    assert.match(state.selector, /desktop UI parity/)
    assert.equal(state.projectionRows.some((row) => row.includes("package_tool_refs") && row.includes("source-evidence")), true)
    assert.equal(state.virtualAgents.some((row) => row.includes("frontend-replica-builder") && row.includes("build")), true)
    assert.equal(
      state.virtualAgentLayout.every(
        (row) =>
          row.gridColumnStart === "2" &&
          row.gridColumnEnd === "auto" &&
          row.smallLeft >= row.strongLeft - 1 &&
          row.smallRight <= row.rowRight + 1,
      ),
      true,
    )
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

test("expert squads settings clears a session override back to project inheritance", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const item = taskItem()
  let sessionOverride: string | null = "backend"
  const catalogRequests: Array<Record<string, string>> = []
  const sessionConfigPatches: unknown[] = []
  const badResponses: string[] = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [item] })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: DIRECTORY, projects: [] })
    if (path === "/session") return send([])
    if (path === "/mission") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: DIRECTORY, exists: true, git: true })
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
    if (path === "/config")
      return send({ server: {}, provider: {}, channel: {}, mcp: {}, model: "", directory: DIRECTORY })
    if (path === "/expert-squad/catalog") {
      catalogRequests.push(Object.fromEntries(url.searchParams))
      return send(panelCatalog(sessionOverride))
    }
    if (path === `/session/${SESSION_ID}/config` && req.method === "PATCH") {
      const body = await req.json()
      sessionConfigPatches.push(body)
      if ((body as Record<string, unknown>).prompt_profile === null) sessionOverride = null
      return send({ config: { prompt_profile: sessionOverride ? { active: sessionOverride } : undefined } })
    }
    if (path === `/session/${SESSION_ID}/config`) {
      return send({ config: { prompt_profile: { active: sessionOverride } } })
    }
    if (path === "/task/events" || path === `/task/${SESSION_TASK_ID}/events`) return eventStream()
    if (path === `/task/${SESSION_TASK_ID}/conversation`) return send(conversationForTask(item))
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
      return send({ taskID: SESSION_TASK_ID, sessionID: SESSION_ID, agent: "orchestrator", model: null })
    }
    if (/^\/task\/[^/]+\/browser-preview$/.test(path))
      return send({
        taskID: SESSION_TASK_ID,
        kind: "missing",
        status: "missing",
        projectRoot: DIRECTORY,
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
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
    page.on("response", (response: any) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })
    await page.setViewport({ width: 1440, height: 960 })
    await page.evaluateOnNewDocument(
      ({ serverUrl, directory }) => {
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
                  directory,
                }
              }
              if (command === "overlay_settings_save") return true
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
      { serverUrl: server.origin, directory: DIRECTORY },
    )

    await page.goto(`${server.origin}/ui/index.html?taskID=${encodeURIComponent(SESSION_TASK_ID)}`, { waitUntil: "load" })
    await page.waitForFunction(
      (taskID: string) =>
        (window as any).boardStore?.selectedSource?.kind === "task" &&
        (window as any).boardStore.selectedSource.id === taskID,
      { timeout: 15_000 },
      SESSION_TASK_ID,
    )
    await page.waitForSelector('[data-menu-trigger="settings"]')
    await page.click('[data-menu-trigger="settings"]')
    await page.waitForSelector('[data-testid="titlebar-settings-expert-squad"]')
    await page.click('[data-testid="titlebar-settings-expert-squad"]')
    await page.waitForSelector('[data-config-panel="expert-squad"] [data-ui="expert-squad-clear-session-override"]:not([disabled])')

    const before = await page.evaluate(() => ({
      scope: document.querySelector('[data-kind="scope"]')?.textContent?.replace(/\s+/g, " ").trim(),
      projectActive: document.querySelector('[data-kind="project-active"]')?.textContent?.replace(/\s+/g, " ").trim(),
      effectiveActive: document.querySelector('[data-kind="effective-active"]')?.textContent?.replace(/\s+/g, " ").trim(),
      sessionOverride: document.querySelector('[data-kind="session-override"]')?.textContent?.replace(/\s+/g, " ").trim(),
      clearButton: document
        .querySelector('[data-ui="expert-squad-clear-session-override"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      clearDisabled: document.querySelector<HTMLButtonElement>('[data-ui="expert-squad-clear-session-override"]')?.disabled,
    }))
    assert.match(before.scope ?? "", /session/i)
    assert.match(before.projectActive ?? "", /Frontend Replica/)
    assert.match(before.effectiveActive ?? "", /Backend/)
    assert.match(before.sessionOverride ?? "", /Backend/)
    assert.equal(before.clearButton, "Inherit Project")
    assert.equal(before.clearDisabled, false)

    mkdirSync(resolve(".scratch"), { recursive: true })
    const panel = await page.$("#expertSquadBody")
    assert.ok(panel)
    writeFileSync(resolve(".scratch/expert-squad-session-clear-before.png"), await panel.screenshot({}))

    await page.click('[data-ui="expert-squad-clear-session-override"]')
    await page.waitForFunction(() =>
      /inherits project/i.test(document.querySelector('[data-kind="session-override"]')?.textContent ?? ""),
    )

    const after = await page.evaluate(() => ({
      effectiveActive: document.querySelector('[data-kind="effective-active"]')?.textContent?.replace(/\s+/g, " ").trim(),
      sessionOverride: document.querySelector('[data-kind="session-override"]')?.textContent?.replace(/\s+/g, " ").trim(),
      clearDisabled: document.querySelector<HTMLButtonElement>('[data-ui="expert-squad-clear-session-override"]')?.disabled,
      notice: document.querySelector(".config-status-box")?.textContent?.replace(/\s+/g, " ").trim(),
    }))
    assert.equal(
      catalogRequests.some((request) => request.directory === DIRECTORY && request.sessionID === SESSION_ID),
      true,
    )
    assert.deepEqual(sessionConfigPatches, [{ prompt_profile: null }])
    assert.match(after.effectiveActive ?? "", /Frontend Replica/)
    assert.match(after.sessionOverride ?? "", /inherits project/i)
    assert.equal(after.clearDisabled, true)
    assert.match(after.notice ?? "", /inherits project/)
    assert.deepEqual(badResponses, [])
    writeFileSync(resolve(".scratch/expert-squad-session-clear-after.png"), await panel.screenshot({}))
  } finally {
    await browser.close()
    await server.close()
  }
})
