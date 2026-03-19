import { Database, sql } from "@/storage/db"
import { Log } from "@/util/log"
import type { Memory } from "./index"

export namespace MemorySearch {
  const log = Log.create({ service: "memory.search" })

  const HALF_LIFE_DAYS = 30
  const LAMBDA = Math.LN2 / HALF_LIFE_DAYS
  const KIND_WEIGHT: Record<Memory.Kind, number> = {
    profile: 1.45,
    lesson: 1.25,
    fact: 1.1,
    note: 0.95,
    episode: 0.8,
  }

  export function search(input: {
    query: string
    projectId: string
    sessionID?: string
    scope?: Memory.QueryScope
    limit?: number
    minScore?: number
    temporalDecay?: boolean
    kinds?: Memory.Kind[]
    sources?: Memory.Source[]
  }) {
    const limit = input.limit ?? 6
    const minScore = input.minScore ?? 0.1
    const prepared = buildFtsQuery(input.query)
    const scope = input.scope ?? "all"

    if (!prepared) {
      log.info("empty search query after tokenization")
      return []
    }
    if (scope === "session" && !input.sessionID) {
      log.info("session-scoped memory search skipped without sessionID", { query: input.query })
      return []
    }

    try {
      return searchFts({
        query: prepared.query,
        tokens: prepared.tokens,
        projectId: input.projectId,
        sessionID: input.sessionID,
        scope,
        limit,
        minScore,
        temporalDecay: input.temporalDecay ?? false,
        kinds: input.kinds,
        sources: input.sources,
      })
    } catch (err) {
      log.warn("FTS search failed, falling back to LIKE", { err })
      return searchLike({
        tokens: prepared.tokens,
        projectId: input.projectId,
        sessionID: input.sessionID,
        scope,
        limit,
        kinds: input.kinds,
        sources: input.sources,
      })
    }
  }

  function searchFts(input: {
    query: string
    tokens: string[]
    projectId: string
    sessionID?: string
    scope: Memory.QueryScope
    limit: number
    minScore: number
    temporalDecay: boolean
    kinds?: Memory.Kind[]
    sources?: Memory.Source[]
  }) {
    // Checkpoint WAL before FTS to prevent slow queries when WAL is large
    Database.checkpoint()
    const nowMs = Date.now()
    const candidates = Math.min(200, input.limit * 6)
    const rows = Database.use((db) =>
      db.all<{
        chunk_id: string
        file_id: string
        title: string
        content: string
        scope: Memory.Scope
        session_id: string | null
        source: Memory.Source
        kind: Memory.Kind
        key: string | null
        importance: number
        confidence: number
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
          mf.source,
          mf.kind,
          mf.key,
          mf.importance,
          mf.confidence,
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
      if (!matchesKinds(row.kind, input.kinds)) continue
      if (!matchesSources(row.source, input.sources)) continue

      const coverage = tokenCoverage(row.title, row.content, input.tokens)
      if (coverage === 0) continue
      let score = bm25RankToScore(row.rank)
      score *= 0.2 + coverage * 0.8
      score *= KIND_WEIGHT[row.kind]
      score *= 0.8 + clampScore(row.importance, 60) / 200
      score *= 0.85 + clampScore(row.confidence, 75) / 250
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
        source: row.source,
        kind: row.kind,
        key: row.key ?? undefined,
        importance: clampScore(row.importance, 60),
        confidence: clampScore(row.confidence, 75),
        score,
        timeCreated: row.time_created,
      })
    }

