import { Database, sql } from "@/storage/db"
import { Log } from "@/util/log"
import type { Memory } from "./index"

/**
 * FTS5-based memory search with optional temporal decay.
 *
 * Architecture reference: OpenClaw MemoryIndexManager.search()
 * - BM25 score normalization: 1 / (1 + abs(rank)) → [0, 1]
 * - Temporal decay: exp(-lambda * age_days), half-life 30 days (off by default)
 * - Defaults: maxResults=6, minScore=0.35
 * - Fallback: LIKE search when FTS5 is unavailable
 */
export namespace MemorySearch {
  const log = Log.create({ service: "memory.search" })

  /** Default half-life for temporal decay (days). Matches OpenClaw default. */
  const HALF_LIFE_DAYS = 30
  const LAMBDA = Math.LN2 / HALF_LIFE_DAYS

  export function search(input: {
    query: string
    projectId: string
    limit?: number
    minScore?: number
    temporalDecay?: boolean
  }): Memory.SearchResult[] {
    const limit = input.limit ?? 6
    const minScore = input.minScore ?? 0.1
    const query = buildFtsQuery(input.query)

    if (!query) {
      log.info("empty search query after tokenization")
      return []
    }

    try {
      return searchFts(query, input.projectId, limit, minScore, input.temporalDecay ?? false)
    } catch (err) {
      log.warn("FTS search failed, falling back to LIKE", { err })
      return searchLike(input.query, input.projectId, limit)
    }
  }

  function searchFts(
    query: string,
    projectId: string,
    limit: number,
    minScore: number,
    temporalDecay: boolean,
  ): Memory.SearchResult[] {
    const nowMs = Date.now()
    // Fetch more candidates than needed for post-filtering (OpenClaw: candidateMultiplier=4)
    const candidates = Math.min(200, limit * 4)

    // FTS5 direct content table: join on chunk_id (UNINDEXED column in memory_fts)
    const rows = Database.use((db) =>
      db.all<{
        chunk_id: string
        file_id: string
        title: string
        content: string
        time_created: number
        rank: number
      }>(sql`
        SELECT
          mc.id as chunk_id,
          mc.file_id,
          mf.title,
          mc.content,
          mc.time_created,
          memory_fts.rank as rank
        FROM memory_fts
        JOIN memory_chunk mc ON mc.id = memory_fts.chunk_id
        JOIN memory_file mf ON mf.id = mc.file_id
        WHERE memory_fts MATCH ${query}
          AND memory_fts.project_id = ${projectId}
        ORDER BY memory_fts.rank
        LIMIT ${candidates}
      `),
    )

    const results: Memory.SearchResult[] = []
    for (const row of rows) {
      // OpenClaw BM25 normalization: rank is negative, convert to [0, 1]
      let score = bm25RankToScore(row.rank)

      // Optional temporal decay (OpenClaw: off by default, half-life 30 days)
      if (temporalDecay) {
        const ageDays = (nowMs - row.time_created) / (1000 * 60 * 60 * 24)
        score *= Math.exp(-LAMBDA * ageDays)
      }

      if (score < minScore) continue

      results.push({
        chunkId: row.chunk_id,
        fileId: row.file_id,
        fileTitle: row.title,
        content: row.content,
        score,
        timeCreated: row.time_created,
      })
    }

    results.sort((a, b) => b.score - a.score)
    const final = results.slice(0, limit)
    log.info("FTS search", { query, projectId, found: final.length, candidates: rows.length })
    return final
  }

  /**
   * Convert FTS5 BM25 rank to a [0, 1] score.
   *
   * FTS5 rank is negative (more negative = better match).
   * Original formula `1/(1+|rank|)` yields very low scores on small corpora
   * because BM25 IDF approaches 0 when N ≈ n. Use a sigmoid that maps
   * the typical rank range (-0.1 … -10) to (0.5 … 0.99) more evenly.
   */
  function bm25RankToScore(rank: number): number {
    // sigmoid: 1 / (1 + e^(-(|rank| - midpoint) * steepness))
    // midpoint=1.0 means rank=-1.0 → score=0.5; steepness=1.5 keeps the curve smooth
    const x = Math.abs(rank)
    return 1 / (1 + Math.exp(-(x - 1.0) * 1.5))
  }

  /** Fallback LIKE-based search when FTS5 is unavailable. */
  function searchLike(
    query: string,
    projectId: string,
    limit: number,
  ): Memory.SearchResult[] {
    const pattern = `%${query}%`
    const rows = Database.use((db) =>
      db.all<{
        chunk_id: string
        file_id: string
        title: string
        content: string
        time_created: number
      }>(sql`
        SELECT
          mc.id as chunk_id,
          mc.file_id,
          mf.title,
          mc.content,
          mc.time_created
        FROM memory_chunk mc
        JOIN memory_file mf ON mf.id = mc.file_id
        WHERE mc.content LIKE ${pattern}
          AND mc.project_id = ${projectId}
        ORDER BY mc.time_created DESC
        LIMIT ${limit}
      `),
    )

    return rows.map((row, idx) => ({
      chunkId: row.chunk_id,
      fileId: row.file_id,
      fileTitle: row.title,
      content: row.content,
      score: 1 - idx * 0.05,
      timeCreated: row.time_created,
    }))
  }

  /**
   * Build FTS5 MATCH query from raw text.
   * Reference: OpenClaw buildFtsQuery()
   * Tokenizes with Unicode word chars, wraps each in quotes, joins with AND.
   */
  function buildFtsQuery(raw: string): string {
    const tokens = raw.match(/[\p{L}\p{N}_]+/gu)
    if (!tokens || tokens.length === 0) return ""
    // Wrap each token in double quotes for exact matching, join with implicit AND
    return tokens.map((t) => `"${t}"`).join(" ")
  }
}
