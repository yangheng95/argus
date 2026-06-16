import assert from "node:assert/strict"
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
    prompt_profile: { active: "frontend" },
  }
  const patches: Record<string, unknown>[] = []

  const promptProfiles = {
    active: "frontend",
    project_active: "frontend",
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
        id: "frontend",
        label: "Frontend",
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
        "Core build prompt.\n\n[Frontend profile]\nVerify with a real browser and screenshot review before closing the task.\n\n[User append]\nExisting user append for build.",
      active_profile: "frontend",
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
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
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
    if (path === "/config/prompt-profile") return send(promptProfiles)
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
    await page.waitForSelector('[data-menu-trigger="tools"]')
    await page.click('[data-menu-trigger="tools"]')
    await page.waitForSelector("#titlebar-menu-tools")
    await page.click('#titlebar-menu-tools .titlebar-menubar-item:nth-of-type(3)')
    await page.waitForSelector('[data-config-panel="prompt"] [data-ui="prompt-profile-panel"]')

    const builtInState = await page.evaluate(() => {
      const list = Array.from(document.querySelectorAll('[data-ui="prompt-profile-list"] .prompt-profile-list-item')).map((node) =>
        node.querySelector("strong")?.textContent?.trim() || "",
      )
      const readonly = document.querySelector(".prompt-profile-readonly-note")?.textContent?.trim() || ""
      const editors = document.querySelectorAll(".prompt-profile-textarea").length
      return { list, readonly, editors }
    })
    assert.deepEqual(builtInState.list, ["General", "Frontend", "Custom Squad"])
    assert.match(builtInState.readonly, /read-only/i)
    assert.equal(builtInState.editors, 0)

    await page.click('[data-ui="prompt-profile-list"] .prompt-profile-list-item:last-child')
    await page.waitForFunction(() => {
      const title = document.querySelector('[data-ui="prompt-profile-detail"] .prompt-profile-detail-copy strong')
      return title?.textContent?.trim() === "Custom Squad"
    })
    await page.waitForFunction(() => document.querySelectorAll(".prompt-profile-textarea").length === 2)

    await page.evaluate(() => {
      const input = document.querySelector('.prompt-profile-detail .prompt-profile-field input[type="text"]') as HTMLInputElement
      input.value = "Custom Squad Revised"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await page.evaluate(() => {
      const targets = Array.from(document.querySelectorAll(".prompt-profile-target"))
      const buildTarget = targets.find((node) =>
        node.querySelector(".prompt-profile-target-copy span")?.textContent?.trim() === "build",
      )
      const area = buildTarget?.querySelector("textarea") as HTMLTextAreaElement | null
      if (!area) throw new Error("Missing build prompt-profile textarea")
      area.value = "Prefer proof by tests, screenshots, and explicit acceptance notes."
      area.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await page.click('.prompt-profile-detail-actions .oc-button[data-variant="solid"]:last-child')
    await page.waitForFunction(() =>
      document.querySelector(".config-status-box")?.textContent?.toLowerCase().includes("saved"),
    )

    const profilePatches = patches.filter((patch) => "prompt_profile" in patch)
    assert.equal(profilePatches.length, 1)
    assert.equal(profilePatches.every((patch) => !("agent" in patch)), true)
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
  } finally {
    await browser.close()
    await server.close()
  }
})
