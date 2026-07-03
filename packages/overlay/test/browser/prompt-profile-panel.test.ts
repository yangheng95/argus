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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch
  const base = isRecord(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key]
      continue
    }
    base[key] = mergePatch(base[key], value)
  }
  return base
}

test("prompt profiles are package-backed read-only entries and activation patches active only", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  let config: Record<string, unknown> = {
    model: "opencorvus/gpt-5-nano",
    prompt_profile: { active: "frontend-replica" },
  }
  const patches: Record<string, unknown>[] = []

  const basePromptProfiles = {
    active: "frontend-replica",
    project_active: "frontend-replica",
    session_active: null,
    default: "general",
    targets: [
      {
        id: "requirements",
        label: "Requirements",
        description: "Scope, constraints, and acceptance detail.",
        editable: true,
        built_in_only: false,
      },
      {
        id: "build",
        label: "Build",
        description: "Implementation bias and verification discipline.",
        editable: true,
        built_in_only: false,
      },
      {
        id: "orchestrator",
        label: "Orchestrator",
        description: "Built-in workflow emphasis.",
        editable: false,
        built_in_only: true,
      },
    ],
    profiles: [
      {
        id: "general",
        label: "General",
        description: "Baseline prompt set with no scenario overlay.",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "frontend-replica",
        label: "Frontend Replica",
        description: "Bias toward visual evidence, layout fidelity, and real UI review.",
        built_in: true,
        editable: false,
        agents: {
          requirements: "Prioritize information architecture, states, responsive rules, and visible acceptance.",
          build: "Verify with a real browser and screenshot review before closing the task.",
          orchestrator: "Drive the workflow through visual evidence and final UI acceptance.",
        },
      },
      {
        id: "frontend-innovate",
        label: "Frontend Innovate",
        description: "Bias toward product-grade design synthesis, alternatives, and anti-slop review.",
        built_in: true,
        editable: false,
        agents: {
          requirements: "Capture product design outcomes, states, accessibility, and anti-slop criteria.",
          build: "Implement the selected product design direction and verify the rendered experience.",
          orchestrator: "Drive resource-backed design synthesis through implementation and review.",
        },
      },
      {
        id: "backend",
        label: "Backend",
        description: "Bias toward backend contracts, persistence, and route verification.",
        built_in: true,
        editable: false,
        agents: {
          build: "Change backend behavior with focused route, schema, and persistence tests.",
        },
      },
      {
        id: "algorithm",
        label: "Algorithm",
        description: "Bias toward algorithmic correctness and measurable edge cases.",
        built_in: true,
        editable: false,
        agents: {
          build: "Prove algorithm behavior with representative positive and negative cases.",
        },
      },
      {
        id: "frontend-automation-debug",
        label: "Frontend Automation Debug",
        description: "Bias toward reproducible verification, regression coverage, and acceptance evidence.",
        built_in: true,
        editable: false,
        agents: {
          requirements: "State behavior under test, fixtures, assertions, and negative cases.",
          build: "Add or update focused tests and report the commands that prove the behavior.",
          orchestrator: "Accept only evidence that can be rerun against the behavior under review.",
        },
      },
    ],
  }

  function promptProfiles() {
    const promptProfileConfig = config.prompt_profile as { active?: string } | undefined
    const active = promptProfileConfig?.active ?? basePromptProfiles.active
    return {
      ...basePromptProfiles,
      active,
      project_active: active,
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
    if (path === "/config/prompt-profile") return send(promptProfiles())
    if (path === "/config" && req.method === "GET") return send(config)
    if (path === "/config" && req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>
      patches.push(body)
      config = mergePatch(config, body) as Record<string, unknown>
      return send(config)
    }
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/task/events")
      return new Response(":\n\n", {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
      })
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
    await page.waitForSelector("#titlebar-menu-settings")
    await page.click('[data-testid="titlebar-settings-prompt"]')
    await page.waitForSelector('[data-config-panel="prompt"] [data-ui="prompt-profile-panel"]')

    const initialState = await page.evaluate(() => {
      const list = Array.from(
        document.querySelectorAll('[data-ui="prompt-profile-list"] .prompt-profile-list-row'),
      ).map((node) => node.querySelector("strong")?.textContent?.trim() || "")
      const overview = Object.fromEntries(
        Array.from(document.querySelectorAll<HTMLElement>('[data-ui="prompt-profile-overview"] [data-kind]')).map(
          (node) => [node.dataset.kind || "", node.textContent?.replace(/\s+/g, " ").trim() || ""],
        ),
      )
      const readonly = document.querySelector(".prompt-profile-readonly-note")?.textContent?.trim() || ""
      const editors = document.querySelectorAll(".prompt-profile-textarea").length
      const metadata = document.querySelectorAll('[data-ui="prompt-profile-metadata"]').length
      const importInputs = document.querySelectorAll('[data-ui="prompt-profile-import-input"]').length
      const saveButtons = document.querySelectorAll('[data-ui="prompt-profile-save"]').length
      const deleteButtons = document.querySelectorAll('[data-ui="prompt-profile-delete"]').length
      const actions = Array.from(
        document.querySelectorAll<HTMLElement>('[data-ui="prompt-profile-actions"] .oc-button'),
      ).map((node) => ({
        ui: node.dataset.ui || "",
        text: node.textContent?.replace(/\s+/g, " ").trim() || "",
        disabled: (node as HTMLButtonElement).disabled,
      }))
      const targetStates = Array.from(document.querySelectorAll<HTMLElement>(".prompt-profile-target")).map((node) => ({
        target: node.querySelector(".prompt-profile-target-copy span")?.textContent?.trim() || "",
        editable: node.dataset.editable || "",
        hasOverlay: node.dataset.hasOverlay || "",
        text: node.textContent?.replace(/\s+/g, " ").trim() || "",
      }))
      return { list, overview, readonly, editors, metadata, importInputs, saveButtons, deleteButtons, actions, targetStates }
    })

    assert.deepEqual(initialState.list, [
      "General",
      "Frontend Replica",
      "Frontend Innovate",
      "Backend",
      "Algorithm",
      "Frontend Automation Debug",
    ])
    assert.match(initialState.overview.scope, /Project config/)
    assert.match(initialState.overview["project-active"], /Frontend Replica/)
    assert.match(initialState.overview.selected, /Frontend Replica/)
    assert.match(initialState.overview.selected, /3 agents/)
    assert.match(initialState.overview.selected, /3 prompts/)
    assert.match(initialState.readonly, /read-only/i)
    assert.equal(initialState.editors, 0)
    assert.equal(initialState.metadata, 0)
    assert.equal(initialState.importInputs, 0)
    assert.equal(initialState.saveButtons, 0)
    assert.equal(initialState.deleteButtons, 0)
    assert.deepEqual(initialState.actions.map((action) => action.ui), ["prompt-profile-activate-project"])
    assert.equal(initialState.actions[0]?.disabled, true)
    assert.deepEqual(
      initialState.targetStates.map((target) => ({
        target: target.target,
        editable: target.editable,
        hasOverlay: target.hasOverlay,
      })),
      [
        { target: "requirements", editable: "false", hasOverlay: "true" },
        { target: "build", editable: "false", hasOverlay: "true" },
        { target: "orchestrator", editable: "false", hasOverlay: "true" },
      ],
    )
    assert.equal(
      initialState.targetStates.every((target) => /Read-only/.test(target.text) && /Configured/.test(target.text)),
      true,
    )

    mkdirSync(resolve(".scratch"), { recursive: true })
    const promptBody = await page.$("#promptBody")
    assert.ok(promptBody)
    writeFileSync(resolve(".scratch/prompt-profile-settings-readonly.png"), await promptBody.screenshot({}))

    await page.click('[data-ui="prompt-profile-list"] .prompt-profile-list-row:nth-child(3)')
    await page.waitForFunction(() => {
      const title = document.querySelector('[data-ui="prompt-profile-detail"] .prompt-profile-detail-copy strong')
      return title?.textContent?.trim() === "Frontend Innovate"
    })
    await page.click('[data-ui="prompt-profile-activate-project"]')
    await page.waitForFunction(() =>
      document.querySelector(".config-status-box")?.textContent?.toLowerCase().includes("updated"),
    )

    const profilePatches = patches.filter((patch) => "prompt_profile" in patch)
    assert.deepEqual(profilePatches, [{ prompt_profile: { active: "frontend-innovate" } }])
    assert.equal(profilePatches.every((patch) => !("agent" in patch)), true)
    assert.equal(profilePatches.every((patch) => !("prompt" in patch)), true)
    assert.equal("profiles" in ((profilePatches[0]!.prompt_profile as Record<string, unknown>) || {}), false)

    const selectedProfileListItem = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('[data-ui="prompt-profile-list"] .prompt-profile-list-row'),
      )
      const selected = rows.find((row) => row.dataset.active === "true")
      return {
        labels: rows.map((row) => row.querySelector("strong")?.textContent?.trim() || ""),
        primitiveRows: rows.filter((row) => row.classList.contains("s-row")).length,
        rowTags: rows.map((row) => row.tagName),
        legacyRows: document.querySelectorAll('[data-ui="prompt-profile-list"] .prompt-profile-list-item').length,
        currentLabels: rows
          .filter((row) => row.getAttribute("aria-current") === "true")
          .map((row) => row.querySelector("strong")?.textContent?.trim() || ""),
        selectedLabel: selected?.querySelector("strong")?.textContent?.trim() || "",
        selectedCurrent: selected?.getAttribute("aria-current") || "",
        selectedAriaSelected: selected?.getAttribute("aria-selected") || "",
        selectedAriaPressed: selected?.getAttribute("aria-pressed") || "",
      }
    })
    assert.deepEqual(selectedProfileListItem, {
      labels: ["General", "Frontend Replica", "Frontend Innovate", "Backend", "Algorithm", "Frontend Automation Debug"],
      primitiveRows: 6,
      rowTags: ["BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON"],
      legacyRows: 0,
      currentLabels: ["Frontend Innovate"],
      selectedLabel: "Frontend Innovate",
      selectedCurrent: "true",
      selectedAriaSelected: "",
      selectedAriaPressed: "",
    })

    const focusedProfileRow = await page.$eval(
      '[data-ui="prompt-profile-list"] .prompt-profile-list-row[data-active="true"]',
      (node: HTMLElement) => {
        node.focus()
        return {
          focused: document.activeElement === node,
        }
      },
    )
    assert.equal(focusedProfileRow.focused, true)
    const rowList = await page.$('[data-ui="prompt-profile-list"]')
    assert.ok(rowList)
    writeFileSync(resolve(".scratch/prompt-profile-list-row-focus.png"), await rowList.screenshot({}))
  } finally {
    await browser.close()
    await server.close()
  }
})
