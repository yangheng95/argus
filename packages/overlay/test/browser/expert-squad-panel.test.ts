import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
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
  const base =
    target && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {}
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
  const catalog = expertSquadCatalogFixture({
    active: sessionOverride ?? "frontend-replica",
    projectActive: "frontend-replica",
    sessionOverride,
    targets: [
      {
        id: "build",
        label: "Build",
        description: "Implementation and verification.",
        editable: true,
        built_in_only: false,
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
        namespace: "builtin",
        display_prefix: "Builtin",
        description: "Visual UI verification squad.",
        built_in: false,
        virtual_agents: [
          {
            base_role: "build",
            virtual_agent_id: "frontend-replica-builder",
            label: "Frontend Replica Builder",
            package_skill_refs: ["frontend-replica/build/implementation"],
            package_tool_refs: ["frontend-replica/build/visual-qa"],
            package_mcp_server_refs: ["frontend-replica/build/browser"],
            package_mcp_prompt_refs: ["frontend-replica/build/browser/prompt/inspect"],
          },
        ],
      },
      {
        id: "backend",
        label: "Backend",
        namespace: "builtin",
        display_prefix: "Builtin",
        description: "Route and persistence squad.",
        built_in: false,
        virtual_agents: [
          {
            base_role: "build",
            virtual_agent_id: "backend-builder",
            label: "Backend Builder",
            package_skill_refs: ["backend/build/route-tests"],
            package_tool_refs: ["backend/build/route-evidence"],
          },
        ],
      },
    ],
  })
  const activeSquad = catalog.squads.find((squad) => squad.id === catalog.active.effective)
  catalog.active_skill_projection.projected_agent_ids =
    activeSquad?.virtual_agents.map((agent) => agent.base_role) ?? []
  catalog.active_skill_projection.projected_tool_ids = catalog.active_agent_projection.agents.flatMap(
    (agent) => agent.package_tool_refs,
  )
  catalog.active_skill_projection.projected_skill_names = catalog.active_agent_projection.agents.flatMap(
    (agent) => agent.package_skill_refs,
  )
  return catalog
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
        virtual_agents: [
          {
            base_role: "build",
            virtual_agent_id: "frontend-replica-builder",
            label: "Frontend Replica Builder",
            description: "Projected package expert on the build base role.",
            package_skill_refs: ["frontend-replica/build/implementation"],
            package_tool_refs: ["frontend-replica/build/visual-qa"],
            package_mcp_server_refs: ["frontend-replica/build/browser"],
            default_mcp_tool_refs: ["default/mcp/browser/tool/snapshot"],
            package_mcp_prompt_refs: ["frontend-replica/build/browser/prompt/inspect"],
            package_mcp_resource_refs: ["frontend-replica/build/browser/resource/dom"],
          },
        ],
      },
      {
        id: "backend",
        label: "Backend",
        display_prefix: "Builtin",
        description: "Route and persistence squad.",
        built_in: false,
        virtual_agents: [
          {
            base_role: "build",
            virtual_agent_id: "backend-builder",
            label: "Backend Builder",
            package_skill_refs: ["backend/build/route-tests"],
            package_tool_refs: ["backend/build/route-evidence"],
          },
        ],
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
  frontendReplica.capability_projection.scheduler.default_mcp_server_refs = ["default/mcp/browser"]
  frontendReplica.capability_projection.scheduler.package_mcp_server_refs = ["frontend-replica/orchestrator/browser"]
  frontendReplica.capability_projection.scheduler.default_mcp_tool_refs = ["default/mcp/browser/tool/snapshot"]
  frontendReplica.capability_projection.scheduler.package_mcp_prompt_refs = [
    "frontend-replica/orchestrator/browser/prompt/inspect",
  ]
  frontendReplica.capability_projection.scheduler.package_mcp_resource_refs = [
    "frontend-replica/orchestrator/browser/resource/dom",
  ]
  frontendReplica.capability_projection.agents.build.package_tool_refs = ["frontend-replica/build/visual-qa"]
  catalog.active_skill_projection = {
    ...catalog.active_skill_projection,
    active_squad_id: "frontend-replica",
    projected_agent_ids: ["build"],
    projected_tool_ids: ["frontend-replica/orchestrator/source-evidence", "frontend-replica/build/visual-qa"],
    selector_skill_names: ["frontend-replica-expert-squad"],
    production_skill_names: ["frontend-replica-build"],
    projected_skill_names: ["frontend-replica-expert-squad", "frontend-replica-build"],
  }
  assert.equal(
    catalog.squads.every((squad) => Object.keys(squad.agents).length === 0),
    true,
  )

  function activeAgentProjection(activeID: string) {
    const activeSquad = catalog.squads.find((squad) => squad.id === activeID)
    return {
      source_expert_squad_id: activeID,
      prompt_profile_active: activeID,
      projection_hash: `test-${activeID}`,
      agents:
        activeSquad?.virtual_agents.map((agent) => {
          const projection = activeSquad.capability_projection.agents[agent.base_role]
          return {
            base_role: agent.base_role,
            virtual_agent_id: agent.virtual_agent_id,
            label: agent.label,
            description: agent.description,
            projection_hash: `test-${activeID}-${agent.base_role}`,
            built_in_tool_ids: projection?.built_in_tool_ids ?? [],
            default_skill_refs: projection?.default_skill_refs ?? [],
            package_skill_refs: projection?.package_skill_refs ?? [],
            default_tool_refs: projection?.default_tool_refs ?? [],
            package_tool_refs: projection?.package_tool_refs ?? [],
            default_mcp_server_refs: projection?.default_mcp_server_refs ?? [],
            package_mcp_server_refs: projection?.package_mcp_server_refs ?? [],
            default_mcp_tool_refs: projection?.default_mcp_tool_refs ?? [],
            package_mcp_tool_refs: projection?.package_mcp_tool_refs ?? [],
            default_mcp_prompt_refs: projection?.default_mcp_prompt_refs ?? [],
            package_mcp_prompt_refs: projection?.package_mcp_prompt_refs ?? [],
            default_mcp_resource_refs: projection?.default_mcp_resource_refs ?? [],
            package_mcp_resource_refs: projection?.package_mcp_resource_refs ?? [],
          }
        }) ?? [],
    }
  }

  function setCatalogProjectActive(activeID: string) {
    const activeSquad = catalog.squads.find((squad) => squad.id === activeID)
    catalog.active.effective = activeID
    catalog.active.project = activeID
    catalog.active.session_override = null
    catalog.active_agent_projection = activeAgentProjection(activeID)
    catalog.active_skill_projection = {
      active_squad_id: activeID,
      capability_profile_id: activeID,
      built_in: activeID === "general",
      projection_hash: `test-${activeID}`,
      projected_tool_ids: catalog.active_agent_projection.agents.flatMap((agent) => agent.package_tool_refs),
      projected_agent_ids: activeSquad?.virtual_agents.map((agent) => agent.base_role) ?? [],
      selector_skill_names: [],
      production_skill_names: [],
      projected_skill_names: catalog.active_agent_projection.agents.flatMap((agent) => agent.package_skill_refs),
      skills: [],
    }
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
      const promptProfile =
        typeof config.prompt_profile === "object" && config.prompt_profile !== null
          ? (config.prompt_profile as Record<string, unknown>)
          : {}
      if (typeof promptProfile.active === "string") setCatalogProjectActive(promptProfile.active)
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
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/mounts")
      return send({
        scope: "project",
        skills: [],
        agents: [],
        matrix: [],
        project_mounts: { agents: {} },
        unmounted_count: 0,
      })
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
      const list = Array.from(
        document.querySelectorAll<HTMLElement>('[data-ui="expert-squad-list"] .expert-squad-list-row'),
      ).map((node) => ({
        label: node.querySelector("strong")?.textContent?.trim() ?? "",
        active: node.dataset.active ?? "",
        current: node.getAttribute("aria-current") ?? "",
        tag: node.tagName,
      }))
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
        projectionRows: Array.from(document.querySelectorAll<HTMLElement>(".expert-squad-projection-row")).map(
          (node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "",
        ),
        virtualAgents: Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-ui="expert-squad-active-agent-projection"] .expert-squad-projection-row',
          ),
        ).map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""),
        virtualAgentLayout: Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-ui="expert-squad-active-agent-projection"] .expert-squad-projection-row',
          ),
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
        hasAgentGuidance: document.body.textContent?.includes("Agent Guidance") ?? false,
        hasRawPromptPreview: Boolean(
          document.body.textContent?.includes("Verify with a real browser screenshot.") ||
            document.body.textContent?.includes("Append README guidance into scheduling."),
        ),
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
    assert.equal(
      state.projectionRows.some((row) => row.includes("package_tool_refs") && row.includes("source-evidence")),
      true,
    )
    assert.equal(
      state.projectionRows.some(
        (row) => row.includes("default_mcp_server_refs") && row.includes("default/mcp/browser"),
      ),
      true,
    )
    assert.equal(
      state.projectionRows.some(
        (row) => row.includes("package_mcp_server_refs") && row.includes("frontend-replica/orchestrator/browser"),
      ),
      true,
    )
    assert.equal(
      state.projectionRows.some((row) => row.includes("default_mcp_tool_refs") && row.includes("snapshot")),
      true,
    )
    assert.equal(
      state.projectionRows.some((row) => row.includes("package_mcp_prompt_refs") && row.includes("inspect")),
      true,
    )
    assert.equal(
      state.projectionRows.some((row) => row.includes("package_mcp_resource_refs") && row.includes("dom")),
      true,
    )
    assert.equal(
      state.virtualAgents.some((row) => row.includes("frontend-replica-builder") && row.includes("build")),
      true,
    )
    assert.equal(
      state.virtualAgents.some((row) => row.includes("4 MCP refs")),
      true,
      JSON.stringify(state.virtualAgents),
    )
    assert.equal(
      state.projectionRows.some(
        (row) =>
          row.includes("build") &&
          row.includes("package_mcp_prompt_refs") &&
          row.includes("frontend-replica/build/browser/prompt/inspect"),
      ),
      true,
      JSON.stringify(state.projectionRows),
    )
    assert.equal(
      state.projectionRows.some(
        (row) =>
          row.includes("build") &&
          row.includes("package_mcp_resource_refs") &&
          row.includes("frontend-replica/build/browser/resource/dom"),
      ),
      true,
      JSON.stringify(state.projectionRows),
    )
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
    assert.equal(state.hasAgentGuidance, false)
    assert.equal(state.hasRawPromptPreview, false)
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
    const capabilityProjection = await page.$(".expert-squad-detail > .expert-squad-section:last-child")
    assert.ok(capabilityProjection)
    writeFileSync(
      resolve(".scratch/expert-squad-settings-capability-projection.png"),
      await capabilityProjection.screenshot({}),
    )

    await page.click('[data-ui="expert-squad-list"] .expert-squad-list-row:nth-child(3)')
    await page.waitForFunction(() =>
      document
        .querySelector('[data-ui="expert-squad-detail"] .expert-squad-detail-copy strong')
        ?.textContent?.includes("Backend"),
    )
    const inactiveBackendProjection = await page.evaluate(() => ({
      activeAgentProjectionVisible: Boolean(document.querySelector('[data-ui="expert-squad-active-agent-projection"]')),
      catalogAgentProjection: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-ui="expert-squad-agent-capability-projection"] .expert-squad-projection-row',
        ),
      ).map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""),
    }))
    assert.equal(inactiveBackendProjection.activeAgentProjectionVisible, false)
    assert.equal(
      inactiveBackendProjection.catalogAgentProjection.some(
        (row) => row.includes("build") && row.includes("1 skills") && row.includes("1 tools"),
      ),
      true,
      JSON.stringify(inactiveBackendProjection.catalogAgentProjection),
    )
    await page.click('[data-ui="expert-squad-activate-project"]')
    await page.waitForFunction(() =>
      document.querySelector('[data-kind="project-active"]')?.textContent?.includes("Backend"),
    )
    assert.deepEqual(
      configPatches.filter((patch) => "prompt_profile" in patch),
      [{ prompt_profile: { active: "backend" } }],
    )
    const activatedState = await page.evaluate(() => ({
      projectActive:
        document.querySelector('[data-kind="project-active"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      effectiveActive:
        document.querySelector('[data-kind="effective-active"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      projection: document.querySelector('[data-kind="projection"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      virtualAgents: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-ui="expert-squad-active-agent-projection"] .expert-squad-projection-row',
        ),
      ).map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""),
    }))
    assert.match(activatedState.projectActive, /Backend/)
    assert.match(activatedState.effectiveActive, /Backend/)
    assert.match(activatedState.projection, /backend/i)
    assert.match(activatedState.projection, /1 agents/)
    assert.match(activatedState.projection, /1 skills/)
    assert.match(activatedState.projection, /1 tools/)
    assert.equal(
      activatedState.virtualAgents.some(
        (row) => row.includes("backend-builder") && row.includes("1 skills") && row.includes("1 tools"),
      ),
      true,
      JSON.stringify(activatedState.virtualAgents),
    )
    writeFileSync(resolve(".scratch/expert-squad-settings-activated-backend.png"), await panel.screenshot({}))

    await page.click('[data-ui="expert-squad-list"] .expert-squad-list-row:nth-child(2)')
    await page.waitForSelector('[data-ui="expert-squad-export"]:not([disabled])')
    await page.click('[data-ui="expert-squad-export"]')
    await page.click('[data-ui="expert-squad-import-folder"]')
    await page.waitForFunction(() => document.querySelector(".config-status-box")?.textContent?.length)

    assert.equal(
      lifecycleRequests.some((request) => request.path === "/expert-squad/export"),
      true,
    )
    assert.equal(
      lifecycleRequests.some((request) => request.path === "/expert-squad/import-folder"),
      true,
    )
    assert.equal(
      lifecycleRequests.every((request) => request.query.directory === "D:/overlay/workspace/app"),
      true,
    )
  } finally {
    try {
      await browser.close()
    } finally {
      await server.close()
    }
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
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/mounts")
      return send({
        scope: "project",
        skills: [],
        agents: [],
        matrix: [],
        project_mounts: { agents: {} },
        unmounted_count: 0,
      })
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

    await page.goto(`${server.origin}/ui/index.html?taskID=${encodeURIComponent(SESSION_TASK_ID)}`, {
      waitUntil: "load",
    })
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
    await page.waitForSelector(
      '[data-config-panel="expert-squad"] [data-ui="expert-squad-clear-session-override"]:not([disabled])',
    )

    const before = await page.evaluate(() => ({
      scope: document.querySelector('[data-kind="scope"]')?.textContent?.replace(/\s+/g, " ").trim(),
      projectActive: document.querySelector('[data-kind="project-active"]')?.textContent?.replace(/\s+/g, " ").trim(),
      effectiveActive: document
        .querySelector('[data-kind="effective-active"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      sessionOverride: document
        .querySelector('[data-kind="session-override"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      clearButton: document
        .querySelector('[data-ui="expert-squad-clear-session-override"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      clearDisabled: document.querySelector<HTMLButtonElement>('[data-ui="expert-squad-clear-session-override"]')
        ?.disabled,
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
      effectiveActive: document
        .querySelector('[data-kind="effective-active"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      sessionOverride: document
        .querySelector('[data-kind="session-override"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      clearDisabled: document.querySelector<HTMLButtonElement>('[data-ui="expert-squad-clear-session-override"]')
        ?.disabled,
      notice: document.querySelector(".config-status-box")?.textContent?.replace(/\s+/g, " ").trim(),
      virtualAgents: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-ui="expert-squad-active-agent-projection"] .expert-squad-projection-row',
        ),
      ).map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""),
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
    assert.equal(
      after.virtualAgents.some(
        (row) =>
          row.includes("frontend-replica-builder") &&
          row.includes("1 skills") &&
          row.includes("1 tools") &&
          row.includes("2 MCP refs"),
      ),
      true,
      JSON.stringify(after.virtualAgents),
    )
    assert.deepEqual(badResponses, [])
    writeFileSync(resolve(".scratch/expert-squad-session-clear-after.png"), await panel.screenshot({}))
  } finally {
    try {
      await browser.close()
    } finally {
      await server.close()
    }
  }
})

test("expert squads settings shows pending scope while the selected task root session is unresolved", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const pendingItem = taskItem()
  pendingItem.task.sessionID = ""
  const catalogRequests: Record<string, string>[] = []
  const badResponses: string[] = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [pendingItem] })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: DIRECTORY, projects: [] })
    if (path === "/session") return send([])
    if (path === "/mission") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: DIRECTORY, exists: true, git: true })
    if (path === "/vcs")
      return send({
        branch: "main",
        clean: true,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/prompt") return send({ system: "", prompt: "" })
    if (path === "/config") return send({ prompt_profile: { active: "frontend-replica" } })
    if (path === "/expert-squad/catalog") {
      catalogRequests.push(Object.fromEntries(url.searchParams))
      return send(panelCatalog(null))
    }
    if (path === "/task/events" || path === `/task/${SESSION_TASK_ID}/events`) return eventStream()
    if (path === `/task/${SESSION_TASK_ID}/conversation`) return send(conversationForTask(pendingItem))
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path))
      return send({ taskID: SESSION_TASK_ID, sessionID: "", agent: "orchestrator", model: null })
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
    if (path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/mounts")
      return send({
        scope: "project",
        skills: [],
        agents: [],
        matrix: [],
        project_mounts: { agents: {} },
        unmounted_count: 0,
      })
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
              if (command === "overlay_settings_load")
                return { serverUrl, autoServer: false, locale: "en-US", directory }
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

    await page.goto(`${server.origin}/ui/index.html?taskID=${encodeURIComponent(SESSION_TASK_ID)}`, {
      waitUntil: "load",
    })
    await page.waitForFunction(
      (taskID: string) =>
        (window as any).boardStore?.selectedSource?.kind === "task" &&
        (window as any).boardStore.selectedSource.id === taskID,
      { timeout: 15_000 },
      SESSION_TASK_ID,
    )
    catalogRequests.length = 0
    badResponses.length = 0
    await page.waitForSelector('[data-menu-trigger="settings"]')
    await page.click('[data-menu-trigger="settings"]')
    await page.waitForSelector('[data-testid="titlebar-settings-expert-squad"]')
    await page.click('[data-testid="titlebar-settings-expert-squad"]')
    await page.waitForSelector('[data-ui="expert-squad-scope-state"][data-status="pending"]')

    const state = await page.evaluate(() => ({
      scope: document.querySelector('[data-kind="scope"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      state:
        document.querySelector('[data-ui="expert-squad-scope-state"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      none: document.body.textContent?.includes("No expert squads available") ?? false,
      importFolderDisabled: document.querySelector<HTMLButtonElement>('[data-ui="expert-squad-import-folder"]')
        ?.disabled,
      importArchiveDisabled: document.querySelector<HTMLButtonElement>('[data-ui="expert-squad-import-archive"]')
        ?.disabled,
    }))

    mkdirSync(resolve(".scratch"), { recursive: true })
    writeFileSync(
      resolve(".scratch/expert-squad-pending-state.json"),
      JSON.stringify({ state, catalogRequests, badResponses }, null, 2),
    )

    assert.match(state.scope, /Session resolving/)
    assert.doesNotMatch(state.scope, /Project/)
    assert.match(state.state, /Session scope is loading/)
    assert.equal(state.none, false)
    assert.equal(state.importFolderDisabled, true)
    assert.equal(state.importArchiveDisabled, true)
    assert.deepEqual(catalogRequests, [])
    assert.deepEqual(badResponses, [])

    const panel = await page.$("#expertSquadBody")
    assert.ok(panel)
    writeFileSync(resolve(".scratch/expert-squad-pending-scope-state.png"), await panel.screenshot({}))
  } finally {
    await browser.close()
    await server.close()
  }
})

