import { and, Database, eq, like } from "@/storage/db"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "@/engine/engine.sql"
import { SessionTable } from "@/session/session.sql"

export type RuntimePathIDKind = "task" | "goal" | "run" | "session"

function isFullIDSegment(segment: string): boolean {
  const separator = segment.lastIndexOf("_")
  if (separator <= 0 || separator === segment.length - 1) {
    throw new Error(`Invalid runtime ID path segment: ${segment}`)
  }
  return segment.length - separator - 1 > 8
}

function assertOne(kind: RuntimePathIDKind, segment: string, rows: Array<{ id: string }>): string {
  if (rows.length !== 1) {
    throw new Error(`Runtime ${kind} path segment ${segment} matched ${rows.length} database rows`)
  }
  return rows[0]!.id
}

export namespace RuntimePathIDLookup {
  export function resolve(kind: RuntimePathIDKind, segment: string): string {
    switch (kind) {
      case "task":
        return task(segment)
      case "goal":
        return goal(segment)
      case "run":
        return run(segment)
      case "session":
        return session(segment)
    }
  }

  export function task(segment: string): string {
    const rows = Database.use((db) =>
      db.select({ id: EngineTaskTable.id })
        .from(EngineTaskTable)
        .where(isFullIDSegment(segment) ? eq(EngineTaskTable.id, segment) : like(EngineTaskTable.id, `${segment}%`))
        .all(),
    )
    return assertOne("task", segment, rows)
  }

  export function goal(segment: string): string {
    const rows = Database.use((db) =>
      db.select({ id: EngineGoalTable.id })
        .from(EngineGoalTable)
        .where(isFullIDSegment(segment) ? eq(EngineGoalTable.id, segment) : like(EngineGoalTable.id, `${segment}%`))
        .all(),
    )
    return assertOne("goal", segment, rows)
  }

  export function run(segment: string): string {
    const idMatch = isFullIDSegment(segment) ? eq(EngineArtifactTable.id, segment) : like(EngineArtifactTable.id, `${segment}%`)
    const rows = Database.use((db) =>
      db.select({ id: EngineArtifactTable.id })
        .from(EngineArtifactTable)
        .where(and(eq(EngineArtifactTable.kind, "run"), idMatch))
        .all(),
    )
    return assertOne("run", segment, rows)
  }

  export function session(segment: string): string {
    const rows = Database.use((db) =>
      db.select({ id: SessionTable.id })
        .from(SessionTable)
        .where(isFullIDSegment(segment) ? eq(SessionTable.id, segment) : like(SessionTable.id, `${segment}%`))
        .all(),
    )
    return assertOne("session", segment, rows)
  }
}
