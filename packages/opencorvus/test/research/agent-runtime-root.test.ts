import { afterEach, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { Session } from "../../src/session"
import { Filesystem } from "../../src/util/filesystem"
import { Worktree } from "../../src/worktree"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  buildUnsatisfiedTerminalToolError: () => new Error("terminal tool unsatisfied"),
  classifyAttemptOutcome: () => ({ status: "ok" }),
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
        await seedResearchTask(taskID)
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
        expect(
          JSON.parse(await fs.readFile(primaryPaths.evidenceJsonAbsolute, "utf8")).evidence_notes[0].evidence_id,
        ).toBe("ev_1")
      },
    })
  },
  { timeout: 30_000 },
)

test(
  "research continuation hydrates completed update tool calls before terminal readiness is evaluated",
  async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_research_continuation_hydration"
    const updateCalls = minimalResearchUpdateCalls()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await seedResearchTask(taskID)
        const session = await Session.createNext({
          kind: "deep-research",
          title: "Deep Research continuation hydration",
          directory: tmp.path,
        })
        await persistCompletedResearchToolCalls(session.id, tmp.path, updateCalls)

        let observedReady = false
        let observedSummary: string | undefined
        runnerImpl = async (input) => {
          observedReady = input.terminalTool.shouldExposeOnlyTerminalTool()
          observedSummary = input.toolKit.getCollector().summary
          return {
            collector: {
              finalized: true,
              draft: validResearchDraft(),
              fact_check_items: [],
            },
            session: { id: session.id },
            finalMessage: { info: { id: "msg_research_continuation_final" } },
          }
        }

        const { runResearchSession } = await import("../../src/research/agent")
        await runResearchSession(
          {
            title: "Continuation hydration",
            request: "Continue the same research session.",
            taskID,
            continuation: {
              sessionID: session.id,
              artifactID: "art_research_continuation_hydration",
              reason: "terminal finalizer miss",
              kind: "protocol-finalizer-miss",
              finalizerName: "submit_research_brief",
            },
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

        expect(observedSummary).toBe("Research summary.")
        expect(observedReady).toBe(true)
      },
    })
  },
  { timeout: 30_000 },
)

async function seedResearchTask(taskID: string): Promise<void> {
  const now = Date.now()
  const rootSession = await Session.createNext({
    kind: "root",
    title: "Research runtime task root",
    directory: Instance.directory,
  })
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        session_id: rootSession.id,
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

function minimalResearchUpdateCalls(): Array<{ toolName: string; input: unknown }> {
  return [
    {
      toolName: "update_research_scope",
      input: {
        user_goal: "Prepare PRD input",
        deliverable_type: "prd",
        audience: "product",
        explicit_non_goals: [],
        assumed_non_goals: [],
      },
    },
    { toolName: "update_research_summary", input: { summary: "Research summary." } },
    {
      toolName: "update_research_evidence",
      input: {
        id: "ev_1",
        kind: "web",
        pointer: "https://example.com",
        title: "Example",
        retrieved_at: "2026-05-31T00:00:00.000Z",
        reliability: "primary",
        excerpt: "A compact excerpt.",
        volatile: false,
      },
    },
    { toolName: "update_research_fact", input: { id: "fact_1", statement: "A fact.", evidence_ids: ["ev_1"] } },
    {
      toolName: "update_research_inference",
      input: {
        id: "inf_1",
        inference: "An inference.",
        based_on_fact_ids: ["fact_1"],
        confidence: "medium",
      },
    },
    { toolName: "update_research_problem", input: { id: "prob_1", statement: "A problem.", fact_ids: ["fact_1"] } },
    { toolName: "update_research_need", input: { id: "need_1", need: "A need.", fact_ids: ["fact_1"] } },
    {
      toolName: "update_research_constraint",
      input: { id: "con_1", constraint: "A constraint.", fact_ids: ["fact_1"] },
    },
    {
      toolName: "update_research_document_section",
      input: { id: "sec_1", title: "Section", purpose: "Purpose", evidence_ids: ["ev_1"] },
    },
    {
      toolName: "update_research_open_question",
      input: { id: "oq_1", question: "A question?", blocking: false, related_fact_ids: ["fact_1"] },
    },
    {
      toolName: "update_research_bundle_section",
      input: {
        title: "Evidence Index",
        evidence_ids: ["ev_1"],
        points: ['Quoted label: "Economy overview".'],
      },
    },
    {
      toolName: "update_research_evidence_note",
      input: {
        evidence_id: "ev_1",
        observations: ['The source says "GDP growth".'],
        artifact_refs: ["source-ir/content-model.json"],
      },
    },
    {
      toolName: "update_research_citation",
      input: {
        claim_id: "fact_1",
        evidence_ids: ["ev_1"],
        pointer: "research-bundle.md#evidence-index",
        usage: "Supports fact_1.",
      },
    },
  ]
}

async function persistCompletedResearchToolCalls(
  sessionID: string,
  directory: string,
  calls: Array<{ toolName: string; input: unknown }>,
): Promise<void> {
  const now = Date.now()
  const messageID = "msg_research_completed_updates"
  await Session.persistMessage({
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      parentID: "msg_research_user",
      time: { created: now, completed: now },
      agent: "deep-research",
      providerID: "test",
      modelID: "mock",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, total: 0, cache: { read: 0, write: 0 } },
      path: { cwd: directory, root: directory },
    },
    parts: calls.map((call, index) => {
      const order = String(index).padStart(3, "0")
      return {
        id: `prt_research_completed_update_${order}`,
        sessionID,
        messageID,
        type: "tool",
        callID: `call_research_completed_update_${order}`,
        tool: call.toolName,
        state: {
          status: "completed",
          input: call.input,
          output: "OK",
          title: call.toolName,
          metadata: {},
          time: { start: now + index, end: now + index + 1 },
        },
      }
    }),
    touchSessionID: sessionID,
  })
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
