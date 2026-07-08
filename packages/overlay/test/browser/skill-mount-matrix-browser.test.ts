import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector, type BrowserErrorCollector } from "./error-collector.ts"
import {
  emptyExpertSquadProjectionEntry,
  expertSquadProjectionEntryFixture,
  generalExpertSquadCatalog,
  projectedDefaultMcpToolID,
  projectedDefaultToolID,
  projectedPackageMcpToolID,
  projectedPackageToolID,
  projectedToolIDs,
} from "./expert-squad-fixture.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const DIRECTORY = "D:/overlay/workspace/app"
const FRONTEND_REPLICA_BUILD_PATCH_REF = "frontend-replica/build/patch"
const FRONTEND_REPLICA_BUILD_PATCH_TOOL_ID = projectedPackageToolID(FRONTEND_REPLICA_BUILD_PATCH_REF)
const FRONTEND_REPLICA_ORCHESTRATOR_AUDIT_REF = "frontend-replica/orchestrator/audit"
const FRONTEND_REPLICA_ORCHESTRATOR_AUDIT_TOOL_ID = projectedPackageToolID(
  FRONTEND_REPLICA_ORCHESTRATOR_AUDIT_REF,
)
const DEFAULT_BROWSER_SNAPSHOT_REF = "default/mcp/browser/tool/snapshot"
const DEFAULT_BROWSER_SNAPSHOT_TOOL_ID = projectedDefaultMcpToolID(DEFAULT_BROWSER_SNAPSHOT_REF)
const DEFAULT_READ_CONTEXT_REF = "default/tool/read_context"
const DEFAULT_READ_CONTEXT_TOOL_ID = projectedDefaultToolID(DEFAULT_READ_CONTEXT_REF)
const DEFAULT_BROWSER_PREVIEW_REF = "default/tool/browser_preview"
const DEFAULT_BROWSER_PREVIEW_TOOL_ID = projectedDefaultToolID(DEFAULT_BROWSER_PREVIEW_REF)
const FRONTEND_REPLICA_REQUIREMENTS_TRACE_REF = "frontend-replica/requirements/trace"
const FRONTEND_REPLICA_REQUIREMENTS_TRACE_TOOL_ID = projectedPackageToolID(
  FRONTEND_REPLICA_REQUIREMENTS_TRACE_REF,
)
const FRONTEND_REPLICA_BUILD_COMPARE_REGION_REF = "frontend-replica/build/browser/tool/compare-region"
const FRONTEND_REPLICA_BUILD_COMPARE_REGION_TOOL_ID = projectedPackageMcpToolID(
  FRONTEND_REPLICA_BUILD_COMPARE_REGION_REF,
)
const FRONTEND_REPLICA_BUILD_BROWSER_SESSION_REF = "frontend-replica/build/browser-session"

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

async function saveElementScreenshot(page: any, selector: string, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  await writeFile(target, await element.screenshot({}))
  return target
}

