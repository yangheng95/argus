import { Identifier } from "@/id/id"
import { Database, desc, eq } from "@/storage/db"
import { WorkbenchPreferenceTable, type WorkbenchPreferenceScope } from "@/workbench/workbench.sql"

export namespace Preference {
  export type Scope = "global" | "session"
  export type QueryScope = Scope | "all"

  export interface Entry {
    id: string
    projectID: string
    taskID?: string
    sessionID?: string
    userID?: string
    scope: Scope
    key: string
    value: string
    source: string
    confidence: number
    timeCreated: number
    timeUpdated: number
  }

  /**
   * 内置默认偏好列表。
   * 当用户未对同名 key 设置自定义偏好时，这些默认值会自动生效。
   * 用户通过 preference tool 写入同名 key 即可覆盖。
   */
  export const DEFAULTS: ReadonlyArray<{ key: string; value: string }> = [
    {
      key: "problem_solving_approach",
      value: "不要使用补丁或临时方案解决问题，必须从根因和代码上层架构层面彻底解决",
    },
    {
      key: "code_design_principle",
      value: "生成的代码要遵循高内聚低耦合原则：相关逻辑集中在一起，模块间依赖最小化",
    },
    {
      key: "code_comments",
      value: "生成的代码必须附带详细注释，说明意图、逻辑和非显而易见的设计决策",
    },
    {
      key: "readme_policy",
      value: "每个新模块或重要功能变更都要编写 README，内容简洁且信息充分 (concise and informative)",
    },
  ]

  function normalizeScope(scope: WorkbenchPreferenceScope | null | undefined): Scope {
    return scope === "session" ? "session" : "global"
  }

  /** 将内置默认偏好转换为 Entry 结构，source 标记为 "builtin_default" */
  function defaultToEntry(def: { key: string; value: string }, projectID: string): Entry {
    return {
      id: `default:${def.key}`,
      projectID,
      scope: "global",
      key: def.key,
      value: def.value,
      source: "builtin_default",
      confidence: 100,
      timeCreated: 0,
      timeUpdated: 0,
    }
  }

  function fromRow(row: typeof WorkbenchPreferenceTable.$inferSelect): Entry {
    return {
      id: row.id,
      projectID: row.project_id ?? "",
      taskID: row.task_id ?? undefined,
      sessionID: row.session_id ?? undefined,
      userID: row.user_id ?? undefined,
      scope: normalizeScope(row.scope),
      key: row.key,
      value: row.value,
      source: row.source,
      confidence: row.confidence,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  export function get(preferenceID: string) {
    const row = Database.use((db) =>
      db.select().from(WorkbenchPreferenceTable).where(eq(WorkbenchPreferenceTable.id, preferenceID)).get(),
    )
    if (!row) return null
    return fromRow(row)
  }

  export function list(input: { projectID: string; sessionID?: string; scope?: QueryScope }) {
    const scope = input.scope ?? "all"
    const rows = Database.use((db) =>
      db
        .select()
        .from(WorkbenchPreferenceTable)
        .where(eq(WorkbenchPreferenceTable.project_id, input.projectID))
        .orderBy(desc(WorkbenchPreferenceTable.time_updated))
        .all(),
    )
    return rows
      .map(fromRow)
      .filter((row) => {
        if (scope === "global") return row.scope === "global"
        if (scope === "session") return row.scope === "session" && row.sessionID === input.sessionID
        if (row.scope === "global") return true
        return row.sessionID === input.sessionID
      })
      .sort((a, b) => {
        if (a.scope !== b.scope) return a.scope === "global" ? -1 : 1
        return a.key.localeCompare(b.key) || b.timeUpdated - a.timeUpdated
      })
  }

  export function merged(input: { projectID: string; sessionID?: string }) {
    const global = list({
      projectID: input.projectID,
      scope: "global",
    })
    const session = input.sessionID
      ? list({
          projectID: input.projectID,
          sessionID: input.sessionID,
          scope: "session",
        })
      : []
    // 先用默认偏好填充，再用用户设置的 global/session 覆盖
    const merged = new Map<string, Entry>()
    for (const def of DEFAULTS) {
      merged.set(def.key, defaultToEntry(def, input.projectID))
    }
    for (const item of global) {
      merged.set(item.key, item)
    }
    for (const item of session) {
      merged.set(item.key, item)
    }
    return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key))
  }

