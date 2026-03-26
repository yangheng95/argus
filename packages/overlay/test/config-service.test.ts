import { afterEach, describe, expect, mock, test } from "bun:test"

describe("config service", () => {
  afterEach(() => {
    mock.restore()
  })

  test("reloadProjectScope reloads preferences with other project-scoped state", async () => {
    const calls: string[] = []
    mock.module("../src/services/init", () => ({
      loadConfigInfo: async () => {
        calls.push("config")
      },
    }))
    mock.module("../src/services/extensions", () => ({
      loadExtensions: async () => {
        calls.push("extensions")
      },
    }))
    mock.module("../src/services/meta", () => ({
      loadMeta: async () => {
        calls.push("meta")
      },
    }))
    mock.module("../src/services/memory", () => ({
      loadPreferences: async () => {
        calls.push("preferences")
      },
    }))
    mock.module("../src/services/workspace", () => ({
      restoreWorkspaceDirectory: async () => {
        calls.push("workspace")
      },
    }))

    const { reloadProjectScope } = await import("../src/services/config")
    await reloadProjectScope({ restoreWorkspace: true })

    expect(calls).toEqual(expect.arrayContaining(["config", "extensions", "meta", "preferences", "workspace"]))
    expect(calls).toHaveLength(5)
  })
})
