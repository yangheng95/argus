import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createDecisionLog } from "../../src/decision-log"
import { DecisionLogBundle } from "../../src/decision-log/bundle"
import { renderFrontendDesignHandoffReference, frontendDesignArtifactPaths } from "../../src/frontend-design/handoff"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

// Covers the ISOLATED units landed for "decision log complete on disk +
// agent can reference it" (artifacts/2026-05-18-decision-log-disk-
// materialization.md). Acceptance / orchestrator / build-agent wiring is
// deferred behind a concurrent branch refactor (§11) and not exercised here.

describe("DecisionLog.toFullDocument()", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>
  let projectID = ""
  let taskID = ""

  function seed() {
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "DecisionLog FullDoc Test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    Database.use((db) =>
      db
        .insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "fulldoc test",
          request: "decision log full document",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run(),
    )
  }

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    const stamp = Date.now().toString(16)
    projectID = `project_dlb_${stamp}`
    taskID = `tsk_${stamp}dlb`
    seed()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("empty log → empty document (no fallback)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(createDecisionLog(taskID).toFullDocument()).toBe("")
      },
    })
  })

  test("phase-sectioned, NO value cap, NO entry limit, all fields", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        // A value far beyond the 600-char prompt cap — the full document
        // must NOT truncate it (that cap governs prompt bytes only).
        const bigValue = "X".repeat(1500)
        log.append({ phase: "requirements", key: "runtime", value: "Bun", reason: "template pins Bun" })
        log.append({ phase: "architect", key: "api_contract", value: bigValue, reason: "interface" })
        log.append({ goalID: "gol_a", phase: "architect", key: "blueprint", value: "dirs", reason: "layout" })

        const doc = createDecisionLog(taskID).toFullDocument()

        // Phase-sectioned (codex Q3 — not flat)
        expect(doc).toContain("## Phase: requirements")
        expect(doc).toContain("## Phase: architect")
        // No cap: the 1500-char value appears in full, no truncation marker
        expect(doc).toContain(bigValue)
        expect(doc).not.toContain("chars truncated")
        // All fields: key, reason (WHY), goal scoping, timestamp
        expect(doc).toContain("### runtime")
        expect(doc).toContain("_Why: template pins Bun_")
        expect(doc).toContain("goal:gol_a")
        expect(doc).toMatch(/\d{4}-\d{2}-\d{2}T/) // ISO timestamp present
        // Source-of-truth framing (codex D1 — projection, not canonical)
        expect(doc).toContain("source of truth")
      },
    })
  })
})

describe("DecisionLogBundle", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>
  let projectID = ""
  let taskID = ""

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    const stamp = Date.now().toString(16)
    projectID = `project_dlbw_${stamp}`
    taskID = `tsk_${stamp}dlbw`
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Bundle Test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    Database.use((db) =>
      db
        .insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "bundle",
          request: "bundle",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run(),
    )
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("write() materializes task-scoped runtime decision-log.md = toFullDocument()", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        createDecisionLog(taskID).append({
          phase: "requirements",
          key: "runtime",
          value: "Bun",
          reason: "template",
        })
        const abs = await DecisionLogBundle.write(tmp.path, taskID)
        expect(abs).toBe(ProjectRuntimePaths.decisionLogPaths(tmp.path, taskID).absolute)
        const onDisk = await fs.readFile(abs, "utf8")
        expect(onDisk).toBe(createDecisionLog(taskID).toFullDocument())
        expect(onDisk).toContain("### runtime")
      },
    })
  })

  test("write() HARD FAILS (rejects, no swallow) when the path is unwritable", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Plant a FILE where the `.opencorvus` directory must be created so
        // fs.mkdir(...,{recursive:true}) throws ENOTDIR — the writer must
        // propagate, not fall back to a truncated prompt (rule 7 / codex D5).
        await fs.writeFile(path.join(tmp.path, ".opencorvus"), "blocker", "utf8")
        await expect(DecisionLogBundle.write(tmp.path, taskID)).rejects.toBeDefined()
      },
    })
  })

  test("reference() emits relative vs absolute by mode; never 'source of truth' for the file", () => {
    const rel = DecisionLogBundle.reference({ projectDir: "/proj", taskID, mode: "relative" })
    const abs = DecisionLogBundle.reference({ projectDir: "/proj", taskID, mode: "absolute" })
    expect(rel).toContain(ProjectRuntimePaths.decisionLogPaths("/proj", taskID).relative)
    expect(abs).toContain(ProjectRuntimePaths.decisionLogPaths("/proj", taskID).absolute)
    // Projection framing (codex D1): the table is the source of truth, the
    // file is a read-only projection — must not advertise the file as canonical.
    expect(rel).toContain("projection of the decision_log table")
    expect(rel).not.toMatch(/canonical .*decision-log\.md/i)
  })
})

describe("renderFrontendDesignHandoffReference pathMode (systemic absolute-path fix)", () => {
  function seedFrontendDesignHandoff(taskID: string) {
    createDecisionLog(taskID).append({
      phase: "frontend_design",
      key: "public_report",
      value: "frontend_design public report exists",
      reason: "path mode test handoff",
    })
  }

  test("no frontend_design decision-log handoff entries emits no public report path", () => {
    expect(renderFrontendDesignHandoffReference("tsk_no_frontend_design", { includeExcerpts: false })).toBe("")
  })

  test("default (no pathMode) keeps the relative path — in-process unchanged", () => {
    const taskID = "tsk_x"
    seedFrontendDesignHandoff(taskID)
    const out = renderFrontendDesignHandoffReference(taskID, { includeExcerpts: false })
    expect(out).toContain(frontendDesignArtifactPaths("", taskID).templateRelative)
    expect(out).not.toContain("/abs/")
  })

  test("pathMode 'absolute' without projectDir HARD FAILS (rule 7 — no silent relative fallback)", () => {
    const taskID = "tsk_abs_missing_project"
    seedFrontendDesignHandoff(taskID)
    expect(() =>
      renderFrontendDesignHandoffReference(taskID, { includeExcerpts: false, pathMode: "absolute" }),
    ).toThrow(/projectDir/)
  })

  test("pathMode 'absolute' emits the project-rooted absolute path for external executors", () => {
    const taskID = "tsk_abs_project"
    seedFrontendDesignHandoff(taskID)
    const out = renderFrontendDesignHandoffReference(taskID, {
      includeExcerpts: false,
      pathMode: "absolute",
      projectDir: "/abs/proj",
    })
    const expected = frontendDesignArtifactPaths("/abs/proj", taskID).templateAbsolute
    expect(out).toContain(expected)
    expect(out).toContain(expected)
  })

  test("frontendDesignArtifactPaths is single-source: relative consts feed the helper", () => {
    const p = frontendDesignArtifactPaths("/x", "tsk_x")
    expect(p.templateRelative).toBe(ProjectRuntimePaths.frontendDesignPaths("/x", "tsk_x").templateRelative)
    expect(p.manifestRelative).toBe(ProjectRuntimePaths.frontendDesignPaths("/x", "tsk_x").manifestRelative)
    expect(p.templateAbsolute).toBe(ProjectRuntimePaths.frontendDesignPaths("/x", "tsk_x").templateAbsolute)
  })
})
