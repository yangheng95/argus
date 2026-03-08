import { Database, sql } from "@/storage/db"
import { Log } from "@/util/log"
import type { Memory } from "./index"

export namespace MemorySearch {
  const log = Log.create({ service: "memory.search" })

  const HALF_LIFE_DAYS = 30
  const LAMBDA = Math.LN2 / HALF_LIFE_DAYS

  export function search(input: {
    query: string
    projectId: string
    sessionID?: string
    scope?: Memory.QueryScope
    limit?: number
    minScore?: number
    temporalDecay?: boolean
  }) {
    const limit = input.limit ?? 6
    const minScore = input.minScore ?? 0.1
    const query = buildFtsQuery(input.query)
    const scope = input.scope ?? "all"

    if (!query) {
      log.info("empty search query after tokenization")
      return []
    }
    if (scope === "session" && !input.sessionID) {
      log.info("session-scoped memory search skipped without sessionID", { query })
      return []
    }

    try {
      return searchFts({
        query,
        projectId: input.projectId,
        sessionID: input.sessionID,
        scope,
        limit,
        minScore,
        temporalDecay: input.temporalDecay ?? false,
      })
    } catch (err) {
      log.warn("FTS search failed, falling back to LIKE", { err })
      return searchLike({
        query: input.query,
        projectId: input.projectId,
        sessionID: input.sessionID,
        scope,
        limit,
      })
    }
  }

  function searchFts(input: {
    query: string
    projectId: string
    sessionID?: string
    scope: Memory.QueryScope
    limit: number
    minScore: number
    temporalDecay: boolean
  }) {
    const nowMs = Date.now()
    const candidates = Math.min(200, input.limit * 4)

    const rows = Database.use((db) =>
      db.all<{
        chunk_id: string
        file_id: string
        title: string
        content: string
        scope: Memory.Scope
        session_id: string | null
        time_created: number
        rank: number
      }>(sql`
        SELECT
          mc.id as chunk_id,
          mc.file_id,
          mf.title,
          mc.content,
          mf.scope,
          mf.session_id,
          mc.time_created,
          memory_fts.rank as rank
        FROM memory_fts
        JOIN memory_chunk mc ON mc.id = memory_fts.chunk_id
        JOIN memory_file mf ON mf.id = mc.file_id
        WHERE memory_fts MATCH ${input.query}
          AND memory_fts.project_id = ${input.projectId}
        ORDER BY memory_fts.rank
        LIMIT ${candidates}
      `),
    )

    const results: Memory.SearchResult[] = []
    for (const row of rows) {
      if (!matchesScope(row.scope, row.session_id ?? undefined, input.scope, input.sessionID)) continue

      let score = bm25RankToScore(row.rank)
      if (input.temporalDecay) {
        const ageDays = (nowMs - row.time_created) / (1000 * 60 * 60 * 24)
        score *= Math.exp(-LAMBDA * ageDays)
      }
      if (score < input.minScore) continue

      results.push({
        chunkId: row.chunk_id,
        fileId: row.file_id,
        fileTitle: row.title,
        content: row.content,
        scope: row.scope,
        sessionID: row.session_id ?? undefined,
        score,
        timeCreated: row.time_created,
      })
    }

    results.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "session" ? -1 : 1
      return b.score - a.score
    })

    const final = results.slice(0, input.limit)
    log.info("FTS search", {
      query: input.query,
      projectId: input.projectId,
      scope: input.scope,
      found: final.length,
      candidates: rows.length,
    })
    return final
  }

  function bm25RankToScore(rank: number) {
    const x = Math.abs(rank)
    return 1 / (1 + Math.exp(-(x - 1.0) * 1.5))
  }

  function searchLike(input: {
    query: string
    projectId: string
    sessionID?: string
    scope: Memory.QueryScope
    limit: number
  }) {
    const pattern = `%${input.query}%`
    const rows = Database.use((db) =>
      db.all<{
        chunk_id: string
        file_id: string
        title: string
        content: string
        scope: Memory.Scope
        session_id: string | null
        time_created: number
      }>(sql`
        SELECT
          mc.id as chunk_id,
          mc.file_id,
          mf.title,
          mc.content,
          mf.scope,
          mf.session_id,
          mc.time_created
        FROM memory_chunk mc
        JOIN memory_file mf ON mf.id = mc.file_id
        WHERE mc.content LIKE ${pattern}
          AND mc.project_id = ${input.projectId}
        ORDER BY mc.time_created DESC
        LIMIT ${Math.max(input.limit * 4, 20)}
      `),
    )

    return rows
      .filter((row) => matchesScope(row.scope, row.session_id ?? undefined, input.scope, input.sessionID))
      .slice(0, input.limit)
      .map((row, idx) => ({
        chunkId: row.chunk_id,
        fileId: row.file_id,
        fileTitle: row.title,
        content: row.content,
        scope: row.scope,
        sessionID: row.session_id ?? undefined,
        score: 1 - idx * 0.05,
        timeCreated: row.time_created,
      }))
  }

  function matchesScope(
    rowScope: Memory.Scope,
    rowSessionID: string | undefined,
    queryScope: Memory.QueryScope,
    sessionID: string | undefined,
  ) {
    if (queryScope === "global") return rowScope === "global"
    if (queryScope === "session") return rowScope === "session" && rowSessionID === sessionID
    if (rowScope === "global") return true
    return rowSessionID === sessionID
  }

  function buildFtsQuery(raw: string) {
    const tokens = raw.match(/[\p{L}\p{N}_]+/gu)
    if (!tokens || tokens.length === 0) return ""
    return tokens.map((token) => `"${token}"`).join(" ")
  }
}