    results.sort(compareResults)
    const final = results.slice(0, input.limit)
    log.info("FTS search", {
      query: input.query,
      projectId: input.projectId,
      scope: input.scope,
      kinds: input.kinds?.join(","),
      found: final.length,
      candidates: rows.length,
    })
    return final
  }

  function searchLike(input: {
    tokens: string[]
    projectId: string
    sessionID?: string
    scope: Memory.QueryScope
    limit: number
    kinds?: Memory.Kind[]
    sources?: Memory.Source[]
  }) {
    const rows = Database.use((db) =>
      db.all<{
        chunk_id: string
        file_id: string
        title: string
        content: string
        scope: Memory.Scope
        session_id: string | null
        source: Memory.Source
        kind: Memory.Kind
        key: string | null
        importance: number
        confidence: number
        time_created: number
      }>(sql`
        SELECT
          mc.id as chunk_id,
          mc.file_id,
          mf.title,
          mc.content,
          mf.scope,
          mf.session_id,
          mf.source,
          mf.kind,
          mf.key,
          mf.importance,
          mf.confidence,
          mc.time_created
        FROM memory_chunk mc
        JOIN memory_file mf ON mf.id = mc.file_id
        WHERE mc.project_id = ${input.projectId}
        ORDER BY mc.time_created DESC
        LIMIT ${Math.max(input.limit * 18, 80)}
      `),
    )

    return rows
      .filter((row) => matchesScope(row.scope, row.session_id ?? undefined, input.scope, input.sessionID))
      .filter((row) => matchesKinds(row.kind, input.kinds))
      .filter((row) => matchesSources(row.source, input.sources))
      .map((row) => ({
        row,
        coverage: tokenCoverage(row.title, row.content, input.tokens),
      }))
      .filter((item) => item.coverage > 0)
      .map(({ row, coverage }, idx) => ({
        chunkId: row.chunk_id,
        fileId: row.file_id,
        fileTitle: row.title,
        content: row.content,
        scope: row.scope,
        sessionID: row.session_id ?? undefined,
        source: row.source,
        kind: row.kind,
        key: row.key ?? undefined,
        importance: clampScore(row.importance, 60),
        confidence: clampScore(row.confidence, 75),
        score:
          (1 - idx * 0.04) *
          (0.2 + coverage * 0.8) *
          KIND_WEIGHT[row.kind] *
          (0.8 + clampScore(row.importance, 60) / 200) *
          (0.85 + clampScore(row.confidence, 75) / 250),
        timeCreated: row.time_created,
      }))
      .sort(compareResults)
      .slice(0, input.limit)
  }

  function compareResults(a: Memory.SearchResult, b: Memory.SearchResult) {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score
    if (a.scope !== b.scope) return a.scope === "session" ? -1 : 1
    if (a.kind !== b.kind) return KIND_WEIGHT[b.kind] - KIND_WEIGHT[a.kind]
    return b.timeCreated - a.timeCreated
  }

  function matchesKinds(kind: Memory.Kind, kinds: Memory.Kind[] | undefined) {
    if (!kinds || kinds.length === 0) return true
    return kinds.includes(kind)
  }

  function matchesSources(source: Memory.Source, sources: Memory.Source[] | undefined) {
    if (!sources || sources.length === 0) return true
    return sources.includes(source)
  }

  function clampScore(value: number | undefined, fallback: number) {
    if (typeof value !== "number" || Number.isNaN(value)) return fallback
    return Math.max(0, Math.min(100, Math.round(value)))
  }

  function bm25RankToScore(rank: number) {
    const x = Math.abs(rank)
    return 1 / (1 + Math.exp(-(x - 1.0) * 1.5))
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

  function tokenCoverage(title: string, content: string, tokens: string[]) {
    if (tokens.length === 0) return 0
    const haystack = `${title}\n${content}`.toLowerCase()
    const matched = tokens.filter((token) => haystack.includes(token)).length
    return matched / tokens.length
  }

  function buildFtsQuery(raw: string) {
    const tokens = [...new Set(raw.match(/[\p{L}\p{N}_]+/gu)?.map((token) => token.toLowerCase()) ?? [])]
    if (tokens.length === 0) return
    return {
      tokens,
      query: tokens.map((token) => `"${token}"*`).join(" OR "),
    }
  }
}
