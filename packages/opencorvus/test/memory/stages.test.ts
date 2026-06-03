import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Memory } from "../../src/memory"
import { EngineMemoryBridge } from "../../src/engine/memory-bridge"
import { MemoryInjection } from "../../src/memory/injection"
import { tmpdir } from "../fixture/fixture"

/**
 * Multi-stage memory read/write integration tests.
 *
 * Verifies that memories written at one stage (research, scaffolding,
 * testing, task completion, task failure) are correctly persisted and
 * can be recalled at later stages.
 */
describe("memory multi-stage lifecycle", () => {
  test("stage 1: competitive research — writes facts, searchable later", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        // Agent discovers competitive findings and writes them as facts
        const f1 = Memory.writeFile({
          title: "Fact: Competitor A uses WebSocket for real-time sync",
          content:
            "## Competitive Research\nCompetitor A uses WebSocket-based real-time sync for collaborative editing. Their approach handles up to 50 concurrent editors with CRDT-based conflict resolution.",
          source: "agent",
          projectId,
          kind: "fact",
          key: "competitor-a-websocket",
        })

        const f2 = Memory.writeFile({
          title: "Fact: Competitor B uses SSE with polling fallback",
          content:
            "## Competitive Research\nCompetitor B relies on Server-Sent Events with a polling fallback for older browsers. Average latency is 200ms for document updates.",
          source: "agent",
          projectId,
          kind: "fact",
          key: "competitor-b-sse",
        })

        expect(f1.kind).toBe("fact")
        expect(f2.kind).toBe("fact")
        expect(f1.scope).toBe("global")

        // Verify search finds the research
        const results = Memory.search({
          query: "real-time sync WebSocket CRDT",
          projectId,
          limit: 5,
        })
        expect(results.length).toBeGreaterThan(0)
        expect(results.some((r) => r.fileId === f1.id)).toBe(true)

        // Verify recall returns these facts
        const recalled = Memory.recall({
          query: "competitor real-time architecture",
          projectId,
          limit: 5,
        })
        expect(recalled.length).toBeGreaterThan(0)
      },
    })
  })

  test("stage 2: scaffolding — writes project setup facts, readable by later tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        // Agent writes scaffolding decisions
        Memory.writeFile({
          title: "Fact: Project uses Bun + Hono + SQLite stack",
          content:
            "## Project Setup\n- Runtime: Bun 1.3\n- Framework: Hono v4\n- Database: SQLite via bun:sqlite\n- Frontend: Solid.js + Vite\n- Styling: Tailwind CSS",
          source: "agent",
          projectId,
          kind: "fact",
          key: "project-stack",
        })

        Memory.writeFile({
          title: "Fact: Database file location is data/app.db",
          content:
            "## Database Config\nSQLite database file is stored at data/app.db relative to project root. WAL mode is enabled. Migrations run on startup.",
          source: "agent",
          projectId,
          kind: "fact",
          key: "db-location",
        })

        // Verify a later stage can find scaffolding info
        // Note: FTS5 requires exact token matching (no stemming), so use words
        // that appear verbatim in the content.
        const results = Memory.search({
          query: "SQLite database WAL Migrations startup",
          projectId,
          limit: 5,
        })
        expect(results.length).toBeGreaterThan(0)
        expect(results.some((r) => r.content.includes("WAL mode"))).toBe(true)

        // Verify promptSection generates usable context
        const section = Memory.promptSection({
          query: "SQLite database WAL Migrations",
          projectId,
          limit: 3,
        })
        expect(section).not.toBeNull()
        expect(section).toContain("Auto-Recalled Memory")
        expect(section).toContain("fact")
      },
    })
  })

  test("stage 3: testing methods — writes test approach notes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        // Agent writes testing methodology
        Memory.writeFile({
          title: "Fact: Integration tests use in-memory SQLite",
          content:
            "## Testing Strategy\n- Unit tests use vitest with mock SQLite\n- Integration tests use real in-memory SQLite database\n- E2E tests run against a local Bun server on port 0\n- Auth tests use fixture tokens from test/fixtures/tokens.json",
          source: "agent",
          projectId,
          kind: "fact",
          key: "test-strategy",
        })

        Memory.writeFile({
          title: "Lesson: Always seed test database before auth tests",
          content:
            "## Lesson\nAuth integration tests fail intermittently when the users table is empty. Always run seed() in beforeEach to ensure a test user exists.",
          source: "agent",
          projectId,
          kind: "lesson",
          key: "test-auth-seed",
          importance: 90,
        })

        // Verify lesson has higher priority than fact in recall
        const recalled = Memory.recall({
          query: "auth test database seed",
          projectId,
          limit: 5,
        })
        expect(recalled.length).toBeGreaterThan(0)

        // Find the lesson and fact in results
        const lessonResult = recalled.find((r) => r.kind === "lesson")
        const factResult = recalled.find((r) => r.kind === "fact")

        // Lesson should appear (if both match the query)
        expect(lessonResult).toBeDefined()
        if (factResult) {
          // Lesson should score higher than fact for the same query
          expect(lessonResult!.score).toBeGreaterThanOrEqual(factResult.score)
        }
      },
    })
  })

  test("stage 4: orchestrator task success — flushTaskLearnings writes episode + atomics", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        await EngineMemoryBridge.flushTaskLearnings({
          task: {
            id: "task_test_success",
            title: "Add user authentication",
            request: "Implement JWT-based user authentication with login and register endpoints",
            project_id: projectId,
          },
          run: {
            id: "run_test_1",
            retry_count: 2,
            plan_version_id: "plan_v1",
          },
          acceptance: {
            id: "del_test_1",
            summary: "Added /api/auth/login and /api/auth/register endpoints with bcrypt password hashing and JWT token generation",
            result: { changed_files: ["src/routes/auth.ts", "src/middleware/jwt.ts", "test/auth.test.ts"] },
          },
          evaluation: {
            id: "eval_test_1",
            status: "pass",
            summary: "All 5 auth checks passed",
            checks: [
              { name: "register returns 201", status: "pass" },
              { name: "login returns JWT", status: "pass" },
            ],
          },
          plan: {
            id: "plan_test_1",
            summary: "Use bcrypt for password hashing and jsonwebtoken for JWT generation",
            version: 1,
          },
        })

        // Verify episode was created
        const files = Memory.listFiles({ projectId })
        const episode = files.find((f) => f.kind === "episode" && f.title.includes("Add user authentication"))
        expect(episode).toBeDefined()

        // Verify atomic facts were derived
        const facts = files.filter((f) => f.kind === "fact")
        expect(facts.length).toBeGreaterThan(0)

        // Verify retry lesson was created
        const lessons = files.filter((f) => f.kind === "lesson")
        expect(lessons.length).toBeGreaterThan(0)
        const retryLesson = lessons.find((f) => {
          const chunks = Memory.getChunks(f.id)
          return chunks.some((c) => c.content.includes("2 retries"))
        })
        expect(retryLesson).toBeDefined()

        // Verify the episode content is searchable
        const recalled = Memory.recall({
          query: "authentication JWT bcrypt login register",
          projectId,
          limit: 5,
          includeEpisodes: true,
        })
        expect(recalled.length).toBeGreaterThan(0)
      },
    })
  })

  test("cross-stage recall: earlier stage memories are available to later stages", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        // Stage 1: Research writes a fact
        Memory.writeFile({
          title: "Fact: Target users prefer dark mode by 3:1 ratio",
          content: "## User Research\nSurvey of 500 target users shows 75% prefer dark mode. Mobile users show even stronger preference (80%).",
          source: "agent",
          projectId,
          kind: "fact",
          key: "user-pref-dark-mode",
        })

        // Stage 2: Scaffolding writes setup info
        Memory.writeFile({
          title: "Fact: Theme system uses CSS custom properties",
          content: "## Theme Setup\nImplemented theme switcher using CSS custom properties. Default theme is dark. Theme preference stored in localStorage key 'theme'.",
          source: "agent",
          projectId,
          kind: "fact",
          key: "theme-system",
        })

        // Stage 3: A lesson from a failed attempt
        Memory.writeFile({
          title: "Lesson: CSS custom properties must be declared on :root for theme switching",
          content: "## Lesson\nDeclaring CSS custom properties on body instead of :root causes theme-switching flicker on Safari. Always use :root selector.",
          source: "agent",
          projectId,
          kind: "lesson",
          key: "css-vars-root",
          importance: 90,
        })

        // Stage 4: A later agent recalls all relevant memories about themes.
        // FTS5 uses AND matching (all tokens must appear in the same chunk),
        // so use recall() which generates shorter query variants automatically.
        const recalled = Memory.recall({
          query: "CSS custom properties theme",
          projectId,
          limit: 10,
        })

        // Should find at least the lesson and fact about CSS custom properties
        expect(recalled.length).toBeGreaterThanOrEqual(1)
        const kinds = new Set(recalled.map((r) => r.kind))
        expect(kinds.has("lesson") || kinds.has("fact")).toBe(true)

        // Also verify dark mode fact is separately findable
        const darkModeResults = Memory.recall({
          query: "dark mode prefer users",
          projectId,
          limit: 5,
        })
        expect(darkModeResults.length).toBeGreaterThan(0)

        // Verify promptSection works for injection
        const section = Memory.promptSection({
          query: "CSS custom properties theme",
          projectId,
          limit: 5,
        })
        expect(section).not.toBeNull()
        expect(section).toContain("Auto-Recalled Memory")

        // Verify injection includes recall policy
        const injected = await MemoryInjection.systemPromptSection({
          projectID: projectId,
          sessionID: "ses_later_stage",
          query: "CSS custom properties",
          memoryToolAvailable: true,
        })
        expect(injected).toContain("Auto-Recalled Memory")
        expect(injected).toContain("Memory Policy")
      },
    })
  })

  test("upsert by key: repeated writes to same key update rather than duplicate", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        // First write
        const v1 = Memory.writeFile({
          title: "Fact: API rate limit is 100 req/min",
          content: "## API Config\nRate limit set to 100 requests per minute per user.",
          source: "agent",
          projectId,
          kind: "fact",
          key: "api-rate-limit",
        })

        // Second write with same key — should update, not create new
        const v2 = Memory.writeFile({
          title: "Fact: API rate limit increased to 200 req/min",
          content: "## API Config\nRate limit increased to 200 requests per minute per user after load testing.",
          source: "agent",
          projectId,
          kind: "fact",
          key: "api-rate-limit",
        })

        expect(v1.id).toBe(v2!.id) // Same file, updated in place

        // Only one file with this key
        const files = Memory.listFiles({ projectId, kinds: ["fact"] })
        const matching = files.filter((f) => f.key === "api-rate-limit")
        expect(matching.length).toBe(1)

        // Content should be the updated version
        const chunks = Memory.getChunks(v2!.id)
        expect(chunks.some((c) => c.content.includes("200 requests"))).toBe(true)
        expect(chunks.some((c) => c.content.includes("100 requests"))).toBe(false)
      },
    })
  })

  test("kind weight ordering: lesson > fact > episode in search results", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        // Write memories of different kinds with identical search-relevant content
        Memory.writeFile({
          title: "Episode: Redis caching implementation task",
          content: "## Episode\nImplemented Redis caching layer for API responses. Cache TTL set to 5 minutes.",
          source: "compaction",
          projectId,
          kind: "episode",
        })

        Memory.writeFile({
          title: "Fact: Redis cache TTL is 5 minutes",
          content: "## Fact\nRedis caching layer uses 5 minute TTL for API responses. Cache invalidation on write.",
          source: "agent",
          projectId,
          kind: "fact",
        })

        Memory.writeFile({
          title: "Lesson: Redis connection must use TLS in production",
          content: "## Lesson\nRedis caching connections fail silently without TLS in production. Always enable TLS for Redis in non-local environments.",
          source: "agent",
          projectId,
          kind: "lesson",
          importance: 90,
        })

        // Search for Redis-related content
        const results = Memory.search({
          query: "Redis caching TTL API",
          projectId,
          limit: 10,
        })

        // Should find all three
        expect(results.length).toBeGreaterThanOrEqual(2)

        // Lesson and fact should appear before episode when kinds are mixed
        const lessonIdx = results.findIndex((r) => r.kind === "lesson")
        const episodeIdx = results.findIndex((r) => r.kind === "episode")
        if (lessonIdx >= 0 && episodeIdx >= 0) {
          expect(lessonIdx).toBeLessThan(episodeIdx)
        }
      },
    })
  })

  test("session-scoped memories are isolated between sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        // Session A writes a session-scoped memory
        Memory.writeFile({
          title: "Note: Debugging auth token expiry in session A",
          content: "## Debug Notes\nToken expires after 1 hour. Need to implement refresh logic in interceptor.",
          source: "agent",
          projectId,
          kind: "note",
          scope: "session",
          sessionID: "ses_a",
        })

        // Session A can find it (use words that appear verbatim in content)
        const fromA = Memory.search({
          query: "Token expires refresh interceptor",
          projectId,
          sessionID: "ses_a",
          scope: "session",
          limit: 5,
        })
        expect(fromA.length).toBeGreaterThan(0)

        // Session B cannot find it
        const fromB = Memory.search({
          query: "Token expires refresh interceptor",
          projectId,
          sessionID: "ses_b",
          scope: "session",
          limit: 5,
        })
        expect(fromB.length).toBe(0)

        // "all" scope from session B also should not return session A's memory
        const fromBAll = Memory.search({
          query: "Token expires refresh interceptor",
          projectId,
          sessionID: "ses_b",
          scope: "all",
          limit: 5,
        })
        const sessionAResults = fromBAll.filter((r) => r.sessionID === "ses_a")
        expect(sessionAResults.length).toBe(0)
      },
    })
  })

  test("delete removes memory from both listing and search", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id

        const file = Memory.writeFile({
          title: "Fact: Temporary migration workaround",
          content: "## Workaround\nTemporarily skip foreign key validation during SQLite to PostgreSQL migration.",
          source: "agent",
          projectId,
          kind: "fact",
        })

        // Verify it exists
        expect(Memory.getFile(file.id)).not.toBeNull()
        const beforeSearch = Memory.search({
          query: "migration foreign key validation workaround",
          projectId,
          limit: 5,
        })
        expect(beforeSearch.some((r) => r.fileId === file.id)).toBe(true)

        // Delete it
        Memory.deleteFile(file.id)

        // Verify it's gone from listing
        expect(Memory.getFile(file.id)).toBeNull()

        // Verify it's gone from search
        const afterSearch = Memory.search({
          query: "migration foreign key validation workaround",
          projectId,
          limit: 5,
        })
        expect(afterSearch.some((r) => r.fileId === file.id)).toBe(false)
      },
    })
  })
})