  export function set(input: {
    projectID: string
    taskID?: string
    sessionID?: string
    userID?: string
    key: string
    value: string
    scope?: Scope
    source?: string
    confidence?: number
  }) {
    const scope = input.scope ?? "global"
    if (scope === "session" && !input.sessionID) {
      throw new Error("sessionID is required when writing a session preference")
    }

    const now = Date.now()
    const existing = Database.use((db) =>
      db
        .select()
        .from(WorkbenchPreferenceTable)
        .where(eq(WorkbenchPreferenceTable.project_id, input.projectID))
        .all()
        .find(
          (row) =>
            row.key === input.key &&
            normalizeScope(row.scope) === scope &&
            (scope === "session" ? row.session_id === input.sessionID : !row.session_id),
        ),
    )

    if (existing) {
      Database.use((db) =>
        db
          .update(WorkbenchPreferenceTable)
          .set({
            task_id: input.taskID ?? existing.task_id,
            session_id: scope === "session" ? input.sessionID! : null,
            user_id: input.userID ?? existing.user_id,
            key: input.key,
            value: input.value,
            source: input.source ?? existing.source,
            confidence: input.confidence ?? existing.confidence,
            time_updated: now,
          })
          .where(eq(WorkbenchPreferenceTable.id, existing.id))
          .run(),
      )
      return get(existing.id)!
    }

    const id = Identifier.ascending("preference")
    Database.use((db) =>
      db
        .insert(WorkbenchPreferenceTable)
        .values({
          id,
          project_id: input.projectID,
          task_id: input.taskID ?? null,
          session_id: scope === "session" ? input.sessionID! : null,
          user_id: input.userID,
          scope,
          key: input.key,
          value: input.value,
          source: input.source ?? "user_message",
          confidence: input.confidence ?? 100,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    return get(id)!
  }

  export function update(input: { preferenceID: string; key: string; value: string }) {
    const row = get(input.preferenceID)
    if (!row) throw new Error(`Preference not found: ${input.preferenceID}`)
    Database.use((db) =>
      db
        .update(WorkbenchPreferenceTable)
        .set({
          key: input.key,
          value: input.value,
          time_updated: Date.now(),
        })
        .where(eq(WorkbenchPreferenceTable.id, input.preferenceID))
        .run(),
    )
    return true
  }

  export function remove(preferenceID: string) {
    const row = get(preferenceID)
    if (!row) throw new Error(`Preference not found: ${preferenceID}`)
    Database.use((db) =>
      db.delete(WorkbenchPreferenceTable).where(eq(WorkbenchPreferenceTable.id, preferenceID)).run(),
    )
    return true
  }

  export function systemPromptSection(input: { projectID: string; sessionID: string }) {
    const global = list({
      projectID: input.projectID,
      scope: "global",
    })
    const session = list({
      projectID: input.projectID,
      sessionID: input.sessionID,
      scope: "session",
    })

    // 合并默认偏好：用户设置的 global/session 同名 key 会覆盖默认值
    const userKeys = new Set([...global.map((item) => item.key), ...session.map((item) => item.key)])
    const activeDefaults = DEFAULTS.filter((def) => !userKeys.has(def.key))

    if (global.length === 0 && session.length === 0 && activeDefaults.length === 0) return null

    const lines = ["<preferences>"]
    if (activeDefaults.length > 0) {
      lines.push("Built-in default preferences (can be overridden by global or session preferences):")
      lines.push(...activeDefaults.map((def) => `- ${def.key}: ${def.value}`))
    }
    if (global.length > 0) {
      if (activeDefaults.length > 0) lines.push("")
      lines.push("Global preferences (default across all sessions in this project):")
      lines.push(...global.map((item) => `- ${item.key}: ${item.value}`))
    }
    if (session.length > 0) {
      if (global.length > 0 || activeDefaults.length > 0) lines.push("")
      lines.push("Session preferences (override global preferences for this session only):")
      lines.push(...session.map((item) => `- ${item.key}: ${item.value}`))
    }
    lines.push("</preferences>")
    lines.push("")
    lines.push("The preferences above are binding. Session preferences override global preferences on the same key. Global preferences override built-in defaults on the same key.")
    return lines.join("\n")
  }
}