test("expert squads settings keeps scope status and recovery actions when catalog loading fails", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const errors: string[] = []
  const allowedCatalogFailure = (url: string, status: number) =>
    status === 500 && new URL(url).pathname === "/expert-squad/catalog"
  let importRequested = false
  let resolveSecondCatalog: (() => void) | undefined

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
      if (!importRequested) return send({ message: "catalog unavailable for recovery test" }, { status: 500 })
      if (!resolveSecondCatalog) {
        return await new Promise<Response>((resolve) => {
          resolveSecondCatalog = () => resolve(send(panelCatalog(null)))
        })
      }
      return send(panelCatalog(null))
    }
    if (path === "/expert-squad/import-folder" && req.method === "POST") {
      importRequested = true
      return send({
        namespace: "builtin",
        id: "frontend-replica",
        targetRoot: `${DIRECTORY}/.opencorvus/expert-squads/builtin/frontend-replica`,
        replaced: false,
      })
    }
    if (path === "/task/events") return eventStream()
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/mounts")
      return send({
        scope: "project",
        skills: [],
        agents: [],
        matrix: [],
        project_mounts: { agents: {} },
        unmounted_count: 0,
      })
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    installBrowserErrorCollector(page, {
      allowResponse(response) {
        return response.status === 500 && response.path === "/expert-squad/catalog"
      },
    })
    page.on("response", (response: any) => {
      if (response.status() >= 400 && !allowedCatalogFailure(response.url(), response.status())) {
        errors.push(`${response.status()} ${response.url()}`)
      }
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
      },
      { serverUrl: server.origin, directory: DIRECTORY },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-menu-trigger="settings"]')
    await page.click('[data-menu-trigger="settings"]')
    await page.waitForSelector('[data-testid="titlebar-settings-expert-squad"]')
    await page.click('[data-testid="titlebar-settings-expert-squad"]')
    await page.waitForSelector('[data-ui="expert-squad-catalog-error"]')
    await page.waitForSelector('[data-ui="expert-squad-catalog-recovery"]')

    const state = await page.evaluate(() => {
      const text = (selector: string) =>
        document.querySelector<HTMLElement>(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
      return {
        directory: text('[data-kind="directory"]'),
        scope: text('[data-kind="scope"]'),
        projectActive: text('[data-kind="project-active"]'),
        effectiveActive: text('[data-kind="effective-active"]'),
        selected: text('[data-kind="selected"]'),
        error: text('[data-ui="expert-squad-catalog-error"]'),
        recovery: text('[data-ui="expert-squad-catalog-recovery"]'),
        importFolder: Boolean(document.querySelector('[data-ui="expert-squad-import-folder"]')),
        importArchive: Boolean(document.querySelector('[data-ui="expert-squad-import-archive"]')),
        emptyHint: document.body.textContent?.includes("No expert squads available") ?? false,
        toastCount: document.querySelectorAll(".app-notification").length,
      }
    })

    assert.match(state.directory, new RegExp(DIRECTORY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.match(state.scope, /Project/)
    assert.match(state.projectActive, /-/)
    assert.match(state.effectiveActive, /-/)
    assert.match(state.selected, /-/)
    assert.match(state.error, /Failed to load expert squads/)
    assert.match(state.recovery, /Catalog unavailable/)
    assert.equal(state.importFolder, true)
    assert.equal(state.importArchive, true)
    assert.equal(state.emptyHint, false)
    assert.equal(state.toastCount, 0)
    assert.deepEqual(errors, [])

    mkdirSync(resolve(".scratch"), { recursive: true })
    const panel = await page.$("#expertSquadBody")
    assert.ok(panel)
    writeFileSync(resolve(".scratch/expert-squad-catalog-error-recovery.png"), await panel.screenshot({}))

    await page.click('[data-ui="expert-squad-import-folder"]')
    await page.waitForSelector(".loading-hint")
    const retryLoading = await page.evaluate(() => ({
      errorVisible: Boolean(document.querySelector('[data-ui="expert-squad-catalog-error"]')),
      recoveryVisible: Boolean(document.querySelector('[data-ui="expert-squad-catalog-recovery"]')),
      loadingText: document.querySelector<HTMLElement>(".loading-hint")?.textContent?.trim() ?? "",
    }))
    assert.equal(retryLoading.errorVisible, false)
    assert.equal(retryLoading.recoveryVisible, false)
    assert.match(retryLoading.loadingText, /Loading/)
    writeFileSync(resolve(".scratch/expert-squad-catalog-retry-loading.png"), await panel.screenshot({}))

    assert.equal(typeof resolveSecondCatalog, "function")
    resolveSecondCatalog?.()
    await page.waitForSelector('[data-ui="expert-squad-list"]')
    const recovered = await page.evaluate(() => ({
      errorVisible: Boolean(document.querySelector('[data-ui="expert-squad-catalog-error"]')),
      recoveryVisible: Boolean(document.querySelector('[data-ui="expert-squad-catalog-recovery"]')),
      squadText: document.querySelector<HTMLElement>('[data-ui="expert-squad-list"]')?.textContent ?? "",
    }))
    assert.equal(recovered.errorVisible, false)
    assert.equal(recovered.recoveryVisible, false)
    assert.match(recovered.squadText, /Frontend Replica/)
  } finally {
    try {
      await browser.close()
    } finally {
      await server.close()
    }
  }
})
