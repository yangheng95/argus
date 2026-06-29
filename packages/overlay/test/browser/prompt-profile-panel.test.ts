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

test("prompt profiles are visible, built-ins stay read-only, and custom saves only patch prompt_profile", async () => {
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
      {
        id: "custom-squad",
        label: "Custom Squad",
        description: "User-authored profile stored in config.prompt_profile.profiles.",
        built_in: false,
        editable: true,
        agents: {
          requirements: "Extract benchmark targets first.",
          build: "Prefer proof by tests and screenshots.",
        },
      },
    ],
  }

  function promptProfiles() {
    const promptProfileConfig = config.prompt_profile as
      | {
          active?: string
          profiles?: Record<string, { label: string; description?: string; agents?: Record<string, string> }>
        }
      | undefined
    const customProfiles = Object.entries(promptProfileConfig?.profiles ?? {}).map(([id, profile]) => ({
      id,
      label: profile.label,
      description: profile.description,
      built_in: false,
      editable: true,
      agents: profile.agents ?? {},
    }))
    const customIDs = new Set(customProfiles.map((profile) => profile.id))
    return {
      ...basePromptProfiles,
      active: promptProfileConfig?.active ?? basePromptProfiles.active,
      project_active: promptProfileConfig?.active ?? basePromptProfiles.project_active,
      profiles: [...basePromptProfiles.profiles.filter((profile) => !customIDs.has(profile.id)), ...customProfiles],
    }
  }

  const promptEntries = [
    {
      key: "build",
      label: "Build",
      group: "subagent",
      mode: "append",
      scope: "agent",
      description: "Editable user append after the active squad overlay.",
      prompt: "Existing user append for build.",
      editable_prompt: "Existing user append for build.",
      effective_prompt:
        "Core build prompt.\n\n[Frontend Replica profile]\nVerify with a real browser and screenshot review before closing the task.\n\n[User append]\nExisting user append for build.",
      active_profile: "frontend-replica",
      profile_prompt: "Verify with a real browser and screenshot review before closing the task.",
      configured_prompt: "Existing user append for build.",
      default_prompt: "Core build prompt.",
      prompt_mode: "append",
    },
  ]

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [] })
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
    if (path === "/config/prompt") return send(promptEntries)
    if (path === "/config/prompt-profile") return send(promptProfiles())
    if (path === "/config" && req.method === "GET") return send(config)
    if (path === "/config" && req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>
      patches.push(body)
      config = mergePatch(config, body) as Record<string, unknown>
      return send(config)
    }
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

    const builtInState = await page.evaluate(() => {
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
      const promptCards = document.querySelectorAll("[data-prompt-entry]").length
      const metadata = document.querySelectorAll('[data-ui="prompt-profile-metadata"]').length
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
      return { list, overview, readonly, editors, promptCards, metadata, actions, targetStates }
    })
    assert.deepEqual(builtInState.list, ["General", "Frontend Replica", "Frontend Automation Debug", "Custom Squad"])
    assert.match(builtInState.overview.scope, /Project config/)
    assert.match(builtInState.overview["project-active"], /Frontend Replica/)
    assert.match(builtInState.overview.selected, /Frontend Replica/)
    assert.match(builtInState.overview.selected, /3 agents/)
    assert.match(builtInState.overview.selected, /3 prompts/)
    assert.match(builtInState.readonly, /read-only/i)
    assert.equal(builtInState.editors, 0)
    assert.equal(builtInState.promptCards, 0)
    assert.equal(builtInState.metadata, 0)
    assert.deepEqual(
      builtInState.actions.map((action) => action.ui),
      ["prompt-profile-activate-project"],
    )
    assert.equal(builtInState.actions[0]?.disabled, true)
    assert.deepEqual(
      builtInState.targetStates.map((target) => ({
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
      builtInState.targetStates.every((target) => /Read-only/.test(target.text) && /Configured/.test(target.text)),
      true,
    )
    const promptBody = await page.$("#promptBody")
    assert.ok(promptBody)
    writeFileSync(resolve(".scratch/prompt-profile-settings-built-in.png"), await promptBody.screenshot({}))

    await page.click('[data-ui="prompt-profile-list"] .prompt-profile-list-row:last-child')
    await page.waitForFunction(() => {
      const title = document.querySelector('[data-ui="prompt-profile-detail"] .prompt-profile-detail-copy strong')
      return title?.textContent?.trim() === "Custom Squad"
    })
    await page.waitForFunction(() => document.querySelectorAll(".prompt-profile-textarea").length === 2)
    const customLayoutState = await page.evaluate(() => {
      const overview = Object.fromEntries(
        Array.from(document.querySelectorAll<HTMLElement>('[data-ui="prompt-profile-overview"] [data-kind]')).map(
          (node) => [node.dataset.kind || "", node.textContent?.replace(/\s+/g, " ").trim() || ""],
        ),
      )
      const actions = Array.from(
        document.querySelectorAll<HTMLElement>('[data-ui="prompt-profile-actions"] .oc-button'),
      ).map((node) => ({
        ui: node.dataset.ui || "",
        text: node.textContent?.replace(/\s+/g, " ").trim() || "",
        disabled: (node as HTMLButtonElement).disabled,
      }))
      const metadata = document.querySelector('[data-ui="prompt-profile-metadata"]')
      const targetStates = Array.from(document.querySelectorAll<HTMLElement>(".prompt-profile-target")).map((node) => ({
        target: node.querySelector(".prompt-profile-target-copy span")?.textContent?.trim() || "",
        editable: node.dataset.editable || "",
        hasOverlay: node.dataset.hasOverlay || "",
        text: node.textContent?.replace(/\s+/g, " ").trim() || "",
      }))
      return {
        overview,
        actionIDs: actions.map((action) => action.ui),
        projectActionDisabled: actions.find((action) => action.ui === "prompt-profile-activate-project")?.disabled,
        saveDisabled: actions.find((action) => action.ui === "prompt-profile-save")?.disabled,
        metadataText: metadata?.textContent?.replace(/\s+/g, " ").trim() || "",
        targetStates,
      }
    })
    assert.match(customLayoutState.overview.selected, /Custom Squad/)
    assert.match(customLayoutState.overview.selected, /2 agents/)
    assert.match(customLayoutState.overview.selected, /2 prompts/)
    assert.deepEqual(customLayoutState.actionIDs, [
      "prompt-profile-activate-project",
      "prompt-profile-delete",
      "prompt-profile-save",
    ])
    assert.equal(customLayoutState.projectActionDisabled, false)
    assert.equal(customLayoutState.saveDisabled, true)
    assert.match(customLayoutState.metadataText, /Squad Details/)
    assert.deepEqual(
      customLayoutState.targetStates.map((target) => ({
        target: target.target,
        editable: target.editable,
        hasOverlay: target.hasOverlay,
      })),
      [
        { target: "requirements", editable: "true", hasOverlay: "true" },
        { target: "build", editable: "true", hasOverlay: "true" },
      ],
    )
    assert.equal(
      customLayoutState.targetStates.every((target) => /Editable/.test(target.text) && /Configured/.test(target.text)),
      true,
    )
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
      labels: ["General", "Frontend Replica", "Frontend Automation Debug", "Custom Squad"],
      primitiveRows: 4,
      rowTags: ["BUTTON", "BUTTON", "BUTTON", "BUTTON"],
      legacyRows: 0,
      currentLabels: ["Custom Squad"],
      selectedLabel: "Custom Squad",
      selectedCurrent: "true",
      selectedAriaSelected: "",
      selectedAriaPressed: "",
    })
    await page.keyboard.press("Tab")
    await page.keyboard.press("Shift+Tab")
    await page.waitForFunction(() =>
      document.activeElement?.matches('[data-ui="prompt-profile-list"] .prompt-profile-list-row[data-active="true"]'),
    )
    const focusedProfileRow = await page.$eval(
      '[data-ui="prompt-profile-list"] .prompt-profile-list-row[data-active="true"]',
      (node: HTMLElement) => {
        const style = getComputedStyle(node)
        return {
          focused: document.activeElement === node,
          focusVisible: node.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        }
      },
    )
    assert.equal(focusedProfileRow.focused, true)
    assert.equal(focusedProfileRow.focusVisible, true)
    assert.notEqual(focusedProfileRow.outlineStyle, "none")
    assert.notEqual(focusedProfileRow.outlineWidth, "0px")
    const rowList = await page.$('[data-ui="prompt-profile-list"]')
    assert.ok(rowList)
    writeFileSync(resolve(".scratch/prompt-profile-list-row-focus.png"), await rowList.screenshot({}))

    const textareaLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLTextAreaElement>(".prompt-profile-textarea")).map((textarea) => {
        const target = textarea.closest<HTMLElement>(".prompt-profile-target")
        const label = target?.querySelector<HTMLElement>(".prompt-profile-target-copy strong")
        const labelledBy = textarea.getAttribute("aria-labelledby") || ""
        const labelledElement = labelledBy ? document.getElementById(labelledBy) : null
        return {
          labelID: label?.id || "",
          visibleLabel: label?.textContent?.trim() || "",
          labelledBy,
          accessibleNameSource: labelledElement?.textContent?.trim() || "",
          hiddenLabel: textarea.getAttribute("aria-label") || "",
          usesComposerTextarea: textarea.classList.contains("composer-textarea"),
          usesFieldInput: textarea.classList.contains("field-input"),
          overflowY: getComputedStyle(textarea).overflowY,
          scrollbarWidth: getComputedStyle(textarea).scrollbarWidth,
        }
      }),
    )
    assert.deepEqual(textareaLabels, [
      {
        labelID: "promptProfileTargetLabel-requirements",
        visibleLabel: "Requirements",
        labelledBy: "promptProfileTargetLabel-requirements",
        accessibleNameSource: "Requirements",
        hiddenLabel: "",
        usesComposerTextarea: true,
        usesFieldInput: false,
        overflowY: "auto",
        scrollbarWidth: "thin",
      },
      {
        labelID: "promptProfileTargetLabel-build",
        visibleLabel: "Build",
        labelledBy: "promptProfileTargetLabel-build",
        accessibleNameSource: "Build",
        hiddenLabel: "",
        usesComposerTextarea: true,
        usesFieldInput: false,
        overflowY: "auto",
        scrollbarWidth: "thin",
      },
    ])
    const textareaInitial = await page.$eval(".prompt-profile-textarea", (textarea: HTMLTextAreaElement) => {
      textarea.focus()
      return {
        active: document.activeElement === textarea,
        original: textarea.value,
        height: textarea.getBoundingClientRect().height,
        boxShadow: getComputedStyle(textarea).boxShadow,
      }
    })
    assert.equal(textareaInitial.active, true)
    assert.notEqual(textareaInitial.boxShadow, "none")
    await page.$eval(".prompt-profile-textarea", (textarea: HTMLTextAreaElement) => {
      textarea.value = Array.from({ length: 14 }, (_, index) => `requirements line ${index + 1}`).join("\n")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await page.waitForFunction(
      (height) => {
        const textarea = document.querySelector<HTMLTextAreaElement>(".prompt-profile-textarea")
        return !!textarea && textarea.getBoundingClientRect().height > height
      },
      {},
      textareaInitial.height,
    )
    await page.$eval(
      ".prompt-profile-textarea",
      (textarea: HTMLTextAreaElement, value) => {
        textarea.value = value
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
      },
      textareaInitial.original,
    )
    mkdirSync(resolve(".scratch"), { recursive: true })
    const screenshot = await page.screenshot({ fullPage: false })
    assert.ok(screenshot.length > 0)
    writeFileSync(resolve(".scratch/prompt-profile-textarea-labels.png"), screenshot)
    writeFileSync(resolve(".scratch/prompt-profile-settings-custom.png"), await promptBody.screenshot({}))

    await page.evaluate(() => {
      const input = document.querySelector(
        '.prompt-profile-detail .prompt-profile-field input[type="text"]',
      ) as HTMLInputElement
      input.value = "Custom Squad Revised"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await page.evaluate(() => {
      const targets = Array.from(document.querySelectorAll(".prompt-profile-target"))
      const buildTarget = targets.find(
        (node) => node.querySelector(".prompt-profile-target-copy span")?.textContent?.trim() === "build",
      )
      const area = buildTarget?.querySelector("textarea") as HTMLTextAreaElement | null
      if (!area) throw new Error("Missing build prompt-profile textarea")
      area.value = "Prefer proof by tests, screenshots, and explicit acceptance notes."
      area.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await page.click('[data-ui="prompt-profile-save"]')
    await page.waitForFunction(() =>
      document.querySelector(".config-status-box")?.textContent?.toLowerCase().includes("saved"),
    )

    const profilePatches = patches.filter((patch) => "prompt_profile" in patch)
    assert.equal(profilePatches.length, 1)
    assert.equal(
      profilePatches.every((patch) => !("agent" in patch)),
      true,
    )
    assert.deepEqual(profilePatches[0], {
      prompt_profile: {
        profiles: {
          "custom-squad": {
            label: "Custom Squad Revised",
            description: "User-authored profile stored in config.prompt_profile.profiles.",
            agents: {
              requirements: "Extract benchmark targets first.",
              build: "Prefer proof by tests, screenshots, and explicit acceptance notes.",
            },
          },
        },
      },
    })

    await page.evaluate(
      (content) => {
        const input = document.querySelector('[data-ui="prompt-profile-import-input"]') as HTMLInputElement | null
        if (!input) throw new Error("Missing prompt profile import input")
        const data = new DataTransfer()
        data.items.add(new File([content], "imported-squad.json", { type: "application/json" }))
        input.files = data.files
        input.dispatchEvent(new Event("change", { bubbles: true }))
      },
      JSON.stringify({
        prompt_profile: {
          active: "imported-squad",
          profiles: {
            "imported-squad": {
              label: "Imported Squad",
              description: "Imported expert overlays.",
              agents: {
                requirements: "Imported requirements guidance.",
                build: "Imported build guidance.",
              },
            },
          },
        },
      }),
    )
    await page.waitForSelector('[data-ui="prompt-profile-import-preview"]')
    const importPreview = await page.evaluate(() => {
      const preview = document.querySelector('[data-ui="prompt-profile-import-preview"]')
      return preview?.textContent || ""
    })
    assert.match(importPreview, /Imported Squad/)
    assert.match(importPreview, /requirements/)
    assert.match(importPreview, /Build/)
    await page.click('[data-ui="prompt-profile-import-preview"] .oc-button[data-variant="solid"]')
    await page.waitForFunction(() =>
      document.querySelector(".config-status-box")?.textContent?.toLowerCase().includes("imported"),
    )

    const importPatch = patches[patches.length - 1]
    assert.deepEqual(importPatch, {
      prompt_profile: {
        active: "imported-squad",
        profiles: {
          "imported-squad": {
            label: "Imported Squad",
            description: "Imported expert overlays.",
            agents: {
              requirements: "Imported requirements guidance.",
              build: "Imported build guidance.",
            },
          },
        },
      },
    })
    assert.equal("agent" in importPatch, false)
    assert.equal("prompt" in importPatch, false)
  } finally {
    await browser.close()
    await server.close()
  }
})
