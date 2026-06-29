import { Database, sql, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { MemoryFileTable } from "./memory.sql"
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

  /**
   * Cold-start guard: when a project has zero memory entries, every
   * `memory.search` call from every stage agent at task start ends up
   * doing the full FTS pipeline only to return [], 4-6 times per agent,
   * dozens of times per task. The benchmark caught the 14-48s loops on
   * the first task in a fresh temp home. Short-circuit returns early
   * when the project has no memory_file rows at all — once anything is
   * written (compaction, reflection, user note) searches resume normally.
   */
  function projectHasMemory(projectId: string): boolean {
    const row = Database.use((db) =>
      db
        .select({ id: MemoryFileTable.id })
        .from(MemoryFileTable)
        .where(eq(MemoryFileTable.project_id, projectId))
        .limit(1)
        .get(),
    )
    return row !== undefined
  }

  export function search(input: {
    query: string
    projectId: string
    sessionID?: string
    sessionIDs?: string[]
    scope?: Memory.QueryScope
    limit?: number
    minScore?: number
    temporalDecay?: boolean
    kinds?: Memory.Kind[]
    sources?: Memory.Source[]
  }) {
    const limit = input.limit ?? 6
    const minScore = input.minScore ?? 0.1
    const query = buildFtsQuery(input.query)
    const scope = input.scope ?? "all"
    const sessionSet = input.sessionIDs && input.sessionIDs.length > 0 ? new Set(input.sessionIDs) : null

    if (!query) {
      log.info("empty search query after tokenization")
      return []
    }
    if (scope === "session" && !input.sessionID && !sessionSet) {
      log.info("session-scoped memory search skipped without sessionID", { query })
      return []
    }
    if (!projectHasMemory(input.projectId)) {
      log.info("memory empty for project — skipping FTS pipeline", {
        projectId: input.projectId,
      })
      return []
    }

    return searchFts({
      query,
      projectId: input.projectId,
      sessionID: input.sessionID,
      sessionSet,
      scope,
      limit,
      minScore,
      temporalDecay: input.temporalDecay ?? false,
      kinds: input.kinds,
      sources: input.sources,
    })
  }

  function searchFts(input: {
    query: string
    projectId: string
    sessionID?: string
    sessionSet: Set<string> | null
    scope: Memory.QueryScope
    limit: number
    minScore: number
    temporalDecay: boolean
    kinds?: Memory.Kind[]
    sources?: Memory.Source[]
  }) {
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
      if (!matchesScope(row.scope, row.session_id ?? undefined, input.scope, input.sessionID, input.sessionSet))
        continue
      if (!matchesKinds(row.kind, input.kinds)) continue
      if (!matchesSources(row.source, input.sources)) continue

      let score = bm25RankToScore(row.rank)
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

  function compareResults(a: Memory.SearchResult, b: Memory.SearchResult) {
    if (a.scope !== b.scope) return a.scope === "session" ? -1 : 1
    if (a.kind !== b.kind) return KIND_WEIGHT[b.kind] - KIND_WEIGHT[a.kind]
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score
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

  function clampScore(value: number | undefined, defaultValue: number) {
    if (typeof value !== "number" || Number.isNaN(value)) return defaultValue
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
    sessionSet: Set<string> | null,
  ) {
    if (queryScope === "global") return rowScope === "global"
    if (sessionSet) {
      if (queryScope === "session") return rowScope === "session" && !!rowSessionID && sessionSet.has(rowSessionID)
      if (rowScope === "global") return true
      return !!rowSessionID && sessionSet.has(rowSessionID)
    }
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
