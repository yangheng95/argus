import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ProjectDirectoryRequiredError, apiJson, apiRequest, apiUrl, configure } from "../src/services/api"
import { HOST_CAPABILITIES, __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { routeRequiresProjectDirectory } from "@opencorvus-ai/transport-protocol"

/**
 * 2026-04-30 W2-V31 — overlay api.ts must decide per-path whether to
 * inject `?directory=` into the URL. The pre-fix logic used prefix
 * matching: any `global/*` path was excluded. That correctly skipped
 * `/global/health` (mounted on the server in GlobalRoutes, before the
 * Instance middleware). `/global/tasks` originally lived in AppRoutes and
 * required injection, but the sidebar now uses it as the all-project task
 * ledger; sending `directory` would silently collapse it back to one project.
 *
 * The fix now lives in @opencorvus-ai/transport-protocol so server
 * middleware, server OpenAPI generation, and overlay query injection
 * read one route policy function instead of synchronized local lists.
 */

const SAVED_DIRECTORY = "/Users/alice/projects/demo"
const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")
const REPO_ROOT = path.resolve(OVERLAY_ROOT, "../..")

function readRepo(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8")
}

function fakeTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      return { status: 200, ok: true, headers: {}, body: {} as T }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

function expectInjects(path: string) {
  const url = new URL(apiUrl(path))
  expect(url.searchParams.get("directory")).toBe(SAVED_DIRECTORY)
}

function expectDoesNotInject(path: string) {
  const url = new URL(apiUrl(path))
  expect(url.searchParams.has("directory")).toBe(false)
}

describe("apiUrl directory injection (W2-V31)", () => {
  beforeEach(() => {
    configure({ serverUrl: "http://127.0.0.1:7878", directory: SAVED_DIRECTORY })
  })

  afterEach(() => {
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
  })

  test("overlay and server consume the shared route directory policy artifact", () => {
    const api = readRepo("packages/overlay/src/services/api.ts")
    const server = readRepo("packages/opencorvus/src/server/server.ts")

    expect(api).toContain('from "@opencorvus-ai/transport-protocol"')
    expect(api).toContain("routeRequiresProjectDirectory(pathOnly, method)")
    expect(api).not.toContain("NO_DIRECTORY_PATHS")
    expect(api).not.toContain("NO_DIRECTORY_PREFIXES")
    expect(server).toContain('from "@opencorvus-ai/transport-protocol"')
    expect(server).not.toContain("PROJECT_DIRECTORY_BYPASS_PATHS")
    expect(server).not.toContain("PROJECT_DIRECTORY_BYPASS_PREFIXES")
  })

  describe("control-plane routes (no-inject)", () => {
    test("log", () => expectDoesNotInject("log"))
    test("log files", () => expectDoesNotInject("log/files"))
    test("log tail", () => expectDoesNotInject("log/tail"))
    test("shutdown", () => expectDoesNotInject("shutdown"))
    test("restart", () => expectDoesNotInject("restart"))
  })

  describe("global and exact middleware bypass routes — no-inject", () => {
    test("global/health", () => expectDoesNotInject("global/health"))
    test("global/event", () => expectDoesNotInject("global/event"))
    test("global/config", () => expectDoesNotInject("global/config"))
    test("global/dispose", () => expectDoesNotInject("global/dispose"))
    test("global/db/reset", () => expectDoesNotInject("global/db/reset"))
    test("global/db/mysql/schema", () => expectDoesNotInject("global/db/mysql/schema"))
    test("global/db/mysql/export", () => expectDoesNotInject("global/db/mysql/export"))
    test("global/db/mysql/import", () => expectDoesNotInject("global/db/mysql/import"))
    test("global/tasks", () => expectDoesNotInject("global/tasks"))
    test("mission ledger", () => expectDoesNotInject("mission"))
    test("task conversation hydrate", () => expectDoesNotInject("task/abc/conversation"))
    test("task conversation history", () => expectDoesNotInject("task/abc/conversation/history"))
    test("task conversation events", () => expectDoesNotInject("task/abc/conversation/events"))
    test("task conversation session", () => expectDoesNotInject("task/abc/conversation/session/session_123"))
  })

  describe("auth routes — no-inject (cross-project by design)", () => {
    test("auth", () => expectDoesNotInject("auth"))
    test("auth/login", () => expectDoesNotInject("auth/login"))
    test("auth/logout", () => expectDoesNotInject("auth/logout"))
  })

  describe("project-scoped routes (registered under AppRoutes) — must inject", () => {
    test("tasks", () => expectInjects("tasks"))
    test("task create", () => expectInjects("task"))
    test("task scoped followup", () => expectInjects("task/abc/followup"))
    test("task operator model context", () => expectInjects("task/abc/operator-model-context"))
    test("path", () => expectInjects("path"))
    test("vcs", () => expectInjects("vcs"))
    test("config", () => expectInjects("config"))
    test("config/providers", () => expectInjects("config/providers"))
    test("config proxy test", () => expectInjects("config/proxy/test"))
    test("session config", () => expectInjects("session/session_123/config"))
    test("session conversation", () => expectInjects("session/session_123/conversation"))
    test("config/auth", () => expectInjects("config/auth"))
    test("config/mcp", () => expectInjects("config/mcp"))
    test("config/skill", () => expectInjects("config/skill"))
    test("config/prompt", () => expectInjects("config/prompt"))
    test("config/prompt-profile", () => expectInjects("config/prompt-profile"))
    test("config/executor", () => expectInjects("config/executor"))
    test("provider", () => expectInjects("provider"))
    test("provider Hexin budget", () => expectInjects("provider/hexin/budget"))
    test("project current", () => expectInjects("project/current"))
    test("project current worktrees", () => expectInjects("project/current/worktrees"))
    test("file upload", () => expectInjects("file/upload"))
    test("mission wake", () => expectInjects("mission/wake"))
    test("channel", () => expectInjects("channel"))
    test("agent", () => expectInjects("agent"))
    test("installed", () => expectInjects("installed"))
    test("skill", () => expectInjects("skill"))
    test("skill/installed", () => expectInjects("skill/installed"))
    test("skill/market", () => expectInjects("skill/market"))
    test("skill/directories", () => expectInjects("skill/directories"))
    test("mcp", () => expectInjects("mcp"))
    test("browser preview target", () => expectInjects("task/tsk_browserpreview0001/browser-preview"))
    test("browser preview capture", () => expectInjects("task/tsk_browserpreview0001/browser-preview/capture"))
    test("browser preview evidence", () =>
      expectInjects("task/tsk_browserpreview0001/browser-preview/evidence/art_previewevidence00000001"))
    test("browser preview evidence capture", () =>
      expectInjects("task/tsk_browserpreview0001/browser-preview/evidence/art_previewevidence00000001/capture.png"))
    test("coding assistant session list", () => expectInjects("coding/sessions"))
    test("coding assistant session create", () => expectInjects("coding/session"))
    test("coding assistant session claim", () => expectInjects("coding/session/ses_123"))
    test("coding assistant session update", () => expectInjects("coding/session/ses_123"))
    test("coding assistant session delete", () => expectInjects("coding/session/ses_123"))
    test("coding assistant session abort", () => expectInjects("coding/session/ses_123/abort"))
  })

  test("enumerated route expectations agree with the shared policy function", () => {
    for (const path of [
      "log",
      "log/files",
      "log/tail",
      "shutdown",
      "restart",
      "global/health",
      "global/event",
      "global/config",
      "global/dispose",
      "global/db/reset",
      "global/db/mysql/schema",
      "global/db/mysql/export",
      "global/db/mysql/import",
      "global/tasks",
      "mission",
      "task/abc/conversation",
      "task/abc/conversation/history",
      "task/abc/conversation/events",
      "task/abc/conversation/session/session_123",
      "auth",
      "auth/login",
      "auth/logout",
    ]) {
      expect(routeRequiresProjectDirectory(path)).toBe(false)
    }
    expect(routeRequiresProjectDirectory("task/abc", "DELETE")).toBe(false)
    for (const path of [
      "tasks",
      "task",
      "task/abc/followup",
      "task/abc/message",
      "task/abc/operator-model-context",
      "path",
      "vcs",
      "config",
      "config/proxy/test",
      "config/prompt-profile",
      "provider/hexin/budget",
      "project/current",
      "project/current/worktrees",
      "file/upload",
      "session/session_123/conversation",
      "mission/wake",
      "coding/session/ses_123/abort",
      "task/tsk_browserpreview0001/browser-preview",
      "task/tsk_browserpreview0001/browser-preview/evidence/art_previewevidence00000001/capture.png",
    ]) {
      expect(routeRequiresProjectDirectory(path)).toBe(true)
    }
    expect(routeRequiresProjectDirectory("task/abc", "GET")).toBe(true)
    expect(routeRequiresProjectDirectory("task/abc/conversation", "POST")).toBe(true)
  })

  describe("when no directory is configured, project requests do not leave the overlay unscoped", () => {
    beforeEach(() => {
      configure({ directory: "" })
    })

    test("apiUrl does not fabricate a project directory", () => {
      const url = new URL(apiUrl("tasks"))
      expect(url.searchParams.has("directory")).toBe(false)
    })

    test("apiJson rejects a project-scoped request before HostTransport", async () => {
      let called = false
      __setHostTransportForTest(
        fakeTransport(() => {
          called = true
        }),
      )

      await expect(apiJson("tasks")).rejects.toBeInstanceOf(ProjectDirectoryRequiredError)
      expect(called).toBe(false)
    })

    test("apiRequest rejects a project-scoped request before HostTransport", async () => {
      let called = false
      __setHostTransportForTest(
        fakeTransport(() => {
          called = true
        }),
      )

      await expect(apiRequest("project/current/worktrees")).rejects.toBeInstanceOf(ProjectDirectoryRequiredError)
      expect(called).toBe(false)
    })
  })

  describe("an explicit ?directory= already in the path is preserved", () => {
    test("does not double-set directory", () => {
      const url = new URL(apiUrl("tasks?directory=/explicit"))
      // explicit value wins; we never overwrite a caller-provided directory
      expect(url.searchParams.get("directory")).toBe("/explicit")
    })

    test("preserves clicked Mission row directory on action routes", () => {
      const url = new URL(apiUrl("mission/m-alpha/abort?directory=/mission-row-project"))
      expect(url.searchParams.get("directory")).toBe("/mission-row-project")
    })
  })

  describe("transport request query injection", () => {
    test("apiJson sends directory through HostTransport query", async () => {
      let captured: TransportRequest | undefined
      __setHostTransportForTest(
        fakeTransport((req) => {
          captured = req
        }),
      )

      await apiJson("tasks")

      expect(captured?.path).toBe("tasks")
      expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
    })

    test("apiUrl preserves literal percent-encoded slash through URLSearchParams", () => {
      const directory = "D:/projects/literal%2Fname"
      configure({ directory })

      const url = new URL(apiUrl("tasks"))

      expect(url.searchParams.get("directory")).toBe(directory)
      expect(url.href).toContain("literal%252Fname")
    })

    test("apiJson preserves literal percent-encoded slash in transport query", async () => {
      let captured: TransportRequest | undefined
      const directory = "D:/projects/literal%2Fname"
      configure({ directory })
      __setHostTransportForTest(
        fakeTransport((req) => {
          captured = req
        }),
      )

      await apiJson("tasks")

      expect(captured?.path).toBe("tasks")
      expect(captured?.query?.directory).toBe(directory)
    })

    test("apiRequest preserves explicit directory through HostTransport query", async () => {
      let captured: TransportRequest | undefined
      __setHostTransportForTest(
        fakeTransport((req) => {
          captured = req
        }),
      )

      await apiRequest("tasks?directory=/explicit")

      expect(captured?.path).toBe("tasks")
      expect(captured?.query?.directory).toBe("/explicit")
    })

    test("apiJson preserves explicit Mission row directory through HostTransport query", async () => {
      let captured: TransportRequest | undefined
      __setHostTransportForTest(
        fakeTransport((req) => {
          captured = req
        }),
      )

      await apiJson("mission/m-alpha?directory=/mission-row-project", { method: "DELETE" })

      expect(captured?.path).toBe("mission/m-alpha")
      expect(captured?.query?.directory).toBe("/mission-row-project")
    })

    test("apiJson does not inject directory into task record delete", async () => {
      let captured: TransportRequest | undefined
      __setHostTransportForTest(
        fakeTransport((req) => {
          captured = req
        }),
      )

      await apiJson("task/abc", { method: "DELETE" })

      expect(captured?.path).toBe("task/abc")
      expect(captured?.query?.directory).toBeUndefined()
    })
  })
})
