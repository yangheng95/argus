import assert from "node:assert/strict"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

test(
  "overlay controls trigger without runtime failures",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const now = Date.now()
    const task = {
      id: "task-1",
      directory: "D:/overlay/workspace/app",
      status: "running",
      sessionID: "session-1",
      budget: {
        maxExecutorGroups: 3,
      },
      time: {
        created: now - 90_000,
        started: now - 80_000,
        updated: now - 1_000,
      },
      metadata: {
        checks: {
          ui_review: { target: "web", enabled: true },
          spec_check: { enabled: true },
        },
      },
    }
    const data = {
      config: {
        model: "openai/gpt-4o-mini",
        provider: {
          openai: {
            options: {
              apiKey: "sk-test-openai",
            },
          },
        },
        channel: {
          slack: {
            token: "xoxb-test",
            signing_secret: "secret-1",
            enabled: true,
          },
        },
        server: {
          publicUrl: "https://overlay.example.com",
        },
        mcp: {
          docs: {
            type: "remote",
            url: "https://mcp.example.com",
            enabled: true,
          },
        },
      },
      provider: {
        all: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-3-7-sonnet": {},
              "claude-3-5-haiku": {},
            },
            env: ["ANTHROPIC_API_KEY"],
          },
          {
            id: "openai",
            name: "OpenAI",
            models: {
              "gpt-4.1": {},
              "gpt-4o-mini": {},
            },
            env: ["OPENAI_API_KEY"],
          },
        ],
        connected: ["openai"],
        default: {
          anthropic: "claude-3-7-sonnet",
          openai: "gpt-4o-mini",
        },
      },
      providerAuth: {
        anthropic: ["api_key"],
        openai: [],
      },
      channels: [
        {
          id: "slack",
          name: "Slack",
          summary: "Configured for alerts",
          status: "configured",
          fields: [
            { key: "token", label: "Bot Token", type: "secret", placeholder: "xoxb-..." },
            { key: "signing_secret", label: "Signing Secret", type: "secret", placeholder: "secret" },
            { key: "enabled", label: "Enabled", type: "boolean" },
          ],
        },
        {
          id: "discord",
          name: "Discord",
          summary: "Setup required",
          status: "missing",
          fields: [{ key: "token", label: "Bot Token", type: "secret", placeholder: "token" }],
        },
      ],
      executors: [
        { id: "codex", label: "Codex", detail: "Connected", version: "1.0.0", selectable: true, discovered: true },
        {
          id: "opencorvus",
          label: "OpenCorvus",
          detail: "Bundled",
          version: "0.0.1-alpha",
          selectable: true,
          discovered: true,
        },
        {
          id: "claude-code",
          label: "Claude Code",
          detail: "Connected",
          version: "1.0.0",
          selectable: true,
          discovered: true,
        },
      ],
      tasks: {
        tasks: [{ task, updated_at: now - 1_000 }],
      },
      board: {
        snapshotVersion: "controls-board-1",
        lastSequence: 0,
        task,
        run: {
          executor: "opencorvus",
          phase: "execute",
        },
        overview: {
          headline: "### Overlay task headline",
          summary: "Overlay summary with **markdown**.",
          nextStep: {
            title: "Review UI controls",
            detail: "Validate that every visible control can still trigger.",
          },
          controls: {
            canRetry: true,
            canReplan: true,
            canCancel: true,
          },
        },
        plan: {
          version: 2,
          status: "ready",
          summary: "1. Validate title bar\n2. Validate dialogs\n3. Validate task controls",
          prompt: "Create a plan for overlay control validation.",
          metadata: {
            owner: "overlay-test",
          },
          time: {
            created: now - 70_000,
          },
        },
        spec: {
          content: "The overlay must keep all visible controls responsive.",
          time: {
            created: now - 75_000,
          },
        },
        requirements: [
          {
            id: "req_de4c67cdd001PpknO1pkL1fZOS",
            description:
              "Support a readable requirements panel without crushing Chinese or English descriptions into a narrow column.",
            type: "explicit",
            priority: "blocking",
            status: "pending",
          },
          {
            id: "req_de4c67cdf002Q7thvTKLWEBIcP",
            description: "Use IndexedDB for calendar history and attachments.",
            type: "inferred",
            priority: "advisory",
            status: "pending",
          },
        ],
        architect: {
          summary: "7 architect decisions across 2 categories",
          contractCount: 7,
          categories: ["shared_type", "directory_blueprint"],
          decisions: Array.from({ length: 7 }, (_, index) => ({
            key: index % 2 === 0 ? "shared_type" : "directory_blueprint",
            value:
              index === 6
                ? "Seventh decision remains visible instead of being hidden behind a truncated architect card."
                : index === 0
                  ? "Conversation records use **one persisted schema** for messages, attachments, and `streaming cursors`."
                  : "Conversation records use one persisted schema for messages, attachments, and streaming cursors.",
            reason:
              index === 6
                ? "Large decision logs still need inspectable value and reason text."
                : index === 0
                  ? "- Keeps resume and export flows from inventing incompatible message shapes."
                  : "Keeps resume and export flows from inventing incompatible message shapes.",
            goalID: index === 0 ? null : `goal-${index}`,
          })),
        },
        lanes: [
          {
            id: "goals",
            cards: [
              {
                id: "goal-1",
                title: "Verify the overlay controls",
                detail: "Every control opens, closes, saves, or triggers as expected.",
                status: "pending",
                metadata: {
                  origin: "test",
                  priority: "high",
                },
              },
            ],
          },
        ],
        evaluation: {
          verdict: "pending",
          status: "running",
          summary: "Evaluation is still running.",
          time: {
            completed: now - 2_000,
          },
          checks: [
            {
              name: "ui_review",
              label: "UI Review",
              family: "review",
              status: "failed",
              evidence: "The current run is intentionally seeded with one failed review.",
            },
            {
              name: "spec_check",
              label: "Spec Check",
              family: "acceptance",
              status: "passed",
              evidence: "The seeded spec matches the overlay run.",
            },
          ],
        },
        acceptance: {
          status: "candidate",
          summary: "Candidate acceptance is ready for review.",
          result: {
            summary: "One file changed.",
            changedFiles: ["src/app.js"],
            diffs: [
              {
                file: "src/app.js",
                before: "const value = 1\n",
                after: "const value = 2\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          },
        },
        interactions: [
          {
            id: "interaction-1",
            type: "permission",
            status: "pending",
            title: "Approve tool usage",
            body: "Allow the overlay action to continue.",
            time: { created: now - 5_000 },
          },
        ],
      },
      path: {
        directory: "D:/overlay/workspace/app",
      },
      vcs: {
        branch: "",
        clean: false,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      },
      sessions: [
        {
          id: "session-1",
          title: "Task session",
          directory: "D:/overlay/workspace/app",
          time: { updated: now - 500 },
        },
        {
          id: "session-2",
          title: "Review backlog",
          directory: "D:/overlay/review",
          time: { updated: now - 4_000 },
        },
      ],
      session: {
        "session-1": {
          id: "session-1",
          title: "Task session",
          directory: "D:/overlay/workspace/app",
          time: { updated: now - 500 },
        },
        "session-2": {
          id: "session-2",
          title: "Review backlog",
          directory: "D:/overlay/review",
          time: { updated: now - 4_000 },
        },
      },
      panelSettings: {
        "session-1": {},
        "session-2": {},
      },
      timeline: {
        task: {
          "task-1": [
            {
              parts: [{ type: "text", text: "Please validate the overlay." }],
              info: { role: "user", time: { created: now - 20_000 } },
            },
            {
              parts: [{ type: "text", text: "I am validating the overlay controls now." }],
              info: { role: "assistant", time: { created: now - 19_000 } },
            },
          ],
        },
        session: {
          "session-1": [
            {
              parts: [{ type: "text", text: "Task session note" }],
              info: { role: "assistant", time: { created: now - 15_000 } },
            },
          ],
          "session-2": [
            {
              parts: [{ type: "text", text: "Independent session note" }],
              info: { role: "assistant", time: { created: now - 10_000 } },
            },
          ],
        },
      },
      diffs: {
        "session-1": [
          {
            file: "src/app.js",
            before: "const value = 1\n",
            after: "const value = 2\n",
            additions: 1,
            deletions: 1,
            status: "modified",
          },
        ],
        "session-2": [
          {
            file: "notes.md",
            before: "",
            after: "# Review\n",
            additions: 1,
            deletions: 0,
            status: "added",
          },
        ],
      },
      skills: [
        {
          name: "alpha-skill",
          description: "Initial test skill",
          location: "D:/skills/alpha",
          builtin: false,
          source: "D:/skills/alpha",
          source_type: "config_path",
        },
      ],
      skillMarket: [
        {
          id: "market-install",
          name: "market-install",
          provider: "OpenAI",
          trust: "verified",
          install_kind: "url",
          source: "https://market.example.com/.well-known/skills/",
          recommended_policy: "ask",
          description: "Installable skill entry",
          notes: "Recommended",
          homepage: "https://market.example.com/install",
        },
        {
          id: "market-homepage",
          name: "market-homepage",
          provider: "OpenAI",
          trust: "community",
          install_kind: "manual",
          source: "",
          recommended_policy: "allow",
          description: "Homepage only entry",
          notes: "",
          homepage: "https://market.example.com/manual",
        },
      ],
      mcp: {
        docs: {
          status: "connected",
        },
      },
      memory: [
        {
          id: "mem-1",
          title: "Overlay note",
          scope: "global",
          source: "seed",
          score: 0.92,
          snippet: "Remember to validate every overlay button.",
          timeUpdated: now - 2_500,
        },
      ],
      memoryDetail: {
        "mem-1": {
          file: {
            id: "mem-1",
            title: "Overlay note",
            scope: "global",
            source: "seed",
            timeCreated: now - 5_000,
            timeUpdated: now - 2_500,
          },
          content: "Remember to validate every overlay button and dialog.",
        },
      },
      preference: [
        {
          id: "pref-1",
          key: "tone",
          value: "concise",
          scope: "global",
          source: "seed",
        },
      ],
      logs: [
        "INFO  2026-03-10T10:00:00 +1ms service=server overlay ready",
        "WARN  2026-03-10T10:00:01 +2ms service=server seeded warning",
      ],
      counters: {
        restart: 0,
        nextSession: 3,
        nextGoal: 2,
        nextPreference: 2,
        taskMessage: 0,
      },
    }
    const route = (url: URL) => url.pathname.replace(/\/+$/, "") || "/"
    const projectDir = (url: URL) => url.searchParams.get("directory") || data.path.directory
    const sameDir = (value: string | undefined, url: URL) => !value || value === projectDir(url)
    const send = (value: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(value), {
        ...init,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...(init?.headers || {}),
        },
      })
    const text = (value: string, init?: ResponseInit) =>
      new Response(value, {
        ...init,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...(init?.headers || {}),
        },
      })
    const append = async (body: Record<string, unknown>) => {
      const ts = Date.now()
      const msg = String(body.text || "").trim()
      const taskID = body.taskID ? String(body.taskID) : ""
      const user = {
        parts: [{ type: "text", text: msg }],
        info: { role: "user", time: { created: ts } },
      }
      const assistant = {
        parts: [{ type: "text", text: `Handled: ${msg}` }],
        info: { role: "assistant", time: { created: ts + 1 } },
      }
      if (taskID) {
        data.timeline.task[taskID] = [...(data.timeline.task[taskID] || []), user, assistant]
        data.counters.taskMessage += 1
      }
      if (msg.startsWith("/goal ")) {
        const detail = msg.includes("\nCriteria:") ? msg.split("\nCriteria:")[1]?.trim() || "" : ""
        data.board.lanes[0].cards.push({
          id: `goal-${data.counters.nextGoal++}`,
          title: msg
            .replace(/^\/goal\s+/, "")
            .split("\nCriteria:")[0]
            .trim(),
          detail,
          status: "pending",
          metadata: { origin: "panel", priority: "medium" },
        })
      }
      if (msg.startsWith("Update goal ")) {
        const meta =
          body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {}
        const id = String(meta.goalID || "")
        const card = data.board.lanes[0].cards.find((item) => item.id === id)
        if (card) {
          card.title = String(meta.description || card.title)
          card.detail = String(meta.criteria || card.detail || "")
        }
      }
      if (msg.startsWith("Delete goal ")) {
        const id = msg.replace("Delete goal ", "").replace(/\.$/, "").trim()
        data.board.lanes[0].cards = data.board.lanes[0].cards.filter((item) => item.id !== id)
      }
      return {
        ok: true,
        task_id: taskID || "task-1",
        message: "done",
      }
    }
    const promptValue = (value: unknown) => (typeof value === "string" ? value : null)
    const prompts = () => {
      const core = promptValue(data.config.prompt?.core_header)
      const explore = promptValue(data.config.agent?.explore?.prompt)
      return [
        {
          key: "core_header",
          scope: "system",
          group: "core",
          label: "Core Header",
          description: "Shared task header prompt.",
          prompt: core ?? "# Core Header\n\nDefault core prompt.",
          configured_prompt: core,
          default_prompt: "# Core Header\n\nDefault core prompt.",
          mode: "all",
          native: true,
          hidden: false,
          inherits_core: false,
        },
        {
          key: "explore",
          scope: "agent",
          group: "subagent",
          label: "Explore",
          description: "Research and inspection subagent.",
          prompt: explore ?? "Inspect the codebase before acting.",
          configured_prompt: explore,
          default_prompt: "Inspect the codebase before acting.",
          mode: "subagent",
          native: true,
          hidden: false,
          inherits_core: false,
        },
        {
          key: "build",
          scope: "agent",
          group: "primary_agent",
          label: "Build",
          description: "Primary build agent.",
          prompt: "",
          configured_prompt: null,
          default_prompt: null,
          mode: "primary",
          native: true,
          hidden: false,
          inherits_core: true,
        },
      ]
    }
    const requests: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requests.push(`${req.method} ${url.pathname}${url.search}`)
        if (path === "/favicon.ico" || path === "/ui/favicon.ico") {
          return new Response(null, { status: 204 })
        }
        if (path === "/ui" || path === "/ui/") {
          return Response.redirect(`${url.origin}/ui/index.html`, 302)
        }
        const staticResponse = await overlayStaticResponse(path)
        if (staticResponse) return staticResponse
        if (path === "/global/health") return send({ version: "1.2.3" })
        if (path === "/tasks") {
          return send({
            ...data.tasks,
            tasks: data.tasks.tasks.filter((item) => sameDir(item?.task?.directory, url)),
          })
        }
        if (path === "/global/tasks") return send(data.tasks)
        if (path === "/executor") return send(data.executors)
        if (path === "/terminal/profiles") return send({ profiles: [] })
        if (path === "/coding/cli/profiles") return send({ profiles: [] })
        if (path === "/project/current/worktrees") return send([])
        if (path === "/path") return send({ ...data.path, directory: projectDir(url) })
        if (path === "/vcs") return send(data.vcs)
        if (path === "/provider") return send(data.provider)
        if (path === "/provider/auth") return send(data.providerAuth)
        if (path === "/agent") return send([])
        if (path === "/config/providers") {
          return send({
            providers: data.provider.all.map((item) => ({
              id: item.id,
              name: item.name || item.id,
              models: item.models || {},
            })),
            default: data.provider.default || {},
          })
        }
        if (path.startsWith("/provider/") && path.endsWith("/test")) {
          return send({ ok: true, message: "Provider connected" })
        }
        if (path === "/config/prompt") return send(prompts())
        if (path === "/config" && req.method === "GET") return send(data.config)
        if (path === "/config" && req.method === "PATCH") {
          data.config = await req.json()
          return send(data.config)
        }
        if (path === "/channel") return send(data.channels)
        if (path === "/skill/installed" || path === "/skill") return send(data.skills)
        if (path === "/skill/directories") return send(["D:/skills"])
        if (path === "/skill/market") return send(data.skillMarket)
        if (path === "/skill/install") {
          const body = await req.json()
          const value = String(body.value || body.source || "installed-skill")
          const name = value.split("/").filter(Boolean).at(-1) || "installed-skill"
          data.skills.push({
            name,
            description: `Installed from ${body.kind}`,
            location: value,
            builtin: false,
            source: value,
            source_type: body.kind === "git" ? "managed_git" : body.kind === "url" ? "config_url" : "config_path",
          })
          return send({ ok: true })
        }
        if (path === "/skill/remove") {
          const body = await req.json()
          const source = String(body.source || "")
          data.skills = data.skills.filter((item) => item.source !== source)
          return send({ ok: true })
        }
        if (path === "/mcp" && req.method === "GET") return send(data.mcp)
        if (path === "/mcp" && req.method === "POST") {
          const body = await req.json()
          data.mcp[String(body.name)] = { status: "connected" }
          return send({ ok: true })
        }
        if (path.startsWith("/mcp/") && path.endsWith("/disconnect")) {
          const name = decodeURIComponent(path.slice(5, -11))
          delete data.mcp[name]
          return send({ ok: true })
        }
        if (path.startsWith("/mcp/") && path.endsWith("/auth")) return send({ ok: true })
        if (path === "/session" && req.method === "GET")
          return send(data.sessions.filter((item) => sameDir(item?.directory, url)))
        if (path === "/session" && req.method === "POST") {
          const id = `session-${data.counters.nextSession++}`
          const directory = projectDir(url)
          const item = {
            id,
            title: `Created ${id}`,
            directory,
            time: { updated: Date.now() },
          }
          data.sessions = [item, ...data.sessions]
          data.session[id] = item
          data.panelSettings[id] = {}
          data.timeline.session[id] = []
          data.diffs[id] = []
          return send(item)
        }
        if (path.startsWith("/session/") && path.endsWith("/panel-settings") && req.method === "GET") {
          const id = decodeURIComponent(path.slice(9, -15))
          return send(data.panelSettings[id] || {})
        }
        if (path.startsWith("/session/") && path.endsWith("/panel-settings") && req.method === "PATCH") {
          const id = decodeURIComponent(path.slice(9, -15))
          data.panelSettings[id] = await req.json()
          return send(data.panelSettings[id])
        }
        if (path.startsWith("/session/") && path.endsWith("/message")) {
          const id = decodeURIComponent(path.slice(9, -8))
          return send(data.timeline.session[id] || [])
        }
        if (path.startsWith("/session/") && path.endsWith("/diff")) {
          const id = decodeURIComponent(path.slice(9, -5))
          return send(data.diffs[id] || [])
        }
        if (path.startsWith("/session/") && req.method === "GET") {
          const id = decodeURIComponent(path.slice(9))
          return send(data.session[id] || null)
        }
        if (path.startsWith("/session/") && req.method === "DELETE") {
          const id = decodeURIComponent(path.slice(9))
          data.sessions = data.sessions.filter((item) => item.id !== id)
          delete data.session[id]
          delete data.panelSettings[id]
          delete data.timeline.session[id]
          delete data.diffs[id]
          return send({ ok: true })
        }
        if (path === "/control/timeline") {
          const taskID = url.searchParams.get("taskID")
          const sessionID = url.searchParams.get("sessionID")
          if (taskID) return send(data.timeline.task[taskID] || [])
          if (sessionID) return send(data.timeline.session[sessionID] || [])
          return send([])
        }
        if (path === "/panel/message") {
          return send(await append(await req.json()))
        }
        if (path === "/panel/message/stream") {
          const body = await append(await req.json())
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(`data: ${JSON.stringify({ type: "done", result: body })}\n\n`)
              controller.close()
            },
          })
          return new Response(stream, {
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          })
        }
        if (path === "/project/current/init-git") {
          data.vcs = {
            branch: "dev",
            clean: true,
            dirty: false,
            staged: 0,
            modified: 0,
            untracked: 0,
            conflicts: 0,
            ahead: 0,
            behind: 0,
          }
          return send({ created: true })
        }
        if (path === "/restart") {
          data.counters.restart += 1
          return send({ ok: true })
        }
        if (path === "/task/task-1/board") {
          return send(data.board, {
            headers: { etag: `"board-${data.board.task.time.updated}"` },
          })
        }
        if (path === "/task/task-1/conversation") {
          const timeline = data.timeline.task["task-1"] || []
          return send({
            board: data.board,
            transcript: timeline,
            timeline,
            events: [],
            view: { sessions: [] },
            eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
            lastSequence: 0,
          })
        }
        if (path === "/task/task-1/operator-model-context") {
          return send({
            taskID: "task-1",
            sessionID: "session-1",
            agent: "orchestrator",
            model: { providerID: "openai", modelID: "gpt-4o-mini" },
          })
        }
        if (path === "/task/task-1/browser-preview") {
          return send({
            taskID: "task-1",
            kind: "missing",
            status: "missing",
            projectRoot: "D:/overlay/workspace/app",
            viewports: [],
            diagnostics: [],
            candidates: [],
            source: "none",
          })
        }
        if (path.startsWith("/task/task-1/conversation/events")) {
          return send({
            events: [],
            eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          })
        }
        if (path === "/task/task-1/transcript") return send(data.timeline.task["task-1"] || [])
        if (path === "/task/task-1/trace")
          return send({ events: [], traceDir: "D:/overlay/workspace/app/.opencorvus/trace", enabled: true })
        if (path === "/task/events" || path === "/task/task-1/events") {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(":\n\n")
              controller.close()
            },
            cancel() {},
          })
          return new Response(stream, {
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          })
        }
        if (path === "/task/task-1/checks" && req.method === "PATCH") {
          const body = await req.json()
          data.board.task.metadata.checks = body.checks
          return send({ ok: true })
        }
        if (path === "/task/task-1/budget" && req.method === "PATCH") {
          const body = await req.json()
          data.board.task.budget = body.budget
          data.tasks.tasks[0].task.budget = body.budget
          return send(data.board.task)
        }
        if (path.startsWith("/interaction/") && path.endsWith("/reply")) {
          const id = decodeURIComponent(path.slice(13, -6))
          const item = data.board.interactions.find((entry) => entry.id === id)
          if (item) item.status = "resolved"
          return send({ ok: true })
        }
        if (path.startsWith("/interaction/") && path.endsWith("/reject")) {
          const id = decodeURIComponent(path.slice(13, -7))
          const item = data.board.interactions.find((entry) => entry.id === id)
          if (item) item.status = "rejected"
          return send({ ok: true })
        }
        if (path === "/panel/knowledge/memory") return send(data.memory)
        if (path === "/panel/knowledge/memory/search") {
          const body = await req.json()
          const q = String(body.query || "").toLowerCase()
          return send(
            data.memory.filter(
              (item) => item.title.toLowerCase().includes(q) || item.snippet.toLowerCase().includes(q),
            ),
          )
        }
        if (path.startsWith("/panel/knowledge/memory/") && req.method === "GET") {
          const id = decodeURIComponent(path.slice(24))
          return send(data.memoryDetail[id])
        }
        if (path.startsWith("/panel/knowledge/memory/") && req.method === "DELETE") {
          const id = decodeURIComponent(path.slice(24))
          data.memory = data.memory.filter((item) => item.id !== id)
          delete data.memoryDetail[id]
          return send({ ok: true })
        }
        if (path === "/panel/knowledge/preference" && req.method === "GET") return send(data.preference)
        if (path === "/panel/knowledge/preference" && req.method === "POST") {
          const body = await req.json()
          const item = {
            id: `pref-${data.counters.nextPreference++}`,
            key: String(body.key || ""),
            value: String(body.value || ""),
            scope: "global",
            source: "manual",
          }
          data.preference = [item, ...data.preference]
          return send(item)
        }
        if (path.startsWith("/panel/knowledge/preference/") && req.method === "PATCH") {
          const id = decodeURIComponent(path.slice(28))
          const body = await req.json()
          data.preference = data.preference.map((item) =>
            item.id === id
              ? { ...item, key: String(body.key || item.key), value: String(body.value || item.value) }
              : item,
          )
          return send({ ok: true })
        }
        if (path.startsWith("/panel/knowledge/preference/") && req.method === "DELETE") {
          const id = decodeURIComponent(path.slice(28))
          data.preference = data.preference.filter((item) => item.id !== id)
          return send({ ok: true })
        }
        if (path === "/log" && req.method === "POST") {
          const body = await req.json()
          data.logs.push(
            `${String(body.level || "info").toUpperCase()}  ${new Date().toISOString()} +0ms service=${body.service} ${body.message}`,
          )
          return send({ ok: true })
        }
        if (path === "/log/tail") return send({ lines: data.logs })
      return text(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })
    const seen: string[] = []
    const errors: string[] = []
    const app = server.origin
    const client = await launchBrowser(["--disable-dev-shm-usage"])
    const page = await client.newPage()
    await page.setViewport({ width: 1600, height: 1200 })
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`)
    })
    page.on("requestfailed", (request) => {
      if (/\/task\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
      errors.push(`requestfailed: ${request.url()}`)
    })
    page.on("response", (response) => {
      if (response.status() === 404) errors.push(`response404: ${response.url()}`)
    })
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
    })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      const state = {
        close: 0,
        drag: 0,
        hide: 0,
        minimize: 0,
        open: [] as string[],
        copy: [] as string[],
        picked: ["D:/overlay/picked", "D:/overlay/picked", "D:/overlay/workspace/app"] as string[],
        settings: {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/app",
          directoryMode: "custom",
          workspaceTaskID: "task-1",
          workspaceDirectory: "D:/overlay/workspace/app",
        },
      }
      Object.defineProperty(window, "__overlayTest", {
        configurable: true,
        value: state,
      })
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            state.copy.push(String(value))
          },
        },
      })
      window.open = (value: string | URL | undefined | null) => {
        if (value) state.open.push(String(value))
        return null
      }
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") return state.settings
            if (command === "overlay_settings_save") {
              state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
            if (command === "overlay_pick_dir") return state.picked.shift() || "D:/overlay/picked"
            if (command === "overlay_open_path") {
              if (args.path) state.open.push(String(args.path))
              return true
            }
            if (command === "overlay_open_url") {
              if (args.url) state.open.push(String(args.url))
              return true
            }
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => {
                state.close += 1
              },
              hide: async () => {
                state.hide += 1
              },
              startDragging: async () => {
                state.drag += 1
              },
              minimize: async () => {
                state.minimize += 1
              },
            }
          },
        },
      }
    }, app)
    try {
      const waitEnabled = async (selector: string) => {
        for (let i = 0; i < 50; i += 1) {
          const enabled = await page.evaluate((value) => {
            const node = document.querySelector(value)
            if (!(node instanceof HTMLElement)) return false
            return !("disabled" in node) || (node as HTMLButtonElement | HTMLInputElement).disabled !== true
          }, selector)
          if (enabled) return
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        const node = await page.evaluate((value) => document.querySelector<HTMLElement>(value)?.outerHTML || "", selector)
        assert.fail(`Timed out waiting for enabled control ${selector}\n${node}`)
      }
      const tap = async (selector: string) => {
        for (let i = 0; i < 5; i += 1) {
          try {
            await page.waitForSelector(selector, { timeout: 5_000 })
            if (!(await page.evaluate((value) => !!document.querySelector(value), selector))) continue
            await waitEnabled(selector)
            await page.locator(selector).click()
            return
          } catch (error) {
            if (i === 4) {
              const snapshot = await page.evaluate((value) => {
                const node = document.querySelector<HTMLElement>(value)
                return {
                  selector: value,
                  node: node?.outerHTML.slice(0, 800) || "",
                  activeTask: document.querySelector<HTMLElement>(".task-row-main[data-active='true']")?.dataset.taskId || "",
                  bodyText: document.body.textContent?.slice(0, 1200) || "",
                }
              }, selector)
              assert.fail(
                `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(
                  { requests, errors, snapshot },
                  null,
                  2,
                )}`,
              )
            }
          }
        }
      }
      const open = async (trigger: string, dialog: string) => {
        seen.push(trigger)
        await tap(trigger)
        await page.waitForFunction((id) => document.querySelector(id) !== null, {}, dialog)
      }
      const close = async (trigger: string, dialog: string) => {
        seen.push(trigger)
        await tap(trigger)
        await page.waitForFunction((id) => document.querySelector(id) === null, {}, dialog)
      }
      const details = async (selector: string, value: boolean) => {
        const exists = await page.evaluate((target) => !!document.querySelector(target), selector)
        if (!exists) return
        seen.push(`${selector} > summary`)
        await page.$eval(
          selector,
          (node, open) => {
            const item = node as HTMLDetailsElement
            if (item.open === !!open) return
            item.open = !!open
            item.dispatchEvent(new Event("toggle", { bubbles: true }))
          },
          value,
        )
        const next = await page.$eval(selector, (node) => (node as HTMLDetailsElement).open)
        assert.equal(next, value)
      }
      const ensureMenuOpen = async (menu: string) => {
        const panel = `[data-testid="titlebar-menu-${menu}"]`
        if (!(await page.$(panel))) {
          await tap(`[data-menu-trigger="${menu}"]`)
        }
        await page.waitForSelector(panel)
      }
      const confirm = async (value?: string) => {
        if (value !== undefined) {
          await page.waitForSelector("#appDialogInput")
          await page.click("#appDialogInput", { clickCount: 3 })
          await page.type("#appDialogInput", value)
        }
        seen.push("#btnAppDialogOk")
        await tap("#btnAppDialogOk")
        await page.waitForFunction(() => document.querySelector("#appDialog") === null)
      }
      const waitIdle = () => new Promise((resolve) => setTimeout(resolve, 100))
      const hover = async (selector: string) => {
        await page.waitForSelector(selector)
        await page.hover(selector)
        await page.waitForFunction(
          (value) => {
            const node = document.querySelector(value)
            if (!(node instanceof HTMLElement)) return false
            const style = getComputedStyle(node)
            return style.backgroundImage !== "none" || style.boxShadow !== "none"
          },
          {},
          selector,
        )
      }

      await page.goto(`${app}/ui/index.html`, { waitUntil: "load" })
      try {
        await page.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")
      } catch (error) {
        const snapshot = await page.evaluate(() => ({
          badgeStatus: document.querySelector<HTMLElement>("#connBadge")?.dataset.status || "",
          badgeText: document.querySelector<HTMLElement>("#connBadge")?.textContent || "",
          bannerStatus: document.querySelector<HTMLElement>(".conn-banner")?.dataset.status || "",
          bannerText: document.querySelector<HTMLElement>(".conn-banner")?.textContent || "",
          bodyText: document.body.textContent?.slice(0, 1200) || "",
        }))
        assert.fail(
          `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(
            { requests, errors, snapshot },
            null,
            2,
          )}`,
        )
      }
      await page.waitForSelector(".task-row-main[data-task-id='task-1']")
      await page.click(".task-row-main[data-task-id='task-1']")
      await tap('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      try {
        await page.waitForFunction(
          () => document.querySelector<HTMLElement>("#centerWorkbenchInspector")?.dataset.active === "true",
        )
      } catch (error) {
        const snapshot = await page.evaluate(() => ({
          activeTask: document.querySelector<HTMLElement>(".task-row-main[data-active='true']")?.dataset.taskId || "",
          inspectorButton:
            document.querySelector<HTMLElement>(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]',
            )?.outerHTML || "",
          centerWorkbench: document.querySelector<HTMLElement>("#centerWorkbench")?.outerHTML.slice(0, 1200) || "",
          inspectorActive: document.querySelector<HTMLElement>("#centerWorkbenchInspector")?.dataset.active || "",
          bodyText: document.body.textContent?.slice(0, 1200) || "",
        }))
        assert.fail(
          `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(
            { requests, errors, snapshot },
            null,
            2,
          )}`,
        )
      }
      try {
        await page.waitForSelector(".req-item")
      } catch (error) {
        const snapshot = await page.evaluate(() => ({
          activeTask: document.querySelector<HTMLElement>(".task-row-main[data-active='true']")?.dataset.taskId || "",
          inspector: document.querySelector<HTMLElement>("#centerWorkbenchInspector")?.dataset.active || "",
          rightPanel: document.querySelector<HTMLElement>("#rightPanelInspector")?.dataset.active || "",
          sectionText: document.querySelector<HTMLElement>("#sections")?.textContent?.slice(0, 1200) || "",
          inspectorText: document.querySelector<HTMLElement>("#centerWorkbenchInspector")?.textContent?.slice(0, 1200) || "",
          bodyText: document.body.textContent?.slice(0, 1200) || "",
        }))
        assert.fail(
          `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(
            { requests, errors, snapshot },
            null,
            2,
          )}`,
        )
      }
      const workflowPanels = await page.evaluate(() => {
        const req = document.querySelector<HTMLElement>(".req-item")
        const reqDesc = document.querySelector<HTMLElement>(".req-desc")
        const reqID = document.querySelector<HTMLElement>(".req-index")
        const archDecisionText = Array.from(document.querySelectorAll<HTMLElement>(".arch-decision"))
          .map((item) => item.textContent || "")
          .join("\n")
        const archSummary = document.querySelector<HTMLElement>(".arch-detail")
        const firstDecision = document.querySelector<HTMLElement>(".arch-decision")
        const reqRect = req?.getBoundingClientRect()
        const descRect = reqDesc?.getBoundingClientRect()
        return {
          reqIDText: reqID?.textContent || "",
          reqIDTitle: reqID?.getAttribute("title") || "",
          descWidth: descRect?.width || 0,
          itemWidth: reqRect?.width || 1,
          archDecisionText,
          archDecisionStrong: firstDecision?.querySelector(".arch-decision-value strong")?.textContent || "",
          archDecisionCode: firstDecision?.querySelector(".arch-decision-value code")?.textContent || "",
          archDecisionReasonList: firstDecision?.querySelector(".arch-decision-reason ul li")?.textContent || "",
          archSummaryText: archSummary?.textContent || "",
        }
      })
      assert.equal(workflowPanels.reqIDText, "REQ 01")
      assert.ok(workflowPanels.reqIDTitle.includes("req_de4c67cdd001"))
      assert.ok(workflowPanels.descWidth > workflowPanels.itemWidth * 0.6)
      assert.ok(workflowPanels.archDecisionText.includes("Conversation records use one persisted schema"))
      assert.ok(workflowPanels.archDecisionText.includes("Keeps resume and export flows"))
      assert.ok(workflowPanels.archDecisionText.includes("Seventh decision remains visible"))
      assert.ok(workflowPanels.archDecisionText.includes("Large decision logs still need inspectable"))
      assert.equal(workflowPanels.archDecisionStrong, "one persisted schema")
      assert.equal(workflowPanels.archDecisionCode, "streaming cursors")
      assert.ok(workflowPanels.archDecisionReasonList.includes("Keeps resume and export flows"))
      assert.equal(workflowPanels.archSummaryText.includes("architect decisions across"), false)
      await page.waitForSelector(".change-row", { state: "attached" })
      await page.waitForSelector(".interaction-card[data-id='interaction-1'] [data-action='once']", { state: "attached" })

      assert.equal(await page.$("[data-testid^='titlebar-menu-']"), null)
      await page.click('[data-menu-trigger="help"]')
      await page.waitForSelector('[data-testid="titlebar-menu-help"]')
      await page.keyboard.press("Escape")
      await page.waitForFunction(() => !document.querySelector('[data-testid="titlebar-menu-help"]'))

      await ensureMenuOpen("settings")
      await page.waitForSelector('[data-testid="titlebar-settings-skill"]')
      seen.push('[data-testid="titlebar-settings-skill"]')
      await tap('[data-testid="titlebar-settings-skill"]')
      await page.waitForFunction(
        () =>
          document.querySelector("#configDialog") !== null &&
          document.querySelector('[data-config-panel="skill"]')?.classList.contains("active") === true,
      )
      await page.waitForFunction(() => document.body.textContent?.includes("alpha-skill"))
      seen.push("#btnCloseConfigDialog")
      await tap("#btnCloseConfigDialog")
      await page.waitForFunction(() => document.querySelector("#configDialog") === null)

      await ensureMenuOpen("settings")
      await page.waitForSelector('[data-testid="titlebar-settings-mcp"]')
      seen.push('[data-testid="titlebar-settings-mcp"]')
      await tap('[data-testid="titlebar-settings-mcp"]')
      await page.waitForFunction(
        () =>
          document.querySelector("#configDialog") !== null &&
          document.querySelector('[data-config-panel="mcp"]')?.classList.contains("active") === true,
      )
      await page.waitForFunction(() => document.body.textContent?.includes("docs"))
      seen.push("#btnCloseConfigDialog")
      await tap("#btnCloseConfigDialog")
      await page.waitForFunction(() => document.querySelector("#configDialog") === null)

      await ensureMenuOpen("settings")
      await page.waitForSelector('[data-testid="titlebar-settings-skill-market"]')
      seen.push('[data-testid="titlebar-settings-skill-market"]')
      await tap('[data-testid="titlebar-settings-skill-market"]')
      await page.waitForFunction(
        () =>
          document.querySelector("#configDialog") !== null &&
          document.querySelector('[data-config-panel="skill-market"]')?.classList.contains("active") === true,
      )
      await page.waitForFunction(() => document.body.textContent?.includes("market-install"))
      seen.push("#btnCloseConfigDialog")
      await tap("#btnCloseConfigDialog")
      await page.waitForFunction(() => document.querySelector("#configDialog") === null)

      const stub = await page.evaluate(
        () => (window as typeof window & { __overlayTest: Record<string, unknown> }).__overlayTest,
      )
      assert.ok(seen.includes('[data-testid="titlebar-settings-skill"]'))
      assert.ok(seen.includes('[data-testid="titlebar-settings-mcp"]'))
      assert.ok(seen.includes('[data-testid="titlebar-settings-skill-market"]'))
      assert.notEqual(stub.open, undefined)
      assert.equal(stub.close, 0)
      assert.deepEqual(errors, [])
    } finally {
      await Promise.race([page.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1000))])
      await Promise.race([client.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1000))])
      await server.close()
    }
  },
  { timeout: 120_000 },
)
