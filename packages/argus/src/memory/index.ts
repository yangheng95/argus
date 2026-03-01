import { Database, eq, desc, sql } from "@/storage/db"
import { MemoryFileTable, MemoryChunkTable } from "./memory.sql"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { MemorySearch } from "./search"

/**
 * Persistent memory store.
 *
 * Architecture reference: OpenClaw MemoryIndexManager
 * - FTS5 is a direct content table (no triggers, no content_rowid)
 * - Sync between memory_chunk and memory_fts is manual via raw SQL
 * - Chunk splitting: markdown heading + paragraph based, ~400 tokens per chunk
 */
export namespace Memory {
  const log = Log.create({ service: "memory" })

  export interface MemoryFile {
    id: string
    projectId: string
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
    score: number
    timeCreated: number
  }

  /**
   * Token estimate: ~4 chars per token for mixed English/Chinese text.
   * Reference: OpenClaw uses the same 4x multiplier.
   */
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Split markdown by ## headings, then by paragraph if still too large.
   * Default chunk size: 400 tokens (~1600 chars), matching OpenClaw default.
   */
  function splitChunks(markdown: string, maxTokens = 400): string[] {
    const sections = markdown.split(/^(?=## )/m)
    const chunks: string[] = []
    for (const section of sections) {
      const trimmed = section.trim()
      if (!trimmed) continue
      if (estimateTokens(trimmed) <= maxTokens) {
        chunks.push(trimmed)
        continue
      }
      // Split by double newlines (paragraphs)
      const paragraphs = trimmed.split(/\n\n+/)
      let current = ""
      for (const para of paragraphs) {
        const next = current ? current + "\n\n" + para : para
        if (estimateTokens(next) > maxTokens && current) {
          chunks.push(current)
          current = para
        } else {
          current = next
        }
      }
      if (current) chunks.push(current)
    }
    return chunks.length > 0 ? chunks : [markdown.trim()]
  }

  /** Insert a chunk into the FTS5 table (direct content, no triggers). */
  function ftsInsert(chunkId: string, projectId: string, content: string): void {
    try {
      Database.use((db) =>
        db.run(sql`INSERT INTO memory_fts (content, chunk_id, project_id) VALUES (${content}, ${chunkId}, ${projectId})`),
      )
    } catch (err) {
      log.warn("FTS insert failed (FTS5 may not be available)", { chunkId, err })
    }
  }

  /** Delete a chunk from the FTS5 table by chunk_id. */
  function ftsDelete(chunkId: string): void {
    try {
      Database.use((db) =>
        db.run(sql`DELETE FROM memory_fts WHERE chunk_id = ${chunkId}`),
      )
    } catch (err) {
      log.warn("FTS delete failed", { chunkId, err })
    }
  }

  /** Delete all FTS entries for chunks of a given file. */
  function ftsDeleteByFile(fileId: string): void {
    try {
      // Get all chunk IDs for this file, then delete from FTS
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
  }): MemoryFile {
    const id = Identifier.ascending("memory")
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(MemoryFileTable)
        .values({
          id,
          project_id: input.projectId,
          title: input.title,
          source: input.source,
        })
        .run(),
    )
    log.info("created memory file", { id, title: input.title, source: input.source })
    return {
      id,
      projectId: input.projectId,
      title: input.title,
      source: input.source,
      timeCreated: now,
      timeUpdated: now,
    }
  }

  export function writeChunks(fileId: string, projectId: string, markdown: string): MemoryChunk[] {
    const texts = splitChunks(markdown)
    const chunks: MemoryChunk[] = []

    // Clear existing FTS entries for this file's chunks
    ftsDeleteByFile(fileId)

    Database.transaction((db) => {
      // Clear existing chunks for this file
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

    // Insert into FTS after chunk records are committed
    for (const chunk of chunks) {
      ftsInsert(chunk.id, projectId, chunk.content)
    }

    log.info("wrote memory chunks", { fileId, count: chunks.length })
    return chunks
  }

  export function search(input: {
    query: string
    projectId: string
    limit?: number
    minScore?: number
  }): SearchResult[] {
    return MemorySearch.search(input)
  }

  export function listFiles(projectId: string): MemoryFile[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(MemoryFileTable)
        .where(eq(MemoryFileTable.project_id, projectId))
        .orderBy(desc(MemoryFileTable.time_created))
        .all(),
    )
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      source: r.source as "agent" | "compaction" | "user",
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
    }))
  }

  export function getFile(fileId: string): MemoryFile | null {
    const row = Database.use((db) =>
      db.select().from(MemoryFileTable).where(eq(MemoryFileTable.id, fileId)).get(),
    )
    if (!row) return null
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      source: row.source as "agent" | "compaction" | "user",
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  export function getChunks(fileId: string): MemoryChunk[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(MemoryChunkTable)
        .where(eq(MemoryChunkTable.file_id, fileId))
        .all(),
    )
    return rows.map((r) => ({
      id: r.id,
      fileId: r.file_id,
      projectId: r.project_id,
      content: r.content,
      tokenCount: r.token_count,
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
    }))
  }

  export function deleteFile(fileId: string): void {
    // Delete FTS entries first (before cascade removes chunks)
    ftsDeleteByFile(fileId)
    Database.transaction((db) => {
      db.delete(MemoryChunkTable).where(eq(MemoryChunkTable.file_id, fileId)).run()
      db.delete(MemoryFileTable).where(eq(MemoryFileTable.id, fileId)).run()
    })
    log.info("deleted memory file", { fileId })
  }
}
