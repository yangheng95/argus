import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { apiJson, apiRequest, apiUrl, configure } from "../src/services/api";
import { __setHostTransportForTest } from "../src/services/host-transport";
import type {
  HostTransport,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport";

/**
 * 2026-04-30 W2-V31 — overlay api.ts must decide per-path whether to
 * inject `?directory=` into the URL. The pre-fix logic used prefix
 * matching: any `global/*` path was excluded. That correctly skipped
 * `/global/health` (mounted on the server in GlobalRoutes, before the
 * Instance middleware). `/global/tasks` originally lived in AppRoutes and
 * required injection, but the sidebar now uses it as the all-project task
 * ledger; sending `directory` would silently collapse it back to one project.
 *
 * The fix replaces prefix matching with an explicit whitelist of routes
 * that the server mounts pre-middleware. This test enumerates every
 * route the overlay calls and pins the inject/no-inject decision so
 * adding a new route to the overlay (or moving one between AppRoutes
 * and GlobalRoutes server-side) trips a failing test.
 *
 * If you add a new route here, also update the matching list in
 * `packages/overlay/src/services/api.ts` and the server bypass at
 * `packages/opencorvus/src/server/server.ts`.
 */

const SAVED_DIRECTORY = "/Users/alice/projects/demo";

function fakeTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req);
      return { status: 200, ok: true, headers: {}, body: {} as T };
    },
    openStream() {
      throw new Error("openStream not used");
    },
    async native() {
      throw new Error("native not used");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  };
}

function expectInjects(path: string) {
  const url = new URL(apiUrl(path));
  expect(url.searchParams.get("directory")).toBe(SAVED_DIRECTORY);
}

function expectDoesNotInject(path: string) {
  const url = new URL(apiUrl(path));
  expect(url.searchParams.has("directory")).toBe(false);
}

describe("apiUrl directory injection (W2-V31)", () => {
  beforeEach(() => {
    configure({ serverUrl: "http://127.0.0.1:7878", directory: SAVED_DIRECTORY });
  });

  afterEach(() => {
    __setHostTransportForTest(undefined);
    configure({ directory: "" });
  });

  describe("control-plane routes (no-inject)", () => {
    test("log", () => expectDoesNotInject("log"));
    test("log files", () => expectDoesNotInject("log/files"));
    test("log tail", () => expectDoesNotInject("log/tail"));
    test("shutdown", () => expectDoesNotInject("shutdown"));
    test("restart", () => expectDoesNotInject("restart"));
  });

  describe("global and exact middleware bypass routes — no-inject", () => {
    test("global/health", () => expectDoesNotInject("global/health"));
    test("global/event", () => expectDoesNotInject("global/event"));
    test("global/config", () => expectDoesNotInject("global/config"));
    test("global/dispose", () => expectDoesNotInject("global/dispose"));
    test("global/db/reset", () => expectDoesNotInject("global/db/reset"));
    test("global/tasks", () => expectDoesNotInject("global/tasks"));
    test("mission ledger", () => expectDoesNotInject("mission"));
  });

  describe("auth routes — no-inject (cross-project by design)", () => {
    test("auth", () => expectDoesNotInject("auth"));
    test("auth/login", () => expectDoesNotInject("auth/login"));
    test("auth/logout", () => expectDoesNotInject("auth/logout"));
  });

  describe("project-scoped routes (registered under AppRoutes) — must inject", () => {
    test("tasks", () => expectInjects("tasks"));
    test("task create", () => expectInjects("task"));
    test("task scoped followup", () => expectInjects("task/abc/followup"));
    test("path", () => expectInjects("path"));
    test("vcs", () => expectInjects("vcs"));
    test("config", () => expectInjects("config"));
    test("config/providers", () => expectInjects("config/providers"));
    test("session config", () => expectInjects("session/session_123/config"));
    test("config/auth", () => expectInjects("config/auth"));
    test("config/mcp", () => expectInjects("config/mcp"));
    test("config/skill", () => expectInjects("config/skill"));
    test("config/prompt", () => expectInjects("config/prompt"));
    test("config/executor", () => expectInjects("config/executor"));
    test("provider", () => expectInjects("provider"));
    test("mission wake", () => expectInjects("mission/wake"));
    test("channel", () => expectInjects("channel"));
    test("agent", () => expectInjects("agent"));
    test("installed", () => expectInjects("installed"));
    test("skill", () => expectInjects("skill"));
    test("skill/installed", () => expectInjects("skill/installed"));
    test("skill/market", () => expectInjects("skill/market"));
    test("skill/directories", () => expectInjects("skill/directories"));
    test("mcp", () => expectInjects("mcp"));
    test("browser preview target", () => expectInjects("browser-preview/target"));
    test("browser preview verify", () => expectInjects("browser-preview/verify"));
    test("coding assistant session list", () => expectInjects("coding/sessions"));
    test("coding assistant session create", () => expectInjects("coding/session"));
    test("coding assistant session claim", () => expectInjects("coding/session/ses_123"));
  });

  describe("when no directory is configured, no path receives the query", () => {
    beforeEach(() => {
      configure({ directory: "" });
    });

    test("project-scoped path skips inject when context is empty", () => {
      const url = new URL(apiUrl("tasks"));
      expect(url.searchParams.has("directory")).toBe(false);
    });
  });

  describe("an explicit ?directory= already in the path is preserved", () => {
    test("does not double-set directory", () => {
      const url = new URL(apiUrl("tasks?directory=/explicit"));
      // explicit value wins; we never overwrite a caller-provided directory
      expect(url.searchParams.get("directory")).toBe("/explicit");
    });
  });

  describe("transport request query injection", () => {
    test("apiJson sends directory through HostTransport query", async () => {
      let captured: TransportRequest | undefined;
      __setHostTransportForTest(fakeTransport((req) => { captured = req }));

      await apiJson("tasks");

      expect(captured?.path).toBe("tasks");
      expect(captured?.query?.directory).toBe(SAVED_DIRECTORY);
    });

    test("apiRequest preserves explicit directory through HostTransport query", async () => {
      let captured: TransportRequest | undefined;
      __setHostTransportForTest(fakeTransport((req) => { captured = req }));

      await apiRequest("tasks?directory=/explicit");

      expect(captured?.path).toBe("tasks");
      expect(captured?.query?.directory).toBe("/explicit");
    });
  });
});
