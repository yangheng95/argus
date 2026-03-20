import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Tool } from "./tool"
import z from "zod"

const DESCRIPTION = `Scoped preference store for durable instructions and conventions.

Preferences are concise key-value instructions such as style, lockfile policy, naming conventions, or review preferences.

Actions:
- **list**: Read current active preferences, including project-local cwd defaults plus global/session overrides.
- **write**: Save or update a preference. Defaults to global so it applies across all sessions in this project.
- **delete**: Remove an outdated preference by key and scope.

Session preferences override global preferences on the same key for the current session only. Global preferences override project-local cwd preferences on the same key.`

export const PreferenceTool = Tool.define("preference", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("list"),
      scope: z
        .enum(["all", "global", "session"])
        .optional()
        .describe("Which preference scope to list (default: all)"),
    }),
    z.object({
      action: z.literal("write"),
      key: z.string().describe("Preference key, for example 'style' or 'lockfile_policy'"),
      value: z.string().describe("Preference value"),
      scope: z
        .enum(["global", "session"])
        .optional()
        .describe("Storage scope (default: global)"),
    }),
    z.object({
      action: z.literal("delete"),
      key: z.string().describe("Preference key to delete"),
      scope: z
        .enum(["global", "session"])
        .optional()
        .describe("Which scope to delete from (default: global)"),
    }),
  ]),
  async execute(params, ctx) {
    const projectID = Instance.project.id
    const planMode = ctx.extra?.planMode === true || ctx.agent === "plan"

    await ctx.ask({
      permission: "preference",
      patterns: ["*"],
      always: ["*"],
      metadata: { action: params.action },
    })

    switch (params.action) {
      case "list": {
        const rows = Preference.list({
          projectID,
          sessionID: ctx.sessionID,
          scope: params.scope,
        })
        return {
          title: `${rows.length} preferences`,
          output: JSON.stringify({
            preferences: rows.map((row) => ({
              id: row.id,
              key: row.key,
              value: row.value,
              scope: row.scope,
              sessionID: row.sessionID,
              source: row.source,
              updated: new Date(row.timeUpdated).toISOString(),
            })),
          }),
          metadata: {},
        }
      }

      case "write": {
        if (planMode) {
          throw new Error("preference.write is disabled in plan mode. Only read-only preference actions are allowed.")
        }
        const scope = params.scope ?? "global"
        const row = Preference.set({
          projectID,
          taskID: undefined,
          sessionID: scope === "session" ? ctx.sessionID : undefined,
          key: params.key,
          value: params.value,
          scope,
          source: "agent",
        })
        return {
          title: `Saved preference: ${params.key}`,
          output: JSON.stringify({
            id: row.id,
            key: row.key,
            value: row.value,
            scope: row.scope,
            sessionID: row.sessionID,
          }),
          metadata: {},
        }
      }

      case "delete": {
        if (planMode) {
          throw new Error("preference.delete is disabled in plan mode. Only read-only preference actions are allowed.")
        }
        const scope = params.scope ?? "global"
        const row = Preference.list({
          projectID,
          sessionID: ctx.sessionID,
          scope,
        }).find((item) => item.key === params.key)
        if (!row) {
          return {
            title: "Not found",
            output: JSON.stringify({ error: `Preference ${params.key} not found in ${scope} scope` }),
            metadata: {},
          }
        }
        Preference.remove(row.id)
        return {
          title: `Deleted preference: ${params.key}`,
          output: JSON.stringify({
            deleted: true,
            id: row.id,
            key: row.key,
            scope: row.scope,
            sessionID: row.sessionID,
          }),
          metadata: {},
        }
      }
    }
  },
})
