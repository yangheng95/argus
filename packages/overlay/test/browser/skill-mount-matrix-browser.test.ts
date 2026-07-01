import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
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

async function saveElementScreenshot(page: any, selector: string, filename: string) {
  const root = fileURLToPath(new URL("../../../../.scratch/", import.meta.url))
  const target = `${root}${filename}`
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const image = await element.screenshot({})
  await writeFile(target, image)
  return target
}

test("agent skill mount matrix renders pool warnings and agent rows without compact overflow", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const skills = [
    {
      name: "opencorvus-plan",
      description: "Project planning workflow loaded from .opencorvus.",
      location: "D:/overlay/workspace/app/.opencorvus/skills/opencorvus-plan/SKILL.md",
      source_type: "config_path",
      source: "D:/overlay/workspace/app/.opencorvus/skills/opencorvus-plan",
      mounted_agents: ["requirements", "architect"],
      unmounted: false,
    },
    {
      name: "claude-debug",
      description: "Claude compatibility skill kept in the pool until mounted.",
      location: "D:/overlay/workspace/app/.claude/skills/claude-debug/SKILL.md",
      source_type: "config_path",
      source: "D:/overlay/workspace/app/.claude/skills/claude-debug",
      mounted_agents: [],
      unmounted: true,
      warning: "unmounted",
    },
    {
      name: "agents-legacy",
      description: "Legacy .agents skill must stay visible as an unmounted pool row.",
      location: "D:/overlay/workspace/app/.agents/skills/agents-legacy/SKILL.md",
      source_type: "config_path",
      source: "D:/overlay/workspace/app/.agents/skills/agents-legacy",
      mounted_agents: [],
      unmounted: true,
      warning: "unmounted",
    },
    {
      name: "codex-review",
      description: "Codex review skill mounted but disabled by server evidence.",
      location: "D:/overlay/workspace/app/.codex/skills/codex-review/SKILL.md",
      source_type: "config_path",
      source: "D:/overlay/workspace/app/.codex/skills/codex-review",
      mounted_agents: ["build"],
      unmounted: false,
      policy: "deny",
    },
  ]
  const refreshedSkill = {
    name: "fresh-manual-skill",
    description: "Skill added on disk and surfaced by the manual refresh request.",
    location: "D:/overlay/workspace/app/.opencorvus/skill/fresh-manual-skill/SKILL.md",
    source_type: "config_path",
    source: "D:/overlay/workspace/app/.opencorvus/skill/fresh-manual-skill",
    mounted_agents: [],
    unmounted: true,
    warning: "unmounted",
  }
  const visibleAgents = [
    {
      name: "coding-assistant",
      description: "Coding assistant",
      mode: "primary",
      hidden: false,
      native: true,
      skill_mountable: true,
      skill_tool_available: true,
    },
    {
      name: "requirements",
      description: "Requirements agent",
      mode: "primary",
      hidden: false,
      native: true,
      skill_mountable: true,
      skill_tool_available: true,
    },
    {
      name: "architect",
      description: "Architecture agent",
      mode: "subagent",
      hidden: false,
      native: true,
      skill_mountable: true,
      skill_tool_available: true,
    },
    {
      name: "build",
      description: "Build agent",
      mode: "subagent",
      hidden: false,
      native: true,
      skill_mountable: true,
      skill_tool_available: true,
    },
    {
      name: "frontend-research",
      description: "Frontend research agent",
      mode: "subagent",
      hidden: false,
      native: true,
      skill_mountable: true,
      skill_tool_available: true,
    },
    {
      name: "visual-qa",
      description: "Visual quality agent",
      mode: "subagent",
      hidden: false,
      native: true,
      skill_mountable: true,
      skill_tool_available: true,
    },
    {
      name: "content",
      description: "Content agent",
      mode: "subagent",
      hidden: false,
      native: true,
      skill_mountable: true,
      skill_tool_available: true,
    },
    {
      name: "summarizer",
      description: "Summarizer agent",
      mode: "subagent",
      hidden: false,
      native: true,
      skill_mountable: true,
      skill_tool_available: true,
    },
  ] as const
  const unavailableAgents = [
    {
      name: "mission",
      description: "Mission orchestrator",
      mode: "primary",
      hidden: true,
      native: true,
      skill_mountable: false,
      skill_tool_available: false,
    },
    {
      name: "orchestrator",
      description: "Orchestrator",
      mode: "primary",
      hidden: true,
      native: true,
      skill_mountable: false,
      skill_tool_available: true,
    },
  ] as const
  const baseMatrixRows = [
    { agent: "coding-assistant", mounted: [] },
    {
      agent: "requirements",
      mounted: [
        {
          name: "opencorvus-plan",
          description: "Project planning workflow loaded from .opencorvus.",
          location: "D:/overlay/workspace/app/.opencorvus/skills/opencorvus-plan/SKILL.md",
          enabled: true,
        },
      ],
    },
    {
      agent: "architect",
      mounted: [
        {
          name: "opencorvus-plan",
          description: "Project planning workflow loaded from .opencorvus.",
          location: "D:/overlay/workspace/app/.opencorvus/skills/opencorvus-plan/SKILL.md",
          enabled: true,
        },
      ],
    },
    {
      agent: "build",
      mounted: [
        {
          name: "codex-review",
          description: "Codex review skill mounted but disabled by server evidence.",
          location: "D:/overlay/workspace/app/.codex/skills/codex-review/SKILL.md",
          enabled: false,
          reason: "permission_denied",
        },
      ],
    },
    { agent: "frontend-research", mounted: [] },
    { agent: "visual-qa", mounted: [] },
    { agent: "content", mounted: [] },
    { agent: "summarizer", mounted: [] },
    { agent: "mission", mounted: [] },
    { agent: "orchestrator", mounted: [] },
  ]
  const mountMatrix = {
    scope: "project",
    skills,
    agents: [...visibleAgents, ...unavailableAgents],
    matrix: baseMatrixRows,
    project_mounts: {
      agents: {
        requirements: ["opencorvus-plan"],
        architect: ["opencorvus-plan"],
        build: ["codex-review"],
      },
    },
    unmounted_count: 2,
  }
  const expectedSourceDirectories = [".opencorvus", ".claude", ".agents", ".codex"]
  const requests: Array<{ method: string; path: string; query: Record<string, string> }> = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    const query = Object.fromEntries(url.searchParams.entries())
    requests.push({ method: req.method, path, query })

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
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile") {
      return send({
        active: "general",
        project_active: "general",
        session_active: null,
        default: "general",
        targets: [],
        profiles: [],
      })
    }
    if (path === "/config" && req.method === "GET") return send({ model: "opencorvus/gpt-5-nano" })
    if (path === "/config" && req.method === "PATCH") return send({ model: "opencorvus/gpt-5-nano" })
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/task/events") {
      return new Response(":\n\n", {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
      })
    }
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/mcp") return send({})
    if (path === "/skill/installed" || path === "/skill") return send(skills)
    if (path === "/skill/mounts") {
      if (query.refresh === "true") {
        return send({
          ...mountMatrix,
          skills: [...mountMatrix.skills, refreshedSkill],
          unmounted_count: mountMatrix.unmounted_count + 1,
        })
      }
      return send(mountMatrix)
    }
    if (path === "/skill/mount" && req.method === "POST") {
      const updatedSkills = mountMatrix.skills
        .map((skill) =>
          skill.name === "claude-debug"
            ? { ...skill, mounted_agents: ["requirements"], unmounted: false, warning: undefined }
            : skill,
        )
        .reverse()
      const updatedRows = mountMatrix.matrix.map((row) =>
        row.agent === "requirements"
          ? {
              ...row,
              mounted: [
                ...row.mounted,
                {
                  name: "claude-debug",
                  description: "Claude compatibility skill kept in the pool until mounted.",
                  location: "D:/overlay/workspace/app/.claude/skills/claude-debug/SKILL.md",
                  enabled: true,
                },
              ],
            }
          : row,
      )
      return send({ ...mountMatrix, skills: updatedSkills, matrix: updatedRows, unmounted_count: 1 })
    }
    if (path === "/skill/market") return send([])
    if (path === "/skill/directories") {
      return send({
        global_config: "D:/overlay/global/.opencorvus",
        managed_skills: "D:/overlay/global/.opencorvus/skills-market",
        remote_cache: "D:/overlay/global/.opencorvus/skill-cache",
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
    await page.setViewport({ width: 1024, height: 760 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "dark")
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
                theme: "dark",
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
    const hiddenSkillProjection = await page.$eval("#leftPanelSkills", (node: HTMLElement) => ({
      active: node.dataset.active || "",
      matrixGrids: node.querySelectorAll(".agent-skill-matrix-grid").length,
      matrixCells: node.querySelectorAll(".agent-skill-grid-cell").length,
      skillRows: node.querySelectorAll(".agent-skill-grid-skill").length,
      text: node.textContent?.trim() || "",
    }))
    assert.deepEqual(
      hiddenSkillProjection,
      { active: "false", matrixGrids: 0, matrixCells: 0, skillRows: 0, text: "" },
      "hidden compact Skills panel must not materialize the matrix DOM before it is opened",
    )
    const skillButton = '[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]'
    await page.waitForSelector(skillButton)
    await page.click(skillButton)
    await page.waitForSelector("#leftPanelSkills[data-active='true'] .agent-skill-matrix-grid")
    try {
      await page.waitForFunction(() => {
        const text = document.querySelector("#leftPanelSkills")?.textContent || ""
        return (
          text.includes("opencorvus-plan") &&
          text.includes("claude-debug") &&
          text.includes("agents-legacy") &&
          text.includes("permission_denied") &&
          text.includes("frontend-research")
        )
      })
    } catch (error) {
      const text = await page.$eval("#leftPanelSkills", (node: HTMLElement) => node.textContent || "")
      console.error("skill matrix panel text:", text)
      console.error("skill matrix requests:", requests)
      throw error
    }
    const badgeText = await page.$eval(`${skillButton} .side-activity-badge`, (node: HTMLElement) =>
      (node.textContent || "").trim(),
    )
    assert.equal(badgeText, "2")

    const screenshot = await saveElementScreenshot(page, "#leftPanelSkills", "skill-mount-matrix-panel.png")
    const layout = await page.$eval("#leftPanelSkills .agent-skill-matrix", (node: HTMLElement) => {
      const matrix = node.getBoundingClientRect()
      const grid = node.querySelector(".agent-skill-matrix-grid") as HTMLElement | null
      const sourceList = document.querySelector("#leftPanelSkills .extension-list") as HTMLElement | null
      const dropZone = document.querySelector("#leftPanelSkills .skill-drop-zone") as HTMLElement | null
      const measured = Array.from(
        node.querySelectorAll(".agent-skill-grid-skill, .agent-skill-grid-agent, .agent-skill-grid-cell"),
      ).map((item) => {
        const rect = (item as HTMLElement).getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          text: (item.textContent || "").trim(),
        }
      })
      const gridRect = grid?.getBoundingClientRect()
      const headers = Array.from(node.querySelectorAll(".agent-skill-grid-agent")).map((item) =>
        (item.textContent || "").trim(),
      )
      const rowNames = Array.from(node.querySelectorAll(".agent-skill-grid-skill__name")).map((item) =>
        (item.textContent || "").trim(),
      )
      const sourceBadges = Array.from(node.querySelectorAll(".agent-skill-grid-skill__source")).map((item) => {
        const badge = item as HTMLElement
        const style = getComputedStyle(badge)
        return {
          text: (badge.textContent || "").trim(),
          directory: badge.dataset.sourceDirectory || "",
          tone: badge.dataset.sourceTone || "",
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
        }
      })
      const corner = node.querySelector(".agent-skill-grid-corner") as HTMLElement | null
      const rowHeader = node.querySelector(".agent-skill-grid-skill") as HTMLElement | null
      const topHeader = node.querySelector(".agent-skill-grid-agent") as HTMLElement | null
      const compactRows = Array.from(node.querySelectorAll(".agent-skill-grid-skill")).map((item) =>
        (item as HTMLElement).getBoundingClientRect(),
      )
      const compactCells = Array.from(node.querySelectorAll(".agent-skill-grid-cell")).map((item) =>
        (item as HTMLElement).getBoundingClientRect(),
      )
      const compactHeaders = Array.from(node.querySelectorAll(".agent-skill-grid-agent")).map((item) =>
        (item as HTMLElement).getBoundingClientRect(),
      )
      const glyphOpacity = (selector: string) =>
        Array.from(node.querySelectorAll(`${selector} .agent-skill-grid-cell__glyph`)).map((item) =>
          getComputedStyle(item as HTMLElement).opacity,
        )
      return {
        matrix: { left: matrix.left, right: matrix.right, width: matrix.width },
        overflowX: (grid?.scrollWidth ?? 0) - (grid?.clientWidth ?? 0),
        gridWidth: gridRect?.width ?? 0,
        gridScrollWidth: grid?.scrollWidth ?? 0,
        gridClientWidth: grid?.clientWidth ?? 0,
        sourceListVisible: !!sourceList && sourceList.getBoundingClientRect().height > 0,
        dropZoneVisible: !!dropZone && dropZone.getBoundingClientRect().height > 0,
        headers,
        rowNames,
        skillRows: node.querySelectorAll(".agent-skill-grid-skill").length,
        agentHeaders: node.querySelectorAll(".agent-skill-grid-agent").length,
        sourceBadges,
        mountedCells: node.querySelectorAll('.agent-skill-grid-cell[data-state="mounted"]').length,
        conflictCells: node.querySelectorAll('.agent-skill-grid-cell[data-state="conflict"]').length,
        unavailableCells: node.querySelectorAll('.agent-skill-grid-cell[data-state="unavailable"]').length,
        cornerBackground: corner ? getComputedStyle(corner).backgroundColor : "",
        rowHeaderBackground: rowHeader ? getComputedStyle(rowHeader).backgroundColor : "",
        topHeaderBackground: topHeader ? getComputedStyle(topHeader).backgroundColor : "",
        cornerPosition: corner ? getComputedStyle(corner).position : "",
        rowHeaderPosition: rowHeader ? getComputedStyle(rowHeader).position : "",
        topHeaderPosition: topHeader ? getComputedStyle(topHeader).position : "",
        compactCellWidth: compactCells[0]?.width ?? 0,
        compactCellHeight: compactCells[0]?.height ?? 0,
        compactRowHeight: compactRows[0]?.height ?? 0,
        compactHeaderHeight: compactHeaders[0]?.height ?? 0,
        availableGlyphOpacities: glyphOpacity('.agent-skill-grid-cell[data-state="available"]'),
        mountedGlyphOpacities: glyphOpacity('.agent-skill-grid-cell[data-state="mounted"]'),
        conflictGlyphOpacities: glyphOpacity('.agent-skill-grid-cell[data-state="conflict"]'),
        measured,
      }
    })

    assert.equal(screenshot.endsWith("skill-mount-matrix-panel.png"), true)
    assert.ok(layout.gridWidth > 180, "matrix grid should have visible width")
    assert.ok(layout.gridScrollWidth > layout.gridClientWidth, "full agent names should use horizontal matrix scroll")
    assert.equal(layout.sourceListVisible, false, "compact skill matrix must not show the source management list")
    assert.equal(layout.dropZoneVisible, false, "compact skill matrix must not show the global drop zone")
    assert.equal(layout.skillRows, 4, "each skill should render once as a matrix row")
    assert.equal(layout.agentHeaders, visibleAgents.length, "only skill-mountable agents should render as columns")
    assert.deepEqual(layout.rowNames, ["opencorvus-plan", "claude-debug", "agents-legacy", "codex-review"])
    assert.deepEqual(
      layout.sourceBadges.map((badge) => badge.directory),
      expectedSourceDirectories,
      "source directory badges should follow skill row order",
    )
    assert.equal(new Set(layout.sourceBadges.map((badge) => badge.tone)).size, expectedSourceDirectories.length)
    assert.equal(
      new Set(layout.sourceBadges.map((badge) => badge.backgroundColor)).size,
      expectedSourceDirectories.length,
      `source directories should have distinct badge colors: ${JSON.stringify(layout.sourceBadges)}`,
    )
    assert.ok(layout.headers.includes("frontend-research"), "agent header should use the full agent name")
    assert.equal(layout.headers.includes("mission"), false, "agents without skill tool should not render as X columns")
    assert.equal(
      layout.headers.includes("orchestrator"),
      false,
      "orchestrator should not render as an unsettable column",
    )
    assert.equal(layout.mountedCells, 2, "enabled mounts should render as cell state")
    assert.equal(layout.conflictCells, 1, "disabled mounted skills should render as conflict cells")
    assert.equal(layout.unavailableCells, 0, "unavailable agent columns should be removed")
    assert.deepEqual(
      [...new Set(layout.availableGlyphOpacities)].sort(),
      ["0"],
      "compact available cells should hide add glyphs until hover or focus",
    )
    assert.deepEqual(
      [...new Set(layout.mountedGlyphOpacities)].sort(),
      ["1"],
      "compact mounted cells should keep check glyphs visible",
    )
    assert.deepEqual(
      [...new Set(layout.conflictGlyphOpacities)].sort(),
      ["1"],
      "compact conflict cells should keep warning glyphs visible",
    )
    assert.equal(layout.cornerPosition, "sticky")
    assert.equal(layout.rowHeaderPosition, "sticky")
    assert.equal(layout.topHeaderPosition, "sticky")
    assert.notEqual(layout.cornerBackground, "rgba(0, 0, 0, 0)")
    assert.notEqual(layout.rowHeaderBackground, "rgba(0, 0, 0, 0)")
    assert.notEqual(layout.topHeaderBackground, "rgba(0, 0, 0, 0)")
    assert.ok(layout.compactCellWidth <= 96, `compact mount cells should stay narrow: ${layout.compactCellWidth}`)
    assert.ok(layout.compactCellHeight <= 38, `compact mount cells should use dense rows: ${layout.compactCellHeight}`)
    assert.ok(layout.compactRowHeight <= 40, `compact skill rows should use dense rows: ${layout.compactRowHeight}`)
    assert.ok(layout.compactHeaderHeight <= 28, `compact agent headers should be short: ${layout.compactHeaderHeight}`)
    assert.ok(layout.measured.length >= 40, "grid rows and cells should render")
    for (const item of layout.measured) {
      assert.ok(item.width > 12 && item.height > 10, `${item.text} should have visible dimensions`)
      assert.ok(item.left >= layout.matrix.left - 1, `${item.text} should not overflow left`)
    }

    await page.click('#leftPanelSkills [aria-label="Mount skill: claude-debug -> requirements"]')
    await page.waitForFunction(() => {
      const names = Array.from(document.querySelectorAll("#leftPanelSkills .agent-skill-grid-skill__name")).map(
        (item) => (item.textContent || "").trim(),
      )
      const mounted = document.querySelector('#leftPanelSkills [aria-label="Unmount: claude-debug -> requirements"]')
      return mounted && names.join("|") === "opencorvus-plan|claude-debug|agents-legacy|codex-review"
    })

    await page.click('#leftPanelSkills[data-active="true"] [data-ui="tool-panel-action"][aria-label="Add Skill"]')
    await page.waitForSelector("#leftPanelSkills .config-inline-form")
    const compactForm = await page.$eval("#leftPanelSkills .config-inline-form", (node: HTMLElement) => {
      const actionButtonText = Array.from(node.querySelectorAll('[data-ui="skill-form-icon-action"]')).map((button) =>
        (button.textContent || "").trim(),
      )
      const browse = node.querySelector(
        '[data-ui="skill-form-icon-action"][aria-label="Browse Folder"]',
      ) as HTMLElement | null
      const input = browse?.closest(".field-input-group")?.querySelector(".field-input") as HTMLElement | null
      return {
        actionButtonText,
        input: input ? input.getBoundingClientRect().toJSON() : null,
        browse: browse ? browse.getBoundingClientRect().toJSON() : null,
      }
    })
    assert.deepEqual(compactForm.actionButtonText.filter(Boolean), [], "compact skill form actions should be icon-only")
    assert.ok(compactForm.browse && compactForm.browse.width > 12, "browse action should render as an icon button")
    assert.ok(compactForm.input, "source input should render")
    assert.ok(
      compactForm.browse.left >= compactForm.input.left + compactForm.input.width - 1 &&
        compactForm.browse.top < compactForm.input.bottom &&
        compactForm.browse.bottom > compactForm.input.top,
      "browse icon must stay inline with input",
    )

    await page.click('[data-menu-trigger="settings"]')
    await page.waitForSelector('[data-testid="titlebar-menu-settings"]')
    await page.click('[data-testid="titlebar-settings-skill"]')
    await page.waitForSelector('#configDialog [data-config-panel="skill"] .agent-skill-matrix-grid')
    const settingsDialogScreenshot = await saveElementScreenshot(
      page,
      "#configDialog .dialog-form",
      "skill-settings-dialog.png",
    )
    const settingsScreenshot = await saveElementScreenshot(
      page,
      '#configDialog [data-config-panel="skill"] .agent-skill-matrix',
      "skill-mount-matrix-settings-panel.png",
    )
    const settingsLayout = await page.$eval(
      '#configDialog [data-config-panel="skill"] .agent-skill-matrix',
      (node: HTMLElement) => {
        const grid = node.querySelector(".agent-skill-matrix-grid") as HTMLElement
        const corner = node.querySelector(".agent-skill-grid-corner") as HTMLElement
        const rowHeader = node.querySelector(".agent-skill-grid-skill") as HTMLElement
        const topHeader = node.querySelector(".agent-skill-grid-agent") as HTMLElement
        const headers = Array.from(node.querySelectorAll(".agent-skill-grid-agent")).map((item) =>
          (item.textContent || "").trim(),
        )
        const headerMetrics = Array.from(node.querySelectorAll(".agent-skill-grid-agent")).map((item) => {
          const header = item as HTMLElement
          const rect = header.getBoundingClientRect()
          return {
            text: (header.textContent || "").trim(),
            width: rect.width,
            height: rect.height,
            scrollWidth: header.scrollWidth,
            clientWidth: header.clientWidth,
            scrollHeight: header.scrollHeight,
            clientHeight: header.clientHeight,
          }
        })
        const rowMetrics = Array.from(node.querySelectorAll(".agent-skill-grid-skill")).map((item) => {
          const rect = (item as HTMLElement).getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        })
        const cellMetrics = Array.from(node.querySelectorAll(".agent-skill-grid-cell")).map((item) => {
          const rect = (item as HTMLElement).getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        })
        const rowNames = Array.from(node.querySelectorAll(".agent-skill-grid-skill__name")).map((item) =>
          (item.textContent || "").trim(),
        )
        const sourceBadges = Array.from(node.querySelectorAll(".agent-skill-grid-skill__source")).map((item) => {
          const badge = item as HTMLElement
          const style = getComputedStyle(badge)
          return {
            text: (badge.textContent || "").trim(),
            directory: badge.dataset.sourceDirectory || "",
            tone: badge.dataset.sourceTone || "",
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
          }
        })
        const firstCell = node.querySelector(".agent-skill-grid-cell") as HTMLElement
        const dialogForm = document.querySelector("#configDialog .dialog-form") as HTMLElement
        const configContent = document.querySelector("#configContent") as HTMLElement
        const gridStyle = getComputedStyle(grid)
        const gridRect = grid.getBoundingClientRect()
        const visibleHeaderCount = Array.from(node.querySelectorAll(".agent-skill-grid-agent")).filter((item) => {
          const rect = (item as HTMLElement).getBoundingClientRect()
          return rect.left >= gridRect.left && rect.right <= gridRect.right + 1
        }).length
        const glyphOpacity = (selector: string) =>
          Array.from(node.querySelectorAll(`${selector} .agent-skill-grid-cell__glyph`)).map((item) =>
            getComputedStyle(item as HTMLElement).opacity,
          )
        return {
          display: gridStyle.display,
          columns: gridStyle.gridTemplateColumns,
          height: gridRect.height,
          scrollWidth: grid.scrollWidth,
          clientWidth: grid.clientWidth,
          visibleHeaderCount,
          dialogScrollTop: dialogForm.scrollTop,
          configContentScrollTop: configContent.scrollTop,
          compact: node.dataset.compact,
          headers,
          headerMetrics,
          rowMetrics,
          cellMetrics,
          rowNames,
          sourceBadges,
          unavailableCells: node.querySelectorAll('.agent-skill-grid-cell[data-state="unavailable"]').length,
          availableGlyphOpacities: glyphOpacity('.agent-skill-grid-cell[data-state="available"]'),
          mountedGlyphOpacities: glyphOpacity('.agent-skill-grid-cell[data-state="mounted"]'),
          conflictGlyphOpacities: glyphOpacity('.agent-skill-grid-cell[data-state="conflict"]'),
          cornerBackground: getComputedStyle(corner).backgroundColor,
          rowHeaderBackground: getComputedStyle(rowHeader).backgroundColor,
          topHeaderBackground: getComputedStyle(topHeader).backgroundColor,
          cornerPosition: getComputedStyle(corner).position,
          rowHeaderPosition: getComputedStyle(rowHeader).position,
          topHeaderPosition: getComputedStyle(topHeader).position,
          firstCellWidth: firstCell.getBoundingClientRect().width,
          topHeaderWidth: topHeader.getBoundingClientRect().width,
          text: node.textContent || "",
        }
      },
    )
    assert.equal(settingsDialogScreenshot.endsWith("skill-settings-dialog.png"), true)
    assert.equal(settingsScreenshot.endsWith("skill-mount-matrix-settings-panel.png"), true)
    assert.equal(settingsLayout.compact, "false")
    assert.equal(settingsLayout.display, "grid")
    assert.ok(settingsLayout.height >= 200, "settings matrix must be visibly rendered above the skill registry")
    assert.ok(settingsLayout.columns.includes("px"), "settings matrix should receive explicit grid columns")
    assert.ok(
      settingsLayout.scrollWidth >= settingsLayout.clientWidth,
      "settings matrix should not underflow its viewport",
    )
    assert.ok(
      settingsLayout.scrollWidth / settingsLayout.clientWidth <= 1.8,
      `settings matrix should keep enough columns in the first viewport: ${JSON.stringify({
        scrollWidth: settingsLayout.scrollWidth,
        clientWidth: settingsLayout.clientWidth,
      })}`,
    )
    assert.ok(
      settingsLayout.visibleHeaderCount >= 4,
      `settings matrix should expose several agent columns before scrolling: ${settingsLayout.visibleHeaderCount}`,
    )
    assert.ok(
      settingsLayout.dialogScrollTop <= 1 && settingsLayout.configContentScrollTop <= 1,
      `settings skill tab should open at the top: ${JSON.stringify({
        dialogScrollTop: settingsLayout.dialogScrollTop,
        configContentScrollTop: settingsLayout.configContentScrollTop,
      })}`,
    )
    assert.ok(settingsLayout.headers.includes("frontend-research"), "settings matrix should show full agent names")
    assert.equal(settingsLayout.headers.includes("mission"), false)
    assert.equal(settingsLayout.headers.includes("orchestrator"), false)
    assert.equal(settingsLayout.text.includes("Unavailable"), false)
    assert.equal(settingsLayout.unavailableCells, 0)
    assert.deepEqual(
      [...new Set(settingsLayout.availableGlyphOpacities)].sort(),
      ["0"],
      "settings available cells should hide add glyphs until hover or focus",
    )
    assert.deepEqual(
      [...new Set(settingsLayout.mountedGlyphOpacities)].sort(),
      ["1"],
      "settings mounted cells should keep check glyphs visible",
    )
    assert.deepEqual(
      [...new Set(settingsLayout.conflictGlyphOpacities)].sort(),
      ["1"],
      "settings conflict cells should keep warning glyphs visible",
    )
    assert.deepEqual(settingsLayout.rowNames, ["opencorvus-plan", "claude-debug", "agents-legacy", "codex-review"])
    assert.deepEqual(
      settingsLayout.sourceBadges.map((badge) => badge.directory),
      expectedSourceDirectories,
      "settings source directory badges should follow skill row order",
    )
    assert.equal(new Set(settingsLayout.sourceBadges.map((badge) => badge.tone)).size, expectedSourceDirectories.length)
    assert.equal(
      new Set(settingsLayout.sourceBadges.map((badge) => badge.backgroundColor)).size,
      expectedSourceDirectories.length,
      `settings source directories should have distinct badge colors: ${JSON.stringify(settingsLayout.sourceBadges)}`,
    )
    assert.equal(settingsLayout.cornerPosition, "sticky")
    assert.equal(settingsLayout.rowHeaderPosition, "sticky")
    assert.equal(settingsLayout.topHeaderPosition, "sticky")
    assert.notEqual(settingsLayout.cornerBackground, "rgba(0, 0, 0, 0)")
    assert.notEqual(settingsLayout.rowHeaderBackground, "rgba(0, 0, 0, 0)")
    assert.notEqual(settingsLayout.topHeaderBackground, "rgba(0, 0, 0, 0)")
    assert.ok(settingsLayout.firstCellWidth >= 70, "settings matrix cells must not collapse into icon strips")
    assert.ok(
      settingsLayout.topHeaderWidth >= 76 && settingsLayout.topHeaderWidth <= 118,
      `agent headers should use dense readable tracks: ${JSON.stringify({
        width: settingsLayout.topHeaderWidth,
        columns: settingsLayout.columns,
        headers: settingsLayout.headers,
      })}`,
    )
    for (const row of settingsLayout.rowMetrics) {
      assert.ok(row.height <= 44, `settings skill rows should be dense: ${JSON.stringify(row)}`)
    }
    for (const cell of settingsLayout.cellMetrics) {
      assert.ok(cell.height <= 44, `settings mount cells should be dense: ${JSON.stringify(cell)}`)
      assert.ok(
        cell.width >= 76 && cell.width <= 118,
        `settings mount cells should stay readable: ${JSON.stringify(cell)}`,
      )
    }
    for (const header of settingsLayout.headerMetrics) {
      assert.ok(
        header.scrollWidth <= header.clientWidth + 1,
        `agent header should not clip full name: ${JSON.stringify(header)}`,
      )
      assert.ok(
        header.scrollHeight <= header.clientHeight + 1,
        `agent header should fit wrapped full name: ${JSON.stringify(header)}`,
      )
      assert.ok(header.height <= 38, `agent header should stay compact: ${JSON.stringify(header)}`)
    }

    const hoverAvailableCellSelector =
      '#configDialog [data-config-panel="skill"] [aria-label="Mount skill: agents-legacy -> requirements"]'
    const hoverAvailableCellBeforeHover = await page.$eval(hoverAvailableCellSelector, (cell: HTMLElement) => {
      const glyph = cell.querySelector(".agent-skill-grid-cell__glyph") as HTMLElement
      const rect = cell.getBoundingClientRect()
      return {
        ariaLabel: cell.getAttribute("aria-label") || "",
        glyphOpacity: getComputedStyle(glyph).opacity,
        height: rect.height,
        state: cell.dataset.state || "",
        width: rect.width,
      }
    })
    assert.equal(hoverAvailableCellBeforeHover.ariaLabel, "Mount skill: agents-legacy -> requirements")
    assert.equal(hoverAvailableCellBeforeHover.state, "available")
    assert.equal(hoverAvailableCellBeforeHover.glyphOpacity, "0")
    assert.ok(
      hoverAvailableCellBeforeHover.width >= 76 && hoverAvailableCellBeforeHover.height >= 24,
      `available mount target should keep a visible hit area: ${JSON.stringify(hoverAvailableCellBeforeHover)}`,
    )
    const waitForGlyphTransition = async () => {
      await page.evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 180)))
    }

    await page.hover(hoverAvailableCellSelector)
    await waitForGlyphTransition()
    const availableHoverState = await page.$eval(hoverAvailableCellSelector, (cell: HTMLElement) => {
      const glyph = cell.querySelector(".agent-skill-grid-cell__glyph") as HTMLElement
      return {
        activeCombo: cell.dataset.activeCombo || "",
        state: cell.dataset.state || "",
        glyphOpacity: getComputedStyle(glyph).opacity,
      }
    })
    assert.deepEqual(availableHoverState, {
      activeCombo: "true",
      state: "available",
      glyphOpacity: "1",
    })

    await page.mouse.move(0, 0)
    await waitForGlyphTransition()
    const availableAfterLeaveState = await page.$eval(hoverAvailableCellSelector, (cell: HTMLElement) => {
      const glyph = cell.querySelector(".agent-skill-grid-cell__glyph") as HTMLElement
      return {
        activeCombo: cell.dataset.activeCombo || "",
        state: cell.dataset.state || "",
        glyphOpacity: getComputedStyle(glyph).opacity,
      }
    })
    assert.notEqual(availableAfterLeaveState.activeCombo, "true")
    assert.equal(availableAfterLeaveState.state, "available")
    assert.ok(
      Number.parseFloat(availableAfterLeaveState.glyphOpacity) <= 0.01,
      `available glyph should hide after pointer leaves: ${JSON.stringify(availableAfterLeaveState)}`,
    )

    const focusAvailableCellSelector =
      '#configDialog [data-config-panel="skill"] [aria-label="Mount skill: opencorvus-plan -> coding-assistant"]'
    await page.focus(focusAvailableCellSelector)
    await waitForGlyphTransition()
    const availableFocusState = await page.$eval(focusAvailableCellSelector, (cell: HTMLElement) => {
      const glyph = cell.querySelector(".agent-skill-grid-cell__glyph") as HTMLElement
      return {
        activeCombo: cell.dataset.activeCombo || "",
        state: cell.dataset.state || "",
        glyphOpacity: getComputedStyle(glyph).opacity,
      }
    })
    assert.deepEqual(availableFocusState, {
      activeCombo: "true",
      state: "available",
      glyphOpacity: "1",
    })

    const hoverCellSelector =
      '#configDialog [data-config-panel="skill"] [aria-label="codex-review -> build: permission_denied"]'
    await page.hover(hoverCellSelector)
    await page.waitForFunction(() => {
      const matrix = document.querySelector('#configDialog [data-config-panel="skill"] .agent-skill-matrix')
      return (
        matrix?.querySelectorAll('.agent-skill-grid-agent[data-active-combo="true"]').length === 1 &&
        matrix?.querySelectorAll('.agent-skill-grid-skill[data-active-combo="true"]').length === 1 &&
        matrix?.querySelectorAll('.agent-skill-grid-cell[data-active-combo="true"]').length === 1
      )
    })
    const hoverScreenshot = await saveElementScreenshot(
      page,
      "#configDialog .dialog-form",
      "skill-settings-dialog-hover.png",
    )
    const hoverState = await page.$eval(
      '#configDialog [data-config-panel="skill"] .agent-skill-matrix',
      (node: HTMLElement) => {
        const activeAgent = node.querySelector('.agent-skill-grid-agent[data-active-combo="true"]') as HTMLElement
        const activeSkill = node.querySelector('.agent-skill-grid-skill[data-active-combo="true"]') as HTMLElement
        const activeCell = node.querySelector('.agent-skill-grid-cell[data-active-combo="true"]') as HTMLElement
        return {
          activeAgents: Array.from(node.querySelectorAll('.agent-skill-grid-agent[data-active-combo="true"]')).map(
            (item) => (item.textContent || "").trim(),
          ),
          activeSkills: Array.from(
            node.querySelectorAll('.agent-skill-grid-skill[data-active-combo="true"] .agent-skill-grid-skill__name'),
          ).map((item) => (item.textContent || "").trim()),
          activeCells: Array.from(node.querySelectorAll('.agent-skill-grid-cell[data-active-combo="true"]')).map(
            (item) => (item.getAttribute("aria-label") || "").trim(),
          ),
          agentBackground: getComputedStyle(activeAgent).backgroundColor,
          skillBackground: getComputedStyle(activeSkill).backgroundColor,
          cellBoxShadow: getComputedStyle(activeCell).boxShadow,
        }
      },
    )
    assert.equal(hoverScreenshot.endsWith("skill-settings-dialog-hover.png"), true)
    assert.deepEqual(hoverState.activeAgents, ["build"])
    assert.deepEqual(hoverState.activeSkills, ["codex-review"])
    assert.deepEqual(hoverState.activeCells, ["codex-review -> build: permission_denied"])
    assert.notEqual(hoverState.agentBackground, settingsLayout.topHeaderBackground)
    assert.notEqual(hoverState.skillBackground, settingsLayout.rowHeaderBackground)
    assert.notEqual(hoverState.cellBoxShadow, "none")

    const requestsBeforeManualRefresh = requests.length
    await page.click('#configDialog [data-config-panel="skill"] [data-ui="tool-panel-action"][aria-label="Reload"]')
    await page.waitForFunction(() => {
      const text = document.querySelector('#configDialog [data-config-panel="skill"]')?.textContent || ""
      return text.includes("fresh-manual-skill")
    })
    const manualRefreshRequest = requests
      .slice(requestsBeforeManualRefresh)
      .find((item) => item.path === "/skill/mounts" && item.query.refresh === "true")
    assert.ok(
      manualRefreshRequest,
      `manual skill reload must request cache invalidation: ${JSON.stringify(
        requests.slice(requestsBeforeManualRefresh),
      )}`,
    )

    await page.click("#btnCloseConfigDialog")
    await page.waitForSelector("#configDialog", { visible: false })
    const compactRefreshRequestSeen = new Promise<void>((resolve) => {
      page.on("response", (response: any) => {
        const url = new URL(response.url())
        if (url.pathname === "/skill/mounts" && url.searchParams.get("refresh") === "true") resolve()
      })
    })
    const requestsBeforeCompactRefresh = requests.length
    await page.click('#leftPanelSkills [data-ui="tool-panel-action"][aria-label="Reload"]')
    await compactRefreshRequestSeen
    const compactRefreshRequest = requests
      .slice(requestsBeforeCompactRefresh)
      .find((item) => item.path === "/skill/mounts" && item.query.refresh === "true")
    assert.ok(
      compactRefreshRequest,
      `compact skill reload must request cache invalidation: ${JSON.stringify(
        requests.slice(requestsBeforeCompactRefresh),
      )}`,
    )
  } finally {
    await browser.close()
    await server.close()
  }
})
