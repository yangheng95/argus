import { describe, expect, test } from "bun:test"
import { BROWSER_MCP_PERMISSION_BASELINE, mcpPermissionPlan } from "../../src/mcp/browser/permission-plan"
import { PermissionNext } from "../../src/permission/next"

describe("mcpPermissionPlan", () => {
  test("defaults every browser MCP permission to allow", () => {
    for (const rule of BROWSER_MCP_PERMISSION_BASELINE) {
      expect(PermissionNext.evaluate(rule.permission, rule.pattern, BROWSER_MCP_PERMISSION_BASELINE).action).toBe(
        "allow",
      )
    }
  })

  test("keeps explicit operator overrides stronger than browser MCP defaults", () => {
    const ruleset = PermissionNext.merge(BROWSER_MCP_PERMISSION_BASELINE, [
      { permission: "browser.evaluate", pattern: "*", action: "ask" },
      { permission: "browser.download", pattern: "#secret", action: "deny" },
    ])

    expect(PermissionNext.evaluate("browser.evaluate", "*", ruleset).action).toBe("ask")
    expect(PermissionNext.evaluate("browser.download", "#secret", ruleset).action).toBe("deny")
    expect(PermissionNext.evaluate("browser.download", "#public", ruleset).action).toBe("allow")
  })

  test("allows localhost navigation by origin", () => {
    expect(mcpPermissionPlan("browser_navigate", { url: "http://127.0.0.1:3000/app" })).toMatchObject({
      permission: "browser.navigate.localhost",
      patterns: ["http://127.0.0.1:3000"],
      always: ["http://127.0.0.1:3000"],
    })
  })

  test("plans external navigation by origin", () => {
    expect(mcpPermissionPlan("browser_navigate", { url: "https://example.com/path?q=1" })).toMatchObject({
      permission: "browser.navigate.external",
      patterns: ["https://example.com"],
      always: ["https://example.com"],
    })
  })

  test("plans evaluate without storing the full expression in metadata", () => {
    const expression = "localStorage.setItem('token', 'secret');".repeat(10)
    const plan = mcpPermissionPlan("browser_evaluate", { expression })
    expect(plan.permission).toBe("browser.evaluate")
    expect(plan.patterns).toEqual(["*"])
    expect(String(plan.metadata.expressionPreview).length).toBeLessThanOrEqual(120)
    expect(plan.metadata.expressionChars).toBe(expression.length)
    expect(JSON.stringify(plan.metadata)).not.toContain(expression)
  })

  test("plans upload by local file path", () => {
    expect(
      mcpPermissionPlan("browser_upload_file", { filePath: "C:/tmp/secret.txt", selector: "input" }),
    ).toMatchObject({
      permission: "browser.upload_file",
      patterns: ["C:/tmp/secret.txt"],
      always: ["C:/tmp/secret.txt"],
      metadata: { selector: "input" },
    })
  })

  test("plans importing or exporting browser storage state", () => {
    expect(mcpPermissionPlan("browser_storage_state_export", { sessionId: "sess_123" })).toMatchObject({
      permission: "browser.storage.export",
      patterns: ["sess_123"],
    })
    expect(
      mcpPermissionPlan("browser_storage_state_import", { storageState: { cookies: [], origins: [] } }),
    ).toMatchObject({
      permission: "browser.storage.import",
      patterns: ["*"],
    })
  })

  test("plans downloading browser files", () => {
    expect(mcpPermissionPlan("browser_download", { selector: "#export" })).toMatchObject({
      permission: "browser.download",
      patterns: ["#export"],
      metadata: { tool: "browser_download", selector: "#export" },
    })
  })

  test("plans preserving or reusing browser profiles", () => {
    expect(mcpPermissionPlan("browser_session_create", { profileId: "prof_123" })).toMatchObject({
      permission: "browser.profile.reuse",
      patterns: ["prof_123"],
    })
    expect(mcpPermissionPlan("browser_session_destroy", { preserveProfile: "1d" })).toMatchObject({
      permission: "browser.profile.persist",
      patterns: ["1d"],
    })
  })
})
