import { Database, desc, eq, sql } from "@/storage/db"
import { MemoryFileTable, MemoryChunkTable, type MemoryScope } from "./memory.sql"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { MemorySearch } from "./search"

export namespace Memory {
  const log = Log.create({ service: "memory" })

  export type Scope = MemoryScope
  export type QueryScope = Scope | "all"

  export interface MemoryFile {
    id: string
    projectId: string
    sessionID?: string
    scope: Scope
    title: string
    source: "agent" | "compaction" | "user"
    timeCreated: number
    timeUpdated: number
  }

  export interface MemoryChunk {
    id: string
    fileId: string
    projectId: string
    content: string
    tokenCount: number
    timeCreated: number
    timeUpdated: number
  }

  export interface SearchResult {
    chunkId: string
    fileId: string
    fileTitle: string
    content: string
    scope: Scope
    sessionID?: string
    score: number
    timeCreated: number
  }

  function fromFile(row: typeof MemoryFileTable.$inferSelect): MemoryFile {
    return {
      id: row.id,
      projectId: row.project_id,
      sessionID: row.session_id ?? undefined,
      scope: row.scope,
      title: row.title,
      source: row.source as "agent" | "compaction" | "user",
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  function estimateTokens(text: string) {
    return Math.ceil(text.length / 4)
  }

  function splitChunks(markdown: string, maxTokens = 400) {
    const sections = markdown.split(/^(?=## )/m)
    const chunks: string[] = []
    for (const section of sections) {
      const trimmed = section.trim()
      if (!trimmed) continue
      if (estimateTokens(trimmed) <= maxTokens) {
        chunks.push(trimmed)
        continue
      }
      const paragraphs = trimmed.split(/\n\n+/)
      let current = ""
      for (const para of paragraphs) {
        const next = current ? current + "\n\n" + para : para
        if (estimateTokens(next) > maxTokens && current) {
          chunks.push(current)
          current = para
          continue
        }
        current = next
      }
      if (current) chunks.push(current)
    }
    return chunks.length > 0 ? chunks : [markdown.trim()]
  }

  function ftsInsert(chunkId: string, projectId: string, content: string) {
    try {
      Database.use((db) =>
        db.run(
          sql`INSERT INTO memory_fts (content, chunk_id, project_id) VALUES (${content}, ${chunkId}, ${projectId})`,
        ),
      )
    } catch (err) {
      log.warn("FTS insert failed (FTS5 may not be available)", { chunkId, err })
    }
  }

  function ftsDelete(chunkId: string) {
    try {
      Database.use((db) => db.run(sql`DELETE FROM memory_fts WHERE chunk_id = ${chunkId}`))
    } catch (err) {
      log.warn("FTS delete failed", { chunkId, err })
    }
  }

  function ftsDeleteByFile(fileId: string) {
    try {
      const chunkIds = Database.use((db) =>
        db.select({ id: MemoryChunkTable.id }).from(MemoryChunkTable).where(eq(MemoryChunkTable.file_id, fileId)).all(),
      )
      for (const { id } of chunkIds) {
        ftsDelete(id)
      }
    } catch (err) {
      log.warn("FTS delete by file failed", { fileId, err })
    }
  }

  export function createFile(input: {
    title: string
    source: "agent" | "compaction" | "user"
    projectId: string
    scope?: Scope
    sessionID?: string
  }) {
    const scope = input.scope ?? "global"
    if (scope === "session" && !input.sessionID) {
      throw new Error("sessionID is required when creating a session-scoped memory")
    }
    const id = Identifier.ascending("memory")
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(MemoryFileTable)
        .values({
          id,
          project_id: input.projectId,
          session_id: scope === "session" ? input.sessionID! : null,
          scope,
          title: input.title,
          source: input.source,
        })
        .run(),
    )
    log.info("created memory file", {
      id,
      title: input.title,
      scope,
      source: input.source,
      sessionID: input.sessionID,
    })
    return {
      id,
      projectId: input.projectId,
      sessionID: scope === "session" ? input.sessionID : undefined,
      scope,
      title: input.title,
      source: input.source,
      timeCreated: now,
      timeUpdated: now,
    } satisfies MemoryFile
  }

  export function writeChunks(fileId: string, projectId: string, markdown: string) {
    const texts = splitChunks(markdown)
    const chunks: MemoryChunk[] = []

    ftsDeleteByFile(fileId)

    Database.transaction((db) => {
      db.delete(MemoryChunkTable).where(eq(MemoryChunkTable.file_id, fileId)).run()
      for (const text of texts) {
        const id = Identifier.ascending("memchunk")
        const tokenCount = estimateTokens(text)
        db.insert(MemoryChunkTable)
          .values({
            id,
            file_id: fileId,
            project_id: projectId,
            content: text,
            token_count: tokenCount,
          })
          .run()
        chunks.push({
          id,
          fileId,
          projectId,
          content: text,
          tokenCount,
          timeCreated: Date.now(),
          timeUpdated: Date.now(),
        })
      }
    })

    for (const chunk of chunks) {
      ftsInsert(chunk.id, projectId, chunk.content)
    }

    log.info("wrote memory chunks", { fileId, count: chunks.length })
    return chunks
  }

  export function search(input: {
    query: string
    projectId: string
    sessionID?: string
    scope?: QueryScope
    limit?: number
    minScore?: number
  }) {
    return MemorySearch.search(input)
  }

  export function listFiles(input: { projectId: string; sessionID?: string; scope?: QueryScope }) {
    const scope = input.scope ?? "all"
    const rows = Database.use((db) =>
      db
        .select()
        .from(MemoryFileTable)
        .where(eq(MemoryFileTable.project_id, input.projectId))
        .orderBy(desc(MemoryFileTable.time_updated), desc(MemoryFileTable.time_created))
        .all(),
    )
    return rows
      .map(fromFile)
      .filter((row) => {
        if (scope === "global") return row.scope === "global"
        if (scope === "session") return row.scope === "session" && row.sessionID === input.sessionID
        if (row.scope === "global") return true
        return row.sessionID === input.sessionID
      })
  }

  export function getFile(fileId: string) {
    const row = Database.use((db) => db.select().from(MemoryFileTable).where(eq(MemoryFileTable.id, fileId)).get())
    if (!row) return null
    return fromFile(row)
  }

  export function getChunks(fileId: string) {
    const rows = Database.use((db) =>
      db.select().from(MemoryChunkTable).where(eq(MemoryChunkTable.file_id, fileId)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      fileId: row.file_id,
      projectId: row.project_id,
      content: row.content,
      tokenCount: row.token_count,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }))
  }

  export function deleteFile(fileId: string) {
    ftsDeleteByFile(fileId)
    Database.transaction((db) => {
      db.delete(MemoryChunkTable).where(eq(MemoryChunkTable.file_id, fileId)).run()
      db.delete(MemoryFileTable).where(eq(MemoryFileTable.id, fileId)).run()
    })
    log.info("deleted memory file", { fileId })
  }
}