async function waitForLeftActivity(page: any, activity: string, diagnostics: BrowserErrorCollector): Promise<void> {
  const selector = `[data-ui="side-activity-button"][data-side="left"][data-activity="${activity}"]`
  for (let i = 0; i < 100; i++) {
    const exists = await page.evaluate((query: string) => !!document.querySelector(query), selector)
    if (exists) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${activity} activity button did not mount: ${JSON.stringify(diagnostics.unexpectedErrors)}`)
}

async function compactCapabilityLayoutState(page: any, panelSelector: string, dataUI: string) {
  return await page.$eval(
    `${panelSelector} [data-ui="${dataUI}"]`,
    (layout: HTMLElement, panelSelector: string) => {
      const panel = layout.closest<HTMLElement>(panelSelector)
      const body = panel?.querySelector<HTMLElement>(".extension-settings-body")
      const tabs = layout.querySelector<HTMLElement>(".agent-capability-tabs")!
      const detail = layout.querySelector<HTMLElement>(".agent-capability-detail")!
      const tabRect = tabs.getBoundingClientRect()
      const detailRect = detail.getBoundingClientRect()
      const layoutStyle = getComputedStyle(layout)
      return {
        display: layoutStyle.display,
        flexDirection: layoutStyle.flexDirection,
        gridTemplateColumns: layoutStyle.gridTemplateColumns,
        bodyOverflowY: body ? getComputedStyle(body).overflowY : "",
        vertical: tabRect.bottom <= detailRect.top + 1 && Math.abs(tabRect.left - detailRect.left) <= 2,
        selectedAgents: Array.from(layout.querySelectorAll<HTMLElement>(".agent-capability-tab[aria-selected='true']")).map(
          (node) => node.dataset.agentName || "",
        ),
        detailText: detail.textContent || "",
      }
    },
    panelSelector,
  )
}

async function sidebarWidth(page: any) {
  return await page.$eval("#sidebar", (node: HTMLElement) => Math.round(node.getBoundingClientRect().width))
}

function projection(overrides: Partial<ReturnType<typeof emptyExpertSquadProjectionEntry>>) {
  return expertSquadProjectionEntryFixture(overrides)
}

function projectedExpertSquadCatalog() {
  const catalog = generalExpertSquadCatalog() as any
  const squad = {
    ...catalog.squads[0],
    id: "frontend-replica",
    label: "Frontend Replica",
    description: "Dynamic project expert squad.",
    built_in: false,
    editable: true,
    agents: {
      requirements: "Requirements",
      build: "Build",
      "visual-qa": "Visual QA",
    },
    capability_profile_id: "frontend-replica",
    projection_hash: "projection-vertical-tabs",
    projected_agents: ["requirements", "build", "visual-qa"],
    capability_projection: {
      scheduler: projection({
        built_in_tool_ids: ["select_expert_squad", "skill"],
        package_tool_refs: [FRONTEND_REPLICA_ORCHESTRATOR_AUDIT_REF],
        default_mcp_tool_refs: [DEFAULT_BROWSER_SNAPSHOT_REF],
        package_mcp_prompt_refs: ["frontend-replica/orchestrator/browser/prompt/selector"],
      }),
      agents: {
        requirements: projection({
          default_tool_refs: [DEFAULT_READ_CONTEXT_REF],
          package_tool_refs: [FRONTEND_REPLICA_REQUIREMENTS_TRACE_REF],
          default_mcp_tool_refs: [DEFAULT_BROWSER_SNAPSHOT_REF],
          package_mcp_resource_refs: ["frontend-replica/requirements/browser/resource/reference-dom"],
        }),
        build: projection({
          built_in_tool_ids: ["bash", "apply_patch"],
          package_tool_refs: [FRONTEND_REPLICA_BUILD_PATCH_REF],
          package_mcp_server_refs: [FRONTEND_REPLICA_BUILD_BROWSER_SESSION_REF],
          package_mcp_tool_refs: [FRONTEND_REPLICA_BUILD_COMPARE_REGION_REF],
        }),
        "visual-qa": projection({
          default_tool_refs: [DEFAULT_BROWSER_PREVIEW_REF],
          package_mcp_prompt_refs: ["frontend-replica/visual-qa/browser/prompt/visual-guidance"],
        }),
      },
    },
  }
  return {
    ...catalog,
    active: { effective: "frontend-replica", project: "frontend-replica", session_override: null },
    squads: [catalog.squads[0], squad],
    active_skill_projection: {
      ...catalog.active_skill_projection,
      active_squad_id: "frontend-replica",
      capability_profile_id: "frontend-replica",
      projection_hash: "projection-vertical-tabs",
      projected_tool_ids: projectedToolIDs(
        "select_expert_squad",
        "skill",
        FRONTEND_REPLICA_ORCHESTRATOR_AUDIT_TOOL_ID,
        DEFAULT_BROWSER_SNAPSHOT_TOOL_ID,
        DEFAULT_READ_CONTEXT_TOOL_ID,
        FRONTEND_REPLICA_REQUIREMENTS_TRACE_TOOL_ID,
        FRONTEND_REPLICA_BUILD_PATCH_TOOL_ID,
        FRONTEND_REPLICA_BUILD_COMPARE_REGION_TOOL_ID,
        "bash",
        "apply_patch",
        DEFAULT_BROWSER_PREVIEW_TOOL_ID,
      ),
      projected_agent_ids: ["orchestrator", "requirements", "build", "visual-qa"],
      selector_skill_names: ["frontend-replica-expert-squad"],
      production_skill_names: ["frontend-replica-build"],
      projected_skill_names: ["frontend-replica-expert-squad", "frontend-replica-build"],
    },
  }
}

const agents = [
  {
    name: "requirements",
    description: "Requirements agent",
    mode: "primary",
    native: true,
    hidden: false,
    skill_mountable: true,
    skill_tool_available: true,
  },
  {
    name: "build",
    description: "Build agent",
    mode: "subagent",
    native: true,
    hidden: false,
    skill_mountable: true,
    skill_tool_available: true,
  },
  {
    name: "orchestrator",
    description: "Scheduler",
    mode: "primary",
    native: true,
    hidden: true,
    skill_mountable: false,
    skill_tool_available: true,
  },
  {
    name: "visual-qa",
    description: "Visual QA",
    mode: "subagent",
    native: true,
    hidden: false,
    skill_mountable: true,
    skill_tool_available: true,
  },
]

const baseSkills = [
  {
    name: "opencorvus-plan",
    description: "Project planning workflow loaded from .opencorvus.",
    location: `${DIRECTORY}/.opencorvus/skills/opencorvus-plan/SKILL.md`,
    source_type: "config_path",
    source: `${DIRECTORY}/.opencorvus/skills/opencorvus-plan`,
    mounted_agents: ["requirements"],
    unmounted: false,
  },
  {
    name: "claude-debug",
    description: "Skill kept in the bottom pool until mounted.",
    location: `${DIRECTORY}/.claude/skills/claude-debug/SKILL.md`,
    source_type: "config_path",
    source: `${DIRECTORY}/.claude/skills/claude-debug`,
    mounted_agents: [],
    unmounted: true,
    warning: "unmounted",
  },
]

function skillMountMatrix(mountedDebug = false) {
  return {
    scope: "project",
    active_profile: "frontend-replica",
    capability_profile_id: "frontend-replica",
    projection_hash: "projection-vertical-tabs",
    projected_tool_ids: projectedToolIDs(
      "select_expert_squad",
      "skill",
      FRONTEND_REPLICA_ORCHESTRATOR_AUDIT_TOOL_ID,
      DEFAULT_BROWSER_SNAPSHOT_TOOL_ID,
      DEFAULT_READ_CONTEXT_TOOL_ID,
      FRONTEND_REPLICA_REQUIREMENTS_TRACE_TOOL_ID,
      FRONTEND_REPLICA_BUILD_PATCH_TOOL_ID,
      FRONTEND_REPLICA_BUILD_COMPARE_REGION_TOOL_ID,
      "bash",
      "apply_patch",
      DEFAULT_BROWSER_PREVIEW_TOOL_ID,
    ),
    projected_agents: ["orchestrator", "requirements", "build", "visual-qa"],
    selector_skill_names: ["frontend-replica-expert-squad"],
    production_skill_names: ["frontend-replica-build"],
    projected_skill_names: ["frontend-replica-expert-squad", "frontend-replica-build"],
    skills: baseSkills.map((skill) =>
      skill.name === "claude-debug" && mountedDebug
        ? { ...skill, mounted_agents: ["build"], unmounted: false, warning: undefined }
        : skill,
    ),
    agents,
    matrix: [
      {
        agent: "requirements",
        mounted: [
          {
            name: "opencorvus-plan",
            description: "Project planning workflow loaded from .opencorvus.",
            location: `${DIRECTORY}/.opencorvus/skills/opencorvus-plan/SKILL.md`,
            enabled: true,
          },
        ],
      },
      {
        agent: "build",
        mounted: mountedDebug
          ? [
              {
                name: "claude-debug",
                description: "Skill kept in the bottom pool until mounted.",
                location: `${DIRECTORY}/.claude/skills/claude-debug/SKILL.md`,
                enabled: true,
              },
            ]
          : [],
      },
      {
        agent: "visual-qa",
        mounted: [],
      },
    ],
    unmounted_count: mountedDebug ? 0 : 1,
    project_mounts: { agents: mountedDebug ? { build: ["claude-debug"] } : {} },
  }
}

test("left Tool, Skill, and MCP panels use vertical agent tabs and dynamic expert-squad projections", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requests: Array<{ method: string; path: string; search: string; body?: unknown }> = []
  let mountedDebug = false
  const catalog = projectedExpertSquadCatalog()

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requests.push({ method: req.method, path, search: url.search })

    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse

    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/global/projects/discover") return send([])
    if (path === "/session") return send([])
    if (path === "/mission") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: DIRECTORY })
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
    if (path === "/expert-squad/catalog") return send(catalog)
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "frontend-replica" } })
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/task/events") return eventStream()
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/skill" || path === "/skill/installed" || path === "/skill/market") return send(baseSkills)
    if (path === "/skill/directories") {
      return send({
        global_config: "D:/overlay/global/.opencorvus",
        managed_skills: "D:/overlay/global/.opencorvus/skills-market",
        remote_cache: "D:/overlay/global/.opencorvus/skill-cache",
      })
    }
    if (path === "/skill/mounts") return send(skillMountMatrix(mountedDebug))
    if (path === "/skill/mount" && req.method === "POST") {
      const body = await req.json()
      requests[requests.length - 1]!.body = body
      if ((body as any).agent === "build" && (body as any).skill === "claude-debug") mountedDebug = true
      return send(skillMountMatrix(mountedDebug))
    }
    if (path === "/skill/unmount" && req.method === "POST") {
      const body = await req.json()
      requests[requests.length - 1]!.body = body
      if ((body as any).agent === "build" && (body as any).skill === "claude-debug") mountedDebug = false
      return send(skillMountMatrix(mountedDebug))
    }
    if (path === "/mcp") {
      return send({
        browser: { status: "connected" },
        "frontend-replica": { status: "connected" },
      })
    }
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const diagnostics = installBrowserErrorCollector(page)
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument((serverUrl: string) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
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
    await waitForLeftActivity(page, "extensions", diagnostics)
    const extensionButton = '[data-ui="side-activity-button"][data-side="left"][data-activity="extensions"]'
    const extensionPanel = "#leftPanelExtensions"
    const toolPanel = `${extensionPanel} [data-mode="tool"]`
    const skillPanel = `${extensionPanel} [data-mode="skill"]`
    const mcpPanel = `${extensionPanel} [data-mode="mcp"]`
    const openExtensionMode = async (mode: "tool" | "skill" | "mcp", panelSelector: string) => {
      await page.click(extensionButton)
      await page.waitForSelector(`${extensionPanel}[data-active="true"]`)
      await page.click(`${extensionPanel} .extension-activity-tabs [data-value="${mode}"]`)
      await page.waitForSelector(`${panelSelector}[data-active="true"]`)
    }

    await openExtensionMode("tool", toolPanel)
    await page.waitForSelector(`${toolPanel}[data-active="true"] [data-ui="tool-agent-capability-tabs"]`)
    await page.waitForFunction(() =>
      document
        .querySelector('#leftPanelExtensions [data-mode="tool"]')
        ?.textContent?.includes("frontend-replica/build/patch"),
    )
    const toolCollapsedLayout = await compactCapabilityLayoutState(page, toolPanel, "tool-agent-capability-tabs")
    assert.deepEqual(toolCollapsedLayout.selectedAgents, [])
    assert.equal(toolCollapsedLayout.display, "flex")
    assert.equal(toolCollapsedLayout.flexDirection, "column")
    assert.equal(toolCollapsedLayout.gridTemplateColumns, "none")
    assert.equal(toolCollapsedLayout.bodyOverflowY, "auto")
    assert.equal(toolCollapsedLayout.vertical, true)
    await page.click(`${toolPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="tool"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "true",
    )
    const toolExpandedLayout = await compactCapabilityLayoutState(page, toolPanel, "tool-agent-capability-tabs")
    assert.deepEqual(toolExpandedLayout.selectedAgents, ["build"])
    assert.equal(toolExpandedLayout.vertical, true)
    await page.click(`${toolPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="tool"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "false",
    )
    assert.deepEqual(
      (await compactCapabilityLayoutState(page, toolPanel, "tool-agent-capability-tabs")).selectedAgents,
      [],
    )
    await page.click(`${toolPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="tool"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "true",
    )
    const toolSummary = await page.$eval(toolPanel, (node: HTMLElement) => ({
      text: node.textContent || "",
      tabCount: node.querySelectorAll(".agent-capability-tab").length,
      fakeMountButtons: Array.from(node.querySelectorAll("button")).filter((button) =>
        /add|mount/i.test(button.getAttribute("aria-label") || ""),
      ).length,
    }))
    assert.match(toolSummary.text, /Projected Tool Pool/)
    assert.match(toolSummary.text, /frontend-replica\/build\/patch/)
    assert.equal(toolSummary.tabCount >= 4, true)
    assert.equal(toolSummary.fakeMountButtons, 0)
    const toolScreenshot = await saveElementScreenshot(page, extensionPanel, "left-tool-panel.png")

    await openExtensionMode("skill", skillPanel)
    await page.waitForSelector(`${skillPanel}[data-active="true"] [data-ui="agent-skill-tabs"]`)
    await page.waitForSelector(`${skillPanel} [data-ui="agent-skill-pool"]`)
    const skillCollapsedLayout = await compactCapabilityLayoutState(page, skillPanel, "agent-skill-tabs")
    assert.deepEqual(skillCollapsedLayout.selectedAgents, [])
    assert.equal(skillCollapsedLayout.display, "flex")
    assert.equal(skillCollapsedLayout.flexDirection, "column")
    assert.equal(skillCollapsedLayout.gridTemplateColumns, "none")
    assert.equal(skillCollapsedLayout.bodyOverflowY, "auto")
    assert.equal(skillCollapsedLayout.vertical, true)
    const widthBeforeResize = await sidebarWidth(page)
    await page.focus("#leftPaneResizer")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await page.waitForFunction(
      (previousWidth: number) =>
        Math.round(document.querySelector<HTMLElement>("#sidebar")!.getBoundingClientRect().width) > previousWidth,
      widthBeforeResize,
    )
    const widthAfterResize = await sidebarWidth(page)
    assert.equal(widthAfterResize > widthBeforeResize, true)
    await page.click(`${skillPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="skill"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "true",
    )
    const skillExpandedLayout = await compactCapabilityLayoutState(page, skillPanel, "agent-skill-tabs")
    assert.deepEqual(skillExpandedLayout.selectedAgents, ["build"])
    assert.equal(skillExpandedLayout.vertical, true)
    await page.click(`${skillPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="skill"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "false",
    )
    assert.deepEqual((await compactCapabilityLayoutState(page, skillPanel, "agent-skill-tabs")).selectedAgents, [])
    await page.click(`${skillPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="skill"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "true",
    )
    await page.click(`${skillPanel} .agent-skill-pool-row[data-skill-name="claude-debug"]`, { button: "right" })
    await page.waitForSelector(`${skillPanel} .agent-mounted-skill-row`)
    const skillSummary = await page.$eval(skillPanel, (node: HTMLElement) => ({
      view: node.querySelector(".agent-skill-matrix")?.getAttribute("data-view"),
      tabCount: node.querySelectorAll('[data-ui="agent-skill-tabs"] .agent-capability-tab').length,
      poolRows: node.querySelectorAll("[data-ui='agent-skill-pool'] .agent-skill-pool-row").length,
      mountedNames: Array.from(node.querySelectorAll(".agent-mounted-skill-row strong")).map(
        (item) => item.textContent?.trim() || "",
      ),
    }))
    assert.equal(skillSummary.view, "agent-tabs")
    assert.equal(skillSummary.tabCount, 3)
    assert.equal(skillSummary.poolRows, 2)
    assert.deepEqual(skillSummary.mountedNames, ["claude-debug"])
    const skillScreenshot = await saveElementScreenshot(page, extensionPanel, "left-skill-panel.png")

    await openExtensionMode("mcp", mcpPanel)
    await page.waitForSelector(`${mcpPanel}[data-active="true"] [data-ui="mcp-agent-capability-tabs"]`)
    await page.waitForFunction(() =>
      document
        .querySelector('#leftPanelExtensions [data-mode="mcp"]')
        ?.textContent?.includes("frontend-replica/build/browser/tool/compare-region"),
    )
    const mcpCollapsedLayout = await compactCapabilityLayoutState(page, mcpPanel, "mcp-agent-capability-tabs")
    assert.deepEqual(mcpCollapsedLayout.selectedAgents, [])
    assert.equal(mcpCollapsedLayout.display, "flex")
    assert.equal(mcpCollapsedLayout.flexDirection, "column")
    assert.equal(mcpCollapsedLayout.gridTemplateColumns, "none")
    assert.equal(mcpCollapsedLayout.bodyOverflowY, "auto")
    assert.equal(mcpCollapsedLayout.vertical, true)
    await page.click(`${mcpPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="mcp"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "true",
    )
    const mcpExpandedLayout = await compactCapabilityLayoutState(page, mcpPanel, "mcp-agent-capability-tabs")
    assert.deepEqual(mcpExpandedLayout.selectedAgents, ["build"])
    assert.equal(mcpExpandedLayout.vertical, true)
    await page.click(`${mcpPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="mcp"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "false",
    )
    assert.deepEqual((await compactCapabilityLayoutState(page, mcpPanel, "mcp-agent-capability-tabs")).selectedAgents, [])
    await page.click(`${mcpPanel} .agent-capability-tab[data-agent-name="build"]`)
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelExtensions [data-mode="mcp"] .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "true",
    )
    const mcpSummary = await page.$eval(mcpPanel, (node: HTMLElement) => ({
      text: node.textContent || "",
      tabCount: node.querySelectorAll('[data-ui="mcp-agent-capability-tabs"] .agent-capability-tab').length,
      fakeMountButtons: Array.from(node.querySelectorAll("button")).filter((button) =>
        /mount|agent/i.test(button.getAttribute("aria-label") || ""),
      ).length,
    }))
    assert.match(mcpSummary.text, /Projected MCP Pool/)
    assert.match(mcpSummary.text, /frontend-replica\/build\/browser\/tool\/compare-region/)
    assert.match(mcpSummary.text, /Configured MCP Status/)
    assert.equal(mcpSummary.tabCount >= 4, true)
    assert.equal(mcpSummary.fakeMountButtons, 0)
    const mcpScreenshot = await saveElementScreenshot(page, extensionPanel, "left-mcp-panel.png")

    const mountRequest = requests.find((request) => request.path === "/skill/mount")
    assert.deepEqual(mountRequest?.body, { agent: "build", skill: "claude-debug" })
    assert.match(mountRequest?.search || "", /directory=D%3A%2Foverlay%2Fworkspace%2Fapp/)
    assert.equal(requests.some((request) => request.path === "/config/prompt-profile"), false)
    assert.ok(toolScreenshot.endsWith("left-tool-panel.png"))
    assert.ok(skillScreenshot.endsWith("left-skill-panel.png"))
    assert.ok(mcpScreenshot.endsWith("left-mcp-panel.png"))
    diagnostics.assertNoUnexpectedErrors()
  } finally {
    await browser.close()
    await server.close()
  }
})
