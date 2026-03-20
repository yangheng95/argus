import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Preference } from "../../src/preference"
import { PreferenceTool } from "../../src/tool/preference"
import { tmpdir } from "../fixture/fixture"

function ctx(sessionID: string) {
  return {
    sessionID,
    messageID: "msg_test_preference",
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

describe("tool.preference", () => {
  test("supports global and session-scoped preferences", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PreferenceTool.init()
        const sessionA = ctx("ses_pref_a")
        const sessionB = ctx("ses_pref_b")

        const globalWrite = await tool.execute(
          {
            action: "write",
            key: "style",
            value: "concise",
          },
          sessionA,
        )
        const globalData = JSON.parse(globalWrite.output) as { id: string; scope: string }
        expect(globalData.scope).toBe("global")

        const sessionWrite = await tool.execute(
          {
            action: "write",
            key: "branch_policy",
            value: "scratch_only",
            scope: "session",
          },
          sessionA,
        )
        const sessionData = JSON.parse(sessionWrite.output) as { id: string; scope: string }
        expect(sessionData.scope).toBe("session")

        const sessionList = await tool.execute(
          {
            action: "list",
            scope: "all",
          },
          sessionA,
        )
        const sessionListData = JSON.parse(sessionList.output) as { preferences: Array<{ key: string; scope: string }> }
        expect(sessionListData.preferences.some((item) => item.key === "style" && item.scope === "global")).toBe(true)
        expect(sessionListData.preferences.some((item) => item.key === "branch_policy" && item.scope === "session")).toBe(
          true,
        )

        const otherList = await tool.execute(
          {
            action: "list",
            scope: "all",
          },
          sessionB,
        )
        const otherListData = JSON.parse(otherList.output) as { preferences: Array<{ key: string }> }
        expect(otherListData.preferences.some((item) => item.key === "style")).toBe(true)
        expect(otherListData.preferences.some((item) => item.key === "branch_policy")).toBe(false)

        const prompt = Preference.systemPromptSection({
          projectID: Instance.project.id,
          sessionID: sessionA.sessionID,
        })
        expect(prompt).toContain("Global preferences")
        expect(prompt).toContain("Session preferences")

        const del = await tool.execute(
          {
            action: "delete",
            key: "branch_policy",
            scope: "session",
          },
          sessionA,
        )
        expect(del.title).toContain("Deleted preference")
      },
    })
  })

  test("blocks mutating preference actions in plan mode", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PreferenceTool.init()
        const planCtx = {
          ...ctx("ses_plan_preference"),
          agent: "plan",
          extra: { planMode: true },
        }

        await expect(
          tool.execute(
            {
              action: "write",
              key: "style",
              value: "verbose",
            },
            planCtx,
          ),
        ).rejects.toThrow("preference.write is disabled in plan mode")

        await expect(
          tool.execute(
            {
              action: "delete",
              key: "style",
            },
            planCtx,
          ),
        ).rejects.toThrow("preference.delete is disabled in plan mode")
      },
    })
  })

  test("materializes cwd preferences locally and allows editing or deleting them", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, ".opencorvus", "preferences.json")
        const rows = Preference.manageable({ projectID: Instance.project.id })
        const cwd = rows.filter((item) => item.scope === "cwd")

        expect(existsSync(file)).toBe(true)
        expect(cwd.length).toBeGreaterThan(0)

        const first = cwd[0]!
        expect(readFileSync(file, "utf8")).toContain(first.key)

        Preference.update({
          preferenceID: first.id,
          key: "cwd_style",
          value: "keep the diff minimal",
        })

        const updated = Preference.manageable({ projectID: Instance.project.id }).find((item) => item.key === "cwd_style")
        expect(updated?.scope).toBe("cwd")
        expect(readFileSync(file, "utf8")).toContain("cwd_style")

        Preference.remove(updated!.id)
        expect(Preference.manageable({ projectID: Instance.project.id }).some((item) => item.id === updated!.id)).toBe(false)
        expect(readFileSync(file, "utf8")).not.toContain("cwd_style")
      },
    })
  })
})
