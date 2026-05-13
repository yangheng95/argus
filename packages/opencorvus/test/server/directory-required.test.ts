import { afterEach, describe, expect, mock, test } from "bun:test"
import { Server } from "../../src/server/server"
import { clearServerShutdownHandler } from "../../src/server/shutdown"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

/**
 * 2026-04-30 darwin cascade audit (W2-V31). Pre-fix the project-scope
 * middleware fell back to `process.cwd()` when no `?directory=` was
 * supplied — on macOS .app launched from Finder cwd is `/`, which made
 * `Project.initGit("/")` permission-deny on every project-scoped request
 * and 500-stormed the entire overlay (rule 7: no fallback).
 *
 * Fix: throw `DirectoryRequiredError` (NamedError → 400) when the
 * directory query/header is absent on a project-scoped route.
 *
 * Control-plane routes (/log, /shutdown, /restart) and the cross-project
 * mounts (/global/*, /auth/*) must continue to work without ?directory=.
 */
describe("project-scope middleware: directory required", () => {
  afterEach(async () => {
    mock.restore()
    clearServerShutdownHandler()
    await resetDatabase()
  })

  test("project-scoped GET /tasks without ?directory= returns 400 + DirectoryRequiredError", async () => {
    const app = Server.App()
    const response = await app.request("/tasks", { method: "GET" })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; data: { message: string } }
    expect(body.name).toBe("DirectoryRequiredError")
    expect(body.data.message).toContain("/tasks")
    expect(body.data.message).toContain("?directory=")
  })

  test("control-plane POST /shutdown still works without ?directory=", async () => {
    const app = Server.App()
    // No registered shutdown handler → 503 (per app-routes.test.ts), but
    // crucially NOT 400 from the directory-required middleware: the
    // control-plane bypass at server.ts must short-circuit before the
    // directory check runs.
    const response = await app.request("/shutdown", { method: "POST" })
    expect(response.status).toBe(503)
    const body = (await response.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  })

  test("cross-project GET /global/health works without ?directory=", async () => {
    const app = Server.App()
    const response = await app.request("/global/health", { method: "GET" })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { healthy: boolean }
    expect(body.healthy).toBe(true)
  })

  test("cross-project DELETE /auth/:providerID works without ?directory=", async () => {
    const app = Server.App()
    const response = await app.request("/auth/test-provider", { method: "DELETE" })
    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  test("cross-project PUT /auth/:providerID works without ?directory=", async () => {
    const app = Server.App()
    const response = await app.request("/auth/test-provider", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api", key: "test-key" }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  // The assertion that the header (or query) directory is accepted by
  // the middleware is covered by full-engine integration tests; we
  // intentionally do NOT exercise that branch here because it would
  // require booting the project DB / git plumbing in a unit-test
  // budget. The negative assertions above (no directory → 400) and
  // the bypass tests (control-plane, cross-project) are sufficient
  // to lock the directory-gate contract.
})
