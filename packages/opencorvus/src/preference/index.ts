import fs from "fs"
import path from "path"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Database, desc, eq } from "@/storage/db"
import { WorkbenchPreferenceTable, type WorkbenchPreferenceScope } from "@/workbench/workbench.sql"

export namespace Preference {
  export type Scope = "cwd" | "global" | "session"
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

  const defaults = {
    template: undefined as Array<{ key: string; value: string }> | undefined,
  }

  function normalizeScope(scope: WorkbenchPreferenceScope | null | undefined): Exclude<Scope, "cwd"> {
    return scope === "session" ? "session" : "global"
  }

  function cwdId(key: string) {
    return `cwd:${encodeURIComponent(key)}`
  }

  function currentProjectID() {
    try {
      return Instance.project.id
    } catch {
      return undefined
    }
  }

  function currentDirectory() {
    try {
      return Instance.directory
    } catch {
      return undefined
    }
  }

  function cwdFile() {
    return path.join(Instance.directory, ".opencorvus", "preferences.json")
  }

  function loadTemplate() {
    if (defaults.template) return defaults.template
    const file = path.join(import.meta.dir, "defaults.json")
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown
      defaults.template = Array.isArray(parsed)
        ? parsed.flatMap((item) => normalizeItem(item))
        : []
    } catch {
      defaults.template = []
    }
    return defaults.template
  }

  function ensureCwdFile() {
    const dir = currentDirectory()
    if (!dir) return undefined
    const file = cwdFile()
    if (fs.existsSync(file)) return file
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(loadTemplate(), null, 2) + "\n")
    return file
  }

  function normalizeItem(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return []
    const row = input as Record<string, unknown>
    const key = typeof row.key === "string" ? row.key.trim() : ""
    const value = typeof row.value === "string" ? row.value.trim() : ""
    if (!key || !value) return []
    return [{ key, value }]
  }

  function readCwd(projectID: string): Entry[] {
    const file = ensureCwdFile()
    if (!file) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      return []
    }
    const stat = fs.statSync(file)
    const rows = new Map<string, { key: string; value: string }>()
    for (const item of Array.isArray(parsed) ? parsed : []) {
      for (const next of normalizeItem(item)) rows.set(next.key, next)
    }
    return [...rows.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((item): Entry => ({
        id: cwdId(item.key),
        projectID,
        taskID: undefined,
        sessionID: undefined,
        userID: undefined,
        scope: "cwd" as const,
        key: item.key,
        value: item.value,
        source: "cwd_default",
        confidence: 100,
        timeCreated: Math.round(stat.birthtimeMs || stat.ctimeMs),
        timeUpdated: Math.round(stat.mtimeMs),
      }))
  }

  function writeCwd(projectID: string, input: Array<{ key: string; value: string }>) {
    const file = ensureCwdFile()
    if (!file) throw new Error("Preference cwd is unavailable")
    const rows = new Map<string, { key: string; value: string }>()
    for (const item of input) {
      for (const next of normalizeItem(item)) rows.set(next.key, next)
    }
    const next = [...rows.values()].sort((a, b) => a.key.localeCompare(b.key))
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
    return readCwd(projectID)
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
    if (preferenceID.startsWith("cwd:")) {
      const projectID = currentProjectID()
      if (!projectID) return null
      return readCwd(projectID).find((row) => row.id === preferenceID) ?? null
    }
    const row = Database.use((db) =>
      db.select().from(WorkbenchPreferenceTable).where(eq(WorkbenchPreferenceTable.id, preferenceID)).get(),
    )
    if (!row) return null
    return fromRow(row)
  }

  export function list(input: { projectID: string; sessionID?: string; scope?: QueryScope }) {
    if (input.scope === "cwd") return readCwd(input.projectID)
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

  export function manageable(input: { projectID: string; sessionID?: string }) {
    const order = {
      cwd: 0,
      global: 1,
      session: 2,
    } as const
    return [...readCwd(input.projectID), ...list(input)]
      .sort((a, b) => order[a.scope] - order[b.scope] || a.key.localeCompare(b.key) || b.timeUpdated - a.timeUpdated)
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
    const merged = new Map<string, Entry>()
    for (const item of readCwd(input.projectID)) merged.set(item.key, item)
    for (const item of global) merged.set(item.key, item)
    for (const item of session) merged.set(item.key, item)
    return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key))
  }

  export function set(input: {
    projectID: string
    taskID?: string
    sessionID?: string
    userID?: string
    key: string
    value: string
    scope?: Exclude<Scope, "cwd">
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
    if (input.preferenceID.startsWith("cwd:")) {
      const projectID = currentProjectID()
      if (!projectID) throw new Error("Preference cwd is unavailable")
      const existing = readCwd(projectID).find((row) => row.id === input.preferenceID)
      if (!existing) throw new Error(`Preference not found: ${input.preferenceID}`)
      writeCwd(projectID, [
        ...readCwd(projectID)
          .filter((row) => row.id !== input.preferenceID)
          .map((row) => ({ key: row.key, value: row.value })),
        { key: input.key, value: input.value },
      ])
      return true
    }
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
    if (preferenceID.startsWith("cwd:")) {
      const projectID = currentProjectID()
      if (!projectID) throw new Error("Preference cwd is unavailable")
      const existing = readCwd(projectID).find((row) => row.id === preferenceID)
      if (!existing) throw new Error(`Preference not found: ${preferenceID}`)
      writeCwd(
        projectID,
        readCwd(projectID)
          .filter((row) => row.id !== preferenceID)
          .map((row) => ({ key: row.key, value: row.value })),
      )
      return true
    }
    const row = get(preferenceID)
    if (!row) throw new Error(`Preference not found: ${preferenceID}`)
    Database.use((db) =>
      db.delete(WorkbenchPreferenceTable).where(eq(WorkbenchPreferenceTable.id, preferenceID)).run(),
    )
    return true
  }

  export function systemPromptSection(input: { projectID: string; sessionID: string }) {
    const cwd = readCwd(input.projectID)
    const global = list({
      projectID: input.projectID,
      scope: "global",
    })
    const session = list({
      projectID: input.projectID,
      sessionID: input.sessionID,
      scope: "session",
    })
    const userKeys = new Set([...global.map((item) => item.key), ...session.map((item) => item.key)])
    const activeCwd = cwd.filter((item) => !userKeys.has(item.key))

    if (activeCwd.length === 0 && global.length === 0 && session.length === 0) return null

    const lines = ["<preferences>"]
    if (activeCwd.length > 0) {
      lines.push("Project-local preferences (managed in .opencorvus/preferences.json):")
      lines.push(...activeCwd.map((item) => `- ${item.key}: ${item.value}`))
    }
    if (global.length > 0) {
      if (activeCwd.length > 0) lines.push("")
      lines.push("Global preferences (default across all sessions in this project):")
      lines.push(...global.map((item) => `- ${item.key}: ${item.value}`))
    }
    if (session.length > 0) {
      if (global.length > 0 || activeCwd.length > 0) lines.push("")
      lines.push("Session preferences (override global preferences for this session only):")
      lines.push(...session.map((item) => `- ${item.key}: ${item.value}`))
    }
    lines.push("</preferences>")
    lines.push("")
    lines.push("The preferences above are binding. Session preferences override global preferences on the same key. Global preferences override project-local preferences on the same key.")
    return lines.join("\n")
  }
}
