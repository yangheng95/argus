import { afterEach, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { Filesystem } from "../../src/util/filesystem"
import { Worktree } from "../../src/worktree"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  buildInformationMissingError: () => new Error("information missing"),
  buildUnsatisfiedTerminalToolError: () => new Error("terminal tool unsatisfied"),
  classifyAttemptOutcome: () => ({ status: "ok" }),
  extractInformationMissingBlock: () => undefined,
  messageHasInformationMissing: () => false,
  promptToolSwitchesForAgentRun: () => "",
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
  runAgentSessionWithRetry: () => {
    throw new Error("runAgentSessionWithRetry should not be called by research runtime root test")
  },
  shouldFailUnreadableBuildReference: () => false,
  terminalToolMissingErrorFor: () => new Error("terminal tool missing"),
  toolErrorPartsFromFinalMessage: () => [],
}))

afterEach(async () => {
  runnerImpl = undefined
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

test(
  "research bundles persist under the task primary runtime when called from a managed worktree",
  async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_research_runtime_worktree"
    let worktreeDir = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedResearchTask(taskID)
        const worktree = await Worktree.create({
          name: `research-runtime-${Date.now().toString(36)}`,
          taskID,
          goalID: "gol_research_runtime",
          runID: "run_research_runtime",
        })
        worktreeDir = worktree.directory
      },
    })

    await Instance.provide({
      directory: worktreeDir,
      fn: async () => {
        runnerImpl = async () => ({
          collector: {
            finalized: true,
            draft: validResearchDraft(),
            fact_check_items: [],
          },
          session: { id: "ses_research_runtime_worktree" },
          finalMessage: { info: { id: "msg_research_runtime_worktree" } },
        })

        const { runResearchSession } = await import("../../src/research/agent")
        const result = await runResearchSession(
          {
            title: "Research runtime root",
            request: "Prepare evidence-backed notes.",
            taskID,
          },
          {
            kind: "deep-research",
            core: "Research core",
            sessionTitlePrefix: "Deep Research",
            prepareWebpageEvidence: "none",
            bundlePathKind: "deep-research",
            retrievalTools: "none",
            delegation: "Prepare research evidence.",
          },
        )

        const primaryPaths = ProjectRuntimePaths.deepResearchPaths(tmp.path, taskID, result.sessionID)
        const worktreePaths = ProjectRuntimePaths.deepResearchPaths(worktreeDir, taskID, result.sessionID)
        expect(result.brief.bundle.full_markdown_path).toBe(`${primaryPaths.relativeDir}/research-bundle.md`)
        expect(await Filesystem.exists(primaryPaths.fullMarkdownAbsolute)).toBe(true)
        expect(await Filesystem.exists(primaryPaths.evidenceJsonAbsolute)).toBe(true)
        expect(await Filesystem.exists(primaryPaths.citationMapAbsolute)).toBe(true)
        expect(await Filesystem.exists(worktreePaths.absoluteDir)).toBe(false)
        expect(JSON.parse(await fs.readFile(primaryPaths.evidenceJsonAbsolute, "utf8")).evidence_notes[0].evidence_id).toBe(
          "ev_1",
        )
      },
    })
  },
  { timeout: 30_000 },
)

function seedResearchTask(taskID: string): void {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        source: "test",
        title: "research runtime task",
        request: "research runtime task",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function validResearchDraft() {
  return {
    scope: {
      user_goal: "Prepare an evidence-backed PRD input.",
      deliverable_type: "prd",
      audience: "product and engineering",
      explicit_non_goals: [],
      assumed_non_goals: [],
    },
    summary: "Evidence-backed summary.",
    evidence_index: [
      {
        id: "ev_1",
        kind: "web",
        pointer: "https://example.com/docs",
        title: "Example docs",
        retrieved_at: "2026-05-31T00:00:00.000Z",
        reliability: "primary",
        excerpt: "Example documentation excerpt.",
        bundle_ref: "research-bundle.md#ev_1",
        volatile: false,
      },
    ],
    facts: [
      {
        id: "fact_1",
        statement: "Example docs describe the relevant behavior.",
        evidence_ids: ["ev_1"],
      },
    ],
    inferences: [
      {
        id: "inf_1",
        inference: "The behavior should be reflected as a product constraint.",
        based_on_fact_ids: ["fact_1"],
        confidence: "medium",
      },
    ],
    problem_statements: [
      {
        id: "prob_1",
        statement: "Users need a documented, evidence-backed workflow.",
        fact_ids: ["fact_1"],
      },
    ],
    user_needs: [
      {
        id: "need_1",
        need: "Users need citations for external claims.",
        fact_ids: ["fact_1"],
      },
    ],
    constraints: [
      {
        id: "con_1",
        constraint: "External facts must cite primary evidence.",
        fact_ids: ["fact_1"],
      },
    ],
    document_outline: [
      {
        id: "sec_1",
        title: "Evidence",
        purpose: "Summarize source-backed facts.",
        evidence_ids: ["ev_1"],
      },
    ],
    subpage_research_tasks: [],
    open_questions: [
      {
        id: "oq_1",
        question: "Which audience should own approval?",
        blocking: true,
        related_fact_ids: ["fact_1"],
      },
    ],
    bundle: {
      full_markdown_sections: [
        {
          title: "Evidence",
          points: ["Example docs describe the relevant behavior."],
          evidence_ids: ["ev_1"],
        },
      ],
      evidence_notes: [
        {
          evidence_id: "ev_1",
          notes: ["Primary example documentation."],
        },
      ],
      citation_map: [
        {
          claim_id: "fact_1",
          evidence_ids: ["ev_1"],
          note: "Fact cites the primary example documentation.",
        },
      ],
    },
  }
}
