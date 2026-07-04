import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector, type BrowserErrorCollector } from "./error-collector.ts"
import { emptyExpertSquadProjectionEntry, generalExpertSquadCatalog } from "./expert-squad-fixture.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const DIRECTORY = "D:/overlay/workspace/app"

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

function projection(overrides: Partial<ReturnType<typeof emptyExpertSquadProjectionEntry>>) {
  return { ...emptyExpertSquadProjectionEntry(), ...overrides }
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
        package_tool_refs: ["frontend-replica.scheduler.audit"],
        default_mcp_server_refs: ["project/browser"],
        package_mcp_prompt_refs: ["frontend-replica/selector"],
      }),
      agents: {
        requirements: projection({
          default_tool_refs: ["requirements.read_context"],
          package_tool_refs: ["frontend-replica.requirements.trace"],
          default_mcp_tool_refs: ["project/browser.snapshot"],
          package_mcp_resource_refs: ["frontend-replica/reference-dom"],
        }),
        build: projection({
          built_in_tool_ids: ["exec_command", "apply_patch"],
          package_tool_refs: ["frontend-replica.build.patch"],
          package_mcp_server_refs: ["frontend-replica/local-preview"],
          package_mcp_tool_refs: ["frontend-replica/compare-region"],
        }),
        "visual-qa": projection({
          default_tool_refs: ["visual_qa.inspect"],
          package_mcp_prompt_refs: ["frontend-replica/visual-guidance"],
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
      projected_tool_ids: ["select_expert_squad", "skill", "frontend-replica.build.patch"],
      projected_agent_ids: ["requirements", "build", "visual-qa"],
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
    projected_tool_ids: ["select_expert_squad", "frontend-replica.build.patch"],
    projected_agents: ["requirements", "build"],
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
    await waitForLeftActivity(page, "tool", diagnostics)

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tool"]')
    await page.waitForSelector('#leftPanelTools[data-active="true"] [data-ui="tool-agent-capability-tabs"]')
    await page.waitForFunction(() =>
      document.querySelector("#leftPanelTools")?.textContent?.includes("frontend-replica.build.patch"),
    )
    const toolSummary = await page.$eval("#leftPanelTools", (node: HTMLElement) => ({
      text: node.textContent || "",
      tabCount: node.querySelectorAll(".agent-capability-tab").length,
      fakeMountButtons: Array.from(node.querySelectorAll("button")).filter((button) =>
        /add|mount/i.test(button.getAttribute("aria-label") || ""),
      ).length,
    }))
    assert.match(toolSummary.text, /Projected Tool Pool/)
    assert.match(toolSummary.text, /frontend-replica\.build\.patch/)
    assert.equal(toolSummary.tabCount >= 4, true)
    assert.equal(toolSummary.fakeMountButtons, 0)
    const toolScreenshot = await saveElementScreenshot(page, "#leftPanelTools", "left-tool-panel.png")

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]')
    await page.waitForSelector('#leftPanelSkills[data-active="true"] [data-ui="agent-skill-tabs"]')
    await page.waitForSelector('#leftPanelSkills [data-ui="agent-skill-pool"]')
    await page.click('#leftPanelSkills .agent-capability-tab[data-agent-name="build"]')
    await page.waitForFunction(
      () =>
        document
          .querySelector('#leftPanelSkills .agent-capability-tab[data-agent-name="build"]')
          ?.getAttribute("aria-selected") === "true",
    )
    await page.click('#leftPanelSkills .agent-skill-pool-row[data-skill-name="claude-debug"]', { button: "right" })
    await page.waitForSelector("#leftPanelSkills .agent-mounted-skill-row")
    const skillSummary = await page.$eval("#leftPanelSkills", (node: HTMLElement) => ({
      view: node.querySelector(".agent-skill-matrix")?.getAttribute("data-view"),
      tabCount: node.querySelectorAll('[data-ui="agent-skill-tabs"] .agent-capability-tab').length,
      poolRows: node.querySelectorAll("[data-ui='agent-skill-pool'] .agent-skill-pool-row").length,
      mountedNames: Array.from(node.querySelectorAll(".agent-mounted-skill-row strong")).map(
        (item) => item.textContent?.trim() || "",
      ),
    }))
    assert.equal(skillSummary.view, "agent-tabs")
    assert.equal(skillSummary.tabCount, 2)
    assert.equal(skillSummary.poolRows, 2)
    assert.deepEqual(skillSummary.mountedNames, ["claude-debug"])
    const skillScreenshot = await saveElementScreenshot(page, "#leftPanelSkills", "left-skill-panel.png")

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]')
    await page.waitForSelector('#leftPanelMcp[data-active="true"] [data-ui="mcp-agent-capability-tabs"]')
    await page.waitForFunction(() =>
      document.querySelector("#leftPanelMcp")?.textContent?.includes("frontend-replica/compare-region"),
    )
    const mcpSummary = await page.$eval("#leftPanelMcp", (node: HTMLElement) => ({
      text: node.textContent || "",
      tabCount: node.querySelectorAll('[data-ui="mcp-agent-capability-tabs"] .agent-capability-tab').length,
      fakeMountButtons: Array.from(node.querySelectorAll("button")).filter((button) =>
        /mount|agent/i.test(button.getAttribute("aria-label") || ""),
      ).length,
    }))
    assert.match(mcpSummary.text, /Projected MCP Pool/)
    assert.match(mcpSummary.text, /frontend-replica\/compare-region/)
    assert.match(mcpSummary.text, /Configured MCP Status/)
    assert.equal(mcpSummary.tabCount >= 4, true)
    assert.equal(mcpSummary.fakeMountButtons, 0)
    const mcpScreenshot = await saveElementScreenshot(page, "#leftPanelMcp", "left-mcp-panel.png")

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
