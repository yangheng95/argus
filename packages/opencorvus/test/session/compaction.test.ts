import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { SessionCompaction } from "../../src/session/compaction"
import { CompactionHandoff } from "../../src/session/compaction-handoff"
import { MemoryFlush } from "../../src/memory/flush"
import { Memory } from "../../src/memory"
import { EffectiveConfig } from "../../src/config/effective"
import { Token } from "../../src/util/token"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import type { Provider } from "../../src/provider/provider"
import type { Config } from "../../src/config/config"
import { Todo } from "../../src/session/todo"
import { AgentRoleContract, type AgentRoleID } from "../../src/agent/role-contract"
import { Database } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

const sessionID = "ses_compaction_test"

function handoffFixture(): CompactionHandoff.Info {
  return {
    objective: "Harden compaction handoff so session continuation keeps requirements intact",
    acceptanceCriteria: ["The handoff must preserve exact acceptance criteria and command evidence"],
    durableInstructionSources: [{ path: "/repo/AGENTS.md", role: "project rules" }],
    activeBuildContracts: [],
    todos: [
      {
        content: "Run targeted compaction tests",
        status: "pending",
        priority: "high",
      },
    ],
    workingContext: [
      "Compaction must preserve requirements, command evidence, file paths, source user metadata, and todo state.",
      "Rendered Markdown is display-only; assistant.structured is the resumable handoff source.",
    ],
    chronology: [
      {
        event: "Identified generic summaries as insufficient for resuming session work",
        evidence: "packages/opencorvus/src/session/compaction-handoff.ts",
      },
    ],
    currentState: {
      phase: "implementing structured handoff validation",
      activeTask: "replace generic Markdown summary with host-rendered handoff",
      sourceUserMessage: {
        id: "m-user",
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        formatType: "text",
        systemMode: null,
        toolNames: ["shell"],
        variant: null,
        extraKeys: ["task"],
      },
    },
    agentHandoff: {
      kind: "build",
      deliverables: [
        {
          fact: "Structured compaction handoff implementation is the active build deliverable",
          evidence: "packages/opencorvus/src/session/compaction-handoff.ts",
        },
      ],
      codeChanges: [
        {
          path: "packages/opencorvus/src/session/compaction-handoff.ts",
          fact: "Build agent changed the compact handoff schema and renderer",
          evidence: "git diff -- packages/opencorvus/src/session/compaction-handoff.ts",
        },
      ],
      verification: [
        {
          command: "bun test packages/opencorvus/test/session/compaction.test.ts",
          result: "targeted compact contract verification",
          evidence: "testsAndCommands",
        },
      ],
      runtimeState: [
        {
          fact: "Continuation uses assistant.structured as the resumable source",
          evidence: "packages/opencorvus/src/session/compaction.ts",
        },
      ],
      handoffArtifacts: [
        {
          artifact: "assistant.structured",
          role: "validated compact handoff payload",
          evidence: "packages/opencorvus/src/session/message.ts",
        },
      ],
    },
    decisions: [
      {
        decision: "Store validated handoff data in assistant.structured",
        rationale: "Boundary checks need a machine-validated source",
        evidence: "packages/opencorvus/src/session/compaction.ts",
      },
    ],
    evidence: [
      {
        kind: "command",
        value: "bun test packages/opencorvus/test/session/compaction.test.ts",
        detail: "targeted compaction contract test command",
      },
    ],
    files: [
      {
        path: "packages/opencorvus/src/session/compaction-handoff.ts",
        status: "created",
        detail: "single handoff schema and renderer",
      },
    ],
    testsAndCommands: [
      {
        command: "bun test packages/opencorvus/test/session/compaction.test.ts",
        result: "pending local verification",
        evidence: "test command captured before final delivery evidence",
      },
    ],
    errorsAndBlockers: [],
    userMessages: ["Fix compaction so it preserves resumable task state."],
    nextActions: ["run the targeted compaction contract test"],
    openRisks: ["full typecheck may expose unrelated dirty workspace issues"],
  }
}

function fact(label: string) {
  return {
    fact: `${label} preserved compact fact`,
    evidence: `test evidence for ${label}`,
  }
}

function pathFact(label: string) {
  return {
    path: `packages/opencorvus/${label}.ts`,
    fact: `${label} path-specific compact fact`,
    evidence: `test path evidence for ${label}`,
  }
}

function commandFact(label: string) {
  return {
    command: `node verify-${label}.js`,
    result: `${label} verification completed`,
    evidence: `test command evidence for ${label}`,
  }
}

function artifactFact(label: string) {
  return {
    artifact: `artifact-${label}`,
    role: `${label} handoff artifact role`,
    evidence: `test artifact evidence for ${label}`,
  }
}

function sessionFact(label: string) {
  return {
    sessionID: `session-${label}`,
    agent: label,
    status: `${label} delegated session status`,
    evidence: `test session evidence for ${label}`,
  }
}

function goalFact(label: string) {
  return {
    goalID: `goal-${label}`,
    status: `${label} goal status`,
    evidence: `test goal evidence for ${label}`,
  }
}

function claimFact(label: string) {
  return {
    claim: `${label} claim text`,
    status: `${label} claim verification status`,
    evidence: `test claim evidence for ${label}`,
  }
}

function agentHandoffFixture(agent: AgentRoleID | "custom-reviewer"): CompactionHandoff.AgentHandoff {
  switch (agent) {
    case "coding":
      return {
        kind: "coding",
        editScope: [fact("coding edit scope")],
        codeChanges: [pathFact("coding-change")],
        commands: [commandFact("coding-command")],
        nextEdits: [fact("coding next edit")],
      }
    case "coding-assistant":
      return {
        kind: "coding-assistant",
        editScope: [fact("coding assistant edit scope")],
        codeChanges: [pathFact("coding-assistant-change")],
        commands: [commandFact("coding-assistant-command")],
        nextEdits: [fact("coding assistant next edit")],
      }
    case "build":
      return handoffFixture().agentHandoff
    case "visual-qa":
      return {
        kind: "visual-qa",
        screenshots: [artifactFact("visual-qa-screenshot")],
        findings: [fact("visual qa finding")],
        interactionChecks: [fact("visual qa interaction")],
        repairState: [fact("visual qa repair state")],
        acceptanceVerdict: [fact("visual qa verdict")],
      }
    case "general":
      return {
        kind: "general",
        findings: [fact("general finding")],
        workProducts: [artifactFact("general-work-product")],
        toolEvidence: [fact("general tool evidence")],
        nextActions: [fact("general next action")],
      }
    case "explore":
      return {
        kind: "explore",
        filesRead: [pathFact("explore-file")],
        symbols: [fact("explore symbol")],
        findings: [fact("explore finding")],
        openQuestions: [fact("explore question")],
      }
    case "compaction":
    case "title":
    case "summary":
      return {
        kind: agent,
        maintenanceActions: [fact(`${agent} maintenance`)],
        generatedOutputs: [fact(`${agent} output`)],
        sourceRequests: [fact(`${agent} source request`)],
      }
    case "control":
      return {
        kind: "control",
        panelActions: [fact("control panel action")],
        visibleState: [fact("control visible state")],
        pendingUserFollowUp: [fact("control follow up")],
      }
    case "orchestrator":
      return {
        kind: "orchestrator",
        workflowDecisions: [fact("orchestrator workflow decision")],
        delegatedSessions: [sessionFact("orchestrator-build")],
        goalGraphState: [goalFact("orchestrator-goal")],
        pendingDecisions: [fact("orchestrator pending decision")],
      }
    case "mission":
      return {
        kind: "mission",
        missionContract: [fact("mission contract")],
        roadmap: [fact("mission roadmap")],
        delegatedTasks: [fact("mission delegated task")],
        userCommitments: [fact("mission user commitment")],
        externalEvents: [fact("mission external event")],
      }
    case "requirements":
      return {
        kind: "requirements",
        requirementInventory: [fact("requirements inventory")],
        constraints: [fact("requirements constraint")],
        clarifications: [fact("requirements clarification")],
        rejectedNonRequirements: [fact("requirements rejected item")],
      }
    case "architect":
      return {
        kind: "architect",
        goals: [goalFact("architect-goal")],
        graphContracts: [artifactFact("architect-contract")],
        ownershipBoundaries: [fact("architect ownership")],
        verificationPlan: [fact("architect verification plan")],
      }
    case "frontend-design":
      return {
        kind: "frontend-design",
        referenceSurfaces: [artifactFact("frontend-design-reference")],
        visualSystem: [fact("frontend design visual system")],
        componentContracts: [fact("frontend design component contract")],
        implementationTemplate: [artifactFact("frontend-design-template")],
        fidelityRisks: [fact("frontend design fidelity risk")],
      }
    case "intent-analysis":
      return {
        kind: "intent-analysis",
        detectedIntents: [fact("intent analysis detected intent")],
        slots: [fact("intent analysis slot")],
        clarifications: [fact("intent analysis clarification")],
        routingAdvice: [fact("intent analysis routing advice")],
      }
    case "integrity":
      return {
        kind: "integrity",
        acceptanceFindings: [fact("integrity acceptance finding")],
        requirementCoverage: [fact("integrity requirement coverage")],
        runtimeEvidence: [fact("integrity runtime evidence")],
        verdict: [fact("integrity verdict")],
        rejectionDetails: [fact("integrity rejection detail")],
      }
    case "fact-check":
      return {
        kind: "fact-check",
        claims: [claimFact("fact-check")],
        sourceEvidence: [artifactFact("fact-check-source")],
        unresolvedClaims: [fact("fact check unresolved")],
      }
    case "deep-research":
      return {
        kind: "deep-research",
        researchQuestions: [fact("deep research question")],
        sources: [artifactFact("deep-research-source")],
        findings: [fact("deep research finding")],
        uncertainties: [fact("deep research uncertainty")],
        handoffArtifacts: [artifactFact("deep-research-handoff")],
      }
    case "frontend-research":
      return {
        kind: "frontend-research",
        sourcePages: [fact("frontend research source page")],
        regionEvidence: [fact("frontend research region evidence")],
        interactionEvidence: [fact("frontend research interaction evidence")],
        dataContracts: [fact("frontend research data contract")],
        handoffArtifacts: [artifactFact("frontend-research-handoff")],
      }
    case "goal-workload-analyst":
      return {
        kind: "goal-workload-analyst",
        goalInventories: [goalFact("goal-workload")],
        decompositionConcerns: [fact("goal workload decomposition")],
        executionRisks: [fact("goal workload execution risk")],
        recommendedSplits: [fact("goal workload split")],
      }
    case "custom-reviewer":
      return {
        kind: "custom-agent",
        agentName: "custom-reviewer",
        roleContract: "Custom reviewer preserves its declared review contract",
        toolSurface: ["read", "rg"],
        workProducts: [fact("custom reviewer work product")],
        toolEvidence: [fact("custom reviewer tool evidence")],
        continuationState: [fact("custom reviewer continuation state")],
      }
  }
}

function handoffFixtureForAgent(agent: AgentRoleID | "custom-reviewer"): CompactionHandoff.Info {
  return {
    ...handoffFixture(),
    currentState: {
      ...handoffFixture().currentState,
      sourceUserMessage: {
        ...handoffFixture().currentState.sourceUserMessage,
        agent,
      },
    },
    agentHandoff: agentHandoffFixture(agent),
  }
}

function basePart(messageID: string, id: string) {
  return {
    id,
    sessionID,
    messageID,
  }
}

function userMessage(id: string, parts: Message.Part[]): Message.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 0 },
      agent: "build",
      model: { providerID: "test", modelID: "test-model" },
      tools: {},
      mode: "",
    } as unknown as Message.User,
    parts,
  }
}

function assistantMessage(
  id: string,
  parentID: string,
  parts: Message.Part[],
  info?: Partial<Message.Assistant>,
): Message.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      parentID,
      time: { created: 0 },
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: {
        total: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: "test-model",
      providerID: "test",
      mode: "",
      ...info,
    } as unknown as Message.Assistant,
    parts,
  }
}

function toolPart(messageID: string, id: string, output: string): Message.ToolPart {
  return {
    ...basePart(messageID, id),
    type: "tool",
    callID: `call-${id}`,
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "echo test" },
      output,
      title: "bash",
      metadata: {},
      time: {
        start: 0,
        end: 1,
      },
    },
  }
}

function previousRetention(
  handoff: CompactionHandoff.Info,
): NonNullable<CompactionHandoff.EvidenceRequirements["previousHandoff"]> {
  return {
    acceptanceCriteria: handoff.acceptanceCriteria,
    workingContext: handoff.workingContext,
    chronology: handoff.chronology.map((item) => item.event),
    decisions: handoff.decisions.map((item) => item.decision),
    evidence: handoff.evidence.map((item) => item.value),
    files: handoff.files.map((item) => item.path),
    testsAndCommands: handoff.testsAndCommands.map((item) => item.command),
    errorsAndBlockers: handoff.errorsAndBlockers.map((item) => item.issue),
    userMessages: handoff.userMessages,
    nextActions: handoff.nextActions,
    openRisks: handoff.openRisks,
    agentHandoff: CompactionHandoff.agentHandoffRetentionFacts(handoff.agentHandoff),
  }
}

describe("CompactionHandoff", () => {
  test("rejects generic placeholder actions", () => {
    const invalid = {
      ...handoffFixture(),
      nextActions: ["continue implementation"],
    }

    expect(CompactionHandoff.Schema.safeParse(invalid).success).toBe(false)
  })

  test("parses schema object and renders deterministic Markdown", () => {
    const handoff = handoffFixture()
    const parsed = CompactionHandoff.Schema.parse(handoff)
    const first = CompactionHandoff.renderMarkdown(parsed)
    const second = CompactionHandoff.renderMarkdown(parsed)

    expect(first).toBe(second)
    expect(
      first.startsWith("This session is being continued from a previous conversation that ran out of context."),
    ).toBe(true)
    expect(first).toContain("Summary:")
    expect(first).toContain("1. Primary Request and Intent:")
    expect(first).toContain("7. Todo List (verbatim):")
    expect(first).toContain("7a. Agent-Specific Handoff (verbatim):")
    expect(first).toContain("9. Current Work:")
    expect(first).toContain("10. Optional Next Step:")
    expect(first).toContain("Agent-specific compact payload kind: build")
    expect(first).toContain("Structured compaction handoff implementation is the active build deliverable")
    expect(first).toContain("Working context: Compaction must preserve requirements")
    expect(first).toContain("Chronology: Identified generic summaries as insufficient")
    expect(first).toContain("Acceptance: The handoff must preserve exact acceptance criteria and command evidence")
    expect(first).toContain('"content": "Run targeted compaction tests"')
    expect(first).toContain("Fix compaction so it preserves resumable task state.")
    expect(first).toContain("bun test packages/opencorvus/test/session/compaction.test.ts")
    expect(first).toContain("packages/opencorvus/src/session/compaction-handoff.ts")
    expect(first).toContain("Source enabled tool switches: shell")
    expect(first).not.toContain("Source tools:")
  })

  test("renders memory episode from structured handoff fields instead of display Markdown", () => {
    const memory = CompactionHandoff.renderMemoryEpisode(handoffFixture())

    expect(memory).toContain("# Compaction Handoff Memory")
    expect(memory).toContain("## Working Context")
    expect(memory).toContain("Rendered Markdown is display-only; assistant.structured is the resumable handoff source.")
    expect(memory).toContain("## Agent-Specific Handoff")
    expect(memory).toContain("Structured compaction handoff implementation is the active build deliverable")
    expect(memory).toContain("## Chronology")
    expect(memory).toContain("Identified generic summaries as insufficient for resuming session work")
    expect(memory).not.toContain("This session is being continued from a previous conversation")
    expect(memory).not.toContain("Summary:")
  })

  test("memory flush writes structured handoff facts even when display text conflicts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const configSpy = spyOn(EffectiveConfig, "effective").mockResolvedValue({
          experimental: {
            memory: {
              enabled: true,
            },
          },
        } as never)
        const session = await Session.create({ kind: "assistant", title: "structured flush" })
        const handoff = handoffFixture()
        const summary = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          parentID: "m-compaction-user",
          time: { created: Date.now() },
          agent: "compaction",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: "test-model",
          providerID: "test",
          mode: "",
          summary: true,
          finish: "stop",
          structured: handoff,
        } as Message.Assistant)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: summary.id,
          type: "text",
          text: "DISPLAY MARKDOWN CONFLICT: this stale rendered body must not be flushed",
        })

        try {
          await MemoryFlush.flush({ sessionID: session.id, messageID: summary.id })

          const episode = Memory.listFiles({ projectId: Instance.project.id, sessionID: session.id }).find((file) =>
            file.title.includes("structured flush"),
          )
          expect(episode).toBeDefined()
          if (!episode) return
          const content = Memory.getChunks(episode.id)
            .map((chunk) => chunk.content)
            .join("\n")
          expect(content).toContain(
            "Rendered Markdown is display-only; assistant.structured is the resumable handoff source.",
          )
          expect(content).not.toContain("DISPLAY MARKDOWN CONFLICT")
        } finally {
          configSpy.mockRestore()
        }
      },
    })
  }, 15_000)

  test("rejects schema-valid handoff that omits required input evidence", () => {
    const handoff = {
      ...handoffFixture(),
      userMessages: [],
      workingContext: [],
      chronology: [],
      files: [],
      evidence: [],
    }

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["packages/opencorvus/src/session/compaction-handoff.ts"],
      errorNames: [],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("userMessages")
      expect(result.error).toContain("workingContext")
      expect(result.error).toContain("chronology")
      expect(result.error).toContain("files")
    }
  })

  test("rejects rich build handoff with empty build-specific payload", () => {
    const handoff = {
      ...handoffFixture(),
      agentHandoff: {
        kind: "build",
        deliverables: [],
        codeChanges: [],
        verification: [],
        runtimeState: [],
        handoffArtifacts: [],
      },
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      richContext: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoff.todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("agentHandoff.build")
  })

  test("agent handoff schema registry exactly covers built-in agent roles", () => {
    expect(Object.keys(CompactionHandoff.AgentHandoffSchemaByAgent).sort()).toEqual([...AgentRoleContract.ids].sort())
  })

  for (const agent of AgentRoleContract.ids) {
    test(`accepts only ${agent} handoff payload for ${agent} source agent`, () => {
      const handoff = handoffFixtureForAgent(agent)
      const requirements: CompactionHandoff.EvidenceRequirements = {
        sourceUserMessageID: "m-user",
        sourceAgent: agent,
        instructionPaths: ["/repo/AGENTS.md"],
        patchFiles: [],
        errorNames: [],
        userMessages: true,
        fileEvidence: false,
        errorsAndBlockers: false,
        acceptanceCriteria: true,
        todos: handoff.todos,
      }

      expect(SessionCompaction.validateHandoffPayload(handoff, requirements).success).toBe(true)
      const wrongPayload = agent === "build" ? agentHandoffFixture("orchestrator") : agentHandoffFixture("build")
      const wrongHandoff = { ...handoff, agentHandoff: wrongPayload }
      expect(CompactionHandoff.schemaForAgent(agent).safeParse(wrongHandoff).success).toBe(false)
    })
  }

  test("custom agent payload requires exact source agent name", () => {
    const handoff = handoffFixtureForAgent("custom-reviewer")
    const requirements: CompactionHandoff.EvidenceRequirements = {
      sourceUserMessageID: "m-user",
      sourceAgent: "custom-reviewer",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoff.todos,
    }

    expect(SessionCompaction.validateHandoffPayload(handoff, requirements).success).toBe(true)
    const customPayload = handoff.agentHandoff as Extract<CompactionHandoff.AgentHandoff, { kind: "custom-agent" }>
    const mismatched = {
      ...handoff,
      agentHandoff: {
        ...customPayload,
        agentName: "other-custom-agent",
      },
    } satisfies CompactionHandoff.Info

    expect(CompactionHandoff.schemaForAgent("custom-reviewer").safeParse(mismatched).success).toBe(true)
    expect(SessionCompaction.validateHandoffPayload(mismatched, requirements).success).toBe(false)
    expect(CompactionHandoff.isValidStructured(mismatched)).toBe(false)
  })

  test("rejects persisted summary whose payload kind does not match source agent", () => {
    const mismatched = {
      ...handoffFixture(),
      agentHandoff: agentHandoffFixture("orchestrator"),
    } satisfies CompactionHandoff.Info

    expect(CompactionHandoff.Schema.safeParse(mismatched).success).toBe(true)
    expect(CompactionHandoff.isValidStructured(mismatched)).toBe(false)
    expect(
      CompactionHandoff.isValidSummaryMessage({
        role: "assistant",
        summary: true,
        finish: "stop",
        structured: mismatched,
      }),
    ).toBe(false)
  })

  test("accepts explicit empty arrays only when input facts prove those fields absent", () => {
    const handoff = {
      ...handoffFixture(),
      files: [],
      testsAndCommands: [],
      errorsAndBlockers: [],
      openRisks: [],
    }

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(true)
  })

  test("requires active build contracts to preserve exact artifact ids and source artifacts", () => {
    const activeBuildContracts: CompactionHandoff.Info["activeBuildContracts"] = [
      {
        sessionID: "ses-build",
        goalID: "goal-alpha",
        goalRunID: "goal-run-alpha",
        artifactID: "artifact-contract-alpha",
        sourceArtifactIDs: ["artifact-source-a", "artifact-source-b"],
        digest: "digest-alpha",
      },
    ]
    const requirements: CompactionHandoff.EvidenceRequirements = {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
      activeBuildContracts,
    }

    expect(
      CompactionHandoff.validateMinimumEvidence(
        {
          ...handoffFixture(),
          activeBuildContracts,
        },
        requirements,
      ).success,
    ).toBe(true)

    const changed = CompactionHandoff.validateMinimumEvidence(
      {
        ...handoffFixture(),
        activeBuildContracts: [
          {
            ...activeBuildContracts[0],
            sourceArtifactIDs: ["artifact-source-a"],
          },
        ],
      },
      requirements,
    )
    expect(changed.success).toBe(false)
    if (!changed.success) expect(changed.error).toContain("activeBuildContracts")
  })

  test("requires working context and chronology for assistant-only compacted history", () => {
    const assistantOnlyHead: Message.WithParts[] = [
      {
        info: {
          id: "m-assistant-only",
          sessionID: "session",
          role: "assistant",
          time: { created: 0 },
          parentID: "m-user",
          modelID: "test-model",
          providerID: "test",
          agent: "build",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } as Message.Assistant,
        parts: [
          {
            id: "p-assistant-text",
            sessionID: "session",
            messageID: "m-assistant-only",
            type: "text",
            text: "Implemented the parser but still need to run regression tests.",
          },
        ],
      },
    ]
    const requirements = SessionCompaction.TestHooks.selectedHeadEvidenceRequirements({
      messages: assistantOnlyHead,
      instructionPaths: ["/repo/AGENTS.md"],
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      todos: handoffFixture().todos,
    })
    const handoff = {
      ...handoffFixture(),
      userMessages: [],
      workingContext: [],
      chronology: [],
    } satisfies CompactionHandoff.Info

    expect(requirements.userMessages).toBe(false)
    expect(requirements.richContext).toBe(true)
    const result = CompactionHandoff.validateMinimumEvidence(handoff, requirements)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("workingContext")
      expect(result.error).toContain("chronology")
      expect(result.error).not.toContain("userMessages")
    }
  })

  test("rejects handoff todos that do not exactly match runtime todo order and fields", () => {
    const handoff = {
      ...handoffFixture(),
      todos: [
        {
          content: "Run targeted compaction tests",
          status: "in_progress",
          priority: "high",
        },
      ],
    }

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("todos")
  })

  test("rejects non-empty handoff evidence that does not match runtime facts", () => {
    const handoff = {
      ...handoffFixture(),
      currentState: {
        ...handoffFixture().currentState,
        sourceUserMessage: {
          ...handoffFixture().currentState.sourceUserMessage,
          id: "forged-user",
        },
      },
      durableInstructionSources: [{ path: "/repo/OTHER.md", role: "wrong source" }],
      files: [{ path: "forged.ts", status: "modified", detail: "not present in patch evidence" }],
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["packages/opencorvus/src/session/compaction-handoff.ts"],
      errorNames: [],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("currentState.sourceUserMessage.id")
      expect(result.error).toContain("durableInstructionSources")
      expect(result.error).toContain("files")
    }
  })

  test("requires every runtime patch file and error name to be reported exactly", () => {
    const handoff = {
      ...handoffFixture(),
      files: [{ path: "a.ts", status: "modified", detail: "first runtime patch file" }],
      evidence: [
        {
          kind: "error",
          value: "NotAPIErrorFake",
          detail: "substring spoof must not satisfy exact error-name evidence",
        },
      ],
      errorsAndBlockers: [],
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["a.ts", "b.ts"],
      errorNames: ["APIError", "ToolSchemaBudgetError"],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: true,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("files")
      expect(result.error).toContain("errorsAndBlockers")
    }
  })

  test("rejects follow-up handoff that drops previous structured handoff facts", () => {
    const previous = {
      ...handoffFixture(),
      errorsAndBlockers: [
        {
          issue: "Provider returned context overflow during compaction",
          evidence: "ContextOverflowError in previous handoff",
          nextAction: "Preserve overflow root cause for continuation",
        },
      ],
      openRisks: ["Prior risk sentinel must survive follow-up compaction"],
    } satisfies CompactionHandoff.Info
    const handoff = {
      ...handoffFixture(),
      acceptanceCriteria: ["New compacted-history acceptance only"],
      workingContext: ["New compacted-history working context only"],
      chronology: [
        {
          event: "New compacted-history event only",
          evidence: "new evidence",
        },
      ],
      decisions: [
        {
          decision: "New compacted-history decision only",
          rationale: "new-only rationale",
          evidence: "new-only evidence",
        },
      ],
      evidence: [
        {
          kind: "command",
          value: "new-only command",
          detail: "new-only evidence detail",
        },
      ],
      files: [
        {
          path: "new-only.ts",
          status: "modified",
          detail: "new-only file detail",
        },
      ],
      testsAndCommands: [
        {
          command: "new-only test",
          result: "passed",
          evidence: "new-only output",
        },
      ],
      errorsAndBlockers: [
        {
          issue: "New compacted-history blocker only",
          evidence: "new-only blocker evidence",
          nextAction: "new-only blocker action",
        },
      ],
      userMessages: ["New compacted-history user message only"],
      nextActions: ["new-only next action"],
      openRisks: ["new-only risk"],
      agentHandoff: {
        kind: "build",
        deliverables: [{ fact: "New build deliverable only", evidence: "new-only evidence" }],
        codeChanges: [],
        verification: [],
        runtimeState: [],
        handoffArtifacts: [],
      },
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: false,
      richContext: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoff.todos,
      previousHandoff: previousRetention(previous),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("previousHandoff.acceptanceCriteria")
      expect(result.error).toContain("previousHandoff.workingContext")
      expect(result.error).toContain("previousHandoff.chronology")
      expect(result.error).toContain("previousHandoff.decisions")
      expect(result.error).toContain("previousHandoff.evidence")
      expect(result.error).toContain("previousHandoff.files")
      expect(result.error).toContain("previousHandoff.testsAndCommands")
      expect(result.error).toContain("previousHandoff.errorsAndBlockers")
      expect(result.error).toContain("previousHandoff.userMessages")
      expect(result.error).toContain("previousHandoff.nextActions")
      expect(result.error).toContain("previousHandoff.openRisks")
      expect(result.error).toContain("previousHandoff.agentHandoff")
    }
  })

  test("rejects follow-up handoff that moves prior agent facts into a different handoff field", () => {
    const previous = handoffFixture()
    const previousBuild = previous.agentHandoff as Extract<CompactionHandoff.AgentHandoff, { kind: "build" }>
    const moved = {
      ...previous,
      agentHandoff: {
        kind: "build",
        deliverables: previousBuild.deliverables,
        codeChanges: previousBuild.codeChanges,
        verification: [],
        runtimeState: [
          ...previousBuild.runtimeState,
          {
            fact: previousBuild.verification[0].command,
            evidence: previousBuild.verification[0].evidence,
          },
        ],
        handoffArtifacts: previousBuild.handoffArtifacts,
      },
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(moved, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: false,
      richContext: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: previous.todos,
      previousHandoff: previousRetention(previous),
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("previousHandoff.agentHandoff")
  })

  test("accepts follow-up handoff that retains previous structured handoff facts", () => {
    const previous = {
      ...handoffFixture(),
      errorsAndBlockers: [
        {
          issue: "Provider returned context overflow during compaction",
          evidence: "ContextOverflowError in previous handoff",
          nextAction: "Preserve overflow root cause for continuation",
        },
      ],
      openRisks: ["Prior risk sentinel must survive follow-up compaction"],
    } satisfies CompactionHandoff.Info
    const handoff = {
      ...handoffFixture(),
      acceptanceCriteria: [...previous.acceptanceCriteria, "New compacted-history acceptance"],
      workingContext: [...previous.workingContext, "New compacted-history working context"],
      chronology: [
        ...previous.chronology,
        {
          event: "New compacted-history event",
          evidence: "new evidence",
        },
      ],
      decisions: [
        ...previous.decisions,
        {
          decision: "New compacted-history decision",
          rationale: "new rationale",
          evidence: "new evidence",
        },
      ],
      evidence: [
        ...previous.evidence,
        {
          kind: "command",
          value: "new command",
          detail: "new evidence detail",
        },
      ],
      files: [
        ...previous.files,
        {
          path: "new.ts",
          status: "modified",
          detail: "new file detail",
        },
      ],
      testsAndCommands: [
        ...previous.testsAndCommands,
        {
          command: "new test",
          result: "passed",
          evidence: "new output",
        },
      ],
      errorsAndBlockers: [
        ...previous.errorsAndBlockers,
        {
          issue: "New compacted-history blocker",
          evidence: "new blocker evidence",
          nextAction: "new blocker action",
        },
      ],
      userMessages: [...previous.userMessages, "New compacted-history user message"],
      nextActions: [...previous.nextActions, "new next action"],
      openRisks: [...previous.openRisks, "new risk"],
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: false,
      richContext: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoff.todos,
      previousHandoff: previousRetention(previous),
    })

    expect(result.success).toBe(true)
  })

  test("host prompt always includes the structured handoff schema", () => {
    const prompt = SessionCompaction.buildPrompt({
      sourceAgent: "build",
      runtime: "<handoff-runtime-state></handoff-runtime-state>",
      context: ["plugin context"],
    })

    expect(prompt).toContain("CompactionHandoff schema")
    expect(prompt).toContain('Agent-specific compact payload for source agent "build"')
    expect(prompt).toContain('"deliverables"')
    expect(prompt).toContain('"durableInstructionSources"')
    expect(prompt).toContain('"todos"')
    expect(prompt).toContain('"userMessages"')
    expect(prompt).toContain("If the StructuredOutput tool returns an error")
    expect(prompt).toContain("plugin context")
  })

  test("host prompt merges prior structured handoff instead of rendered Markdown", () => {
    const handoff = handoffFixture()
    const prompt = SessionCompaction.buildPrompt({
      sourceAgent: "build",
      previousHandoff: handoff,
      runtime: "<handoff-runtime-state></handoff-runtime-state>",
      context: [],
    })

    expect(prompt).toContain("<previous-structured-handoff>")
    expect(prompt).toContain(
      '"objective": "Harden compaction handoff so session continuation keeps requirements intact"',
    )
    expect(prompt).toContain("rendered Markdown summaries are display-only")
    expect(prompt).not.toContain("<previous-summary>")
    expect(prompt).not.toContain("1. Primary Request and Intent:")
  })

  test("handoff output format exposes the CompactionHandoff schema for StructuredOutput", () => {
    const format = SessionCompaction.handoffOutputFormat({ agent: "build" })

    expect(format.type).toBe("json_schema")
    expect(format.schema).toMatchObject({
      type: "object",
      required: expect.arrayContaining([
        "objective",
        "agentHandoff",
        "currentState",
        "todos",
        "workingContext",
        "chronology",
        "nextActions",
      ]),
    })
    expect(format.retryCount).toBe(2)
    expect(JSON.stringify(format.schema)).toContain("activeBuildContracts")
    expect(JSON.stringify(format.schema)).toContain("deliverables")
    expect(JSON.stringify(format.schema)).not.toContain("workflowDecisions")
    expect(JSON.stringify(format.schema)).toContain("workingContext")
    expect(JSON.stringify(format.schema)).toContain("chronology")
  })

  test("rejects source-agent payload kind mismatch", () => {
    const handoff = {
      ...handoffFixture(),
      agentHandoff: {
        kind: "orchestrator",
        workflowDecisions: [{ fact: "scheduler decision cannot stand in for build work", evidence: "test" }],
        delegatedSessions: [],
        goalGraphState: [],
        pendingDecisions: [],
      },
    }
    const requirements: CompactionHandoff.EvidenceRequirements = {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    }

    const result = SessionCompaction.validateHandoffPayload(handoff, requirements)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("agentHandoff")
  })

  test("compaction stop condition waits for captured handoff instead of first tool call", async () => {
    let captured = false
    const stop = SessionCompaction.TestHooks.structuredHandoffStopCondition({
      isCaptured: () => captured,
      retryCount: 2,
    })
    const structuredOutputStep = {
      toolCalls: [{ toolName: "StructuredOutput" }],
    } as any

    expect(await stop({ steps: [structuredOutputStep] })).toBe(false)
    expect(await stop({ steps: [structuredOutputStep, structuredOutputStep] })).toBe(false)
    expect(await stop({ steps: [structuredOutputStep, structuredOutputStep, structuredOutputStep] })).toBe(true)

    captured = true
    expect(await stop({ steps: [structuredOutputStep] })).toBe(true)
  })

  test("validates StructuredOutput payloads instead of accepting fenced JSON text", () => {
    const handoff = handoffFixture()
    const requirements: CompactionHandoff.EvidenceRequirements = {
      sourceUserMessageID: "m-user",
      sourceAgent: "build",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoff.todos,
    }

    expect(SessionCompaction.validateHandoffPayload(handoff, requirements).success).toBe(true)
    const fenced = `\`\`\`json\n${JSON.stringify(handoff)}\n\`\`\``
    const invalid = SessionCompaction.validateHandoffPayload(fenced, requirements)
    expect(invalid.success).toBe(false)
    if (!invalid.success) expect(invalid.error).toContain("expected object")
  })

  test("request budget preflight catches oversize compaction payloads", () => {
    const model = createModel({ context: 100, output: 10 })
    const config = {} as Config.Info

    const oversized = SessionCompaction.requestBudget({
      messages: [{ role: "user", content: "x".repeat(1_000) }],
      config,
      model,
    })
    const normal = SessionCompaction.requestBudget({
      messages: [{ role: "user", content: "short" }],
      config,
      model,
    })

    expect(oversized.exceeds).toBe(true)
    expect(normal.exceeds).toBe(false)
  })

  test("runtime context injects current todos as exact structured handoff requirements", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "todo compaction" })
        const todos = [
          { content: "Keep exact todo text", status: "in_progress", priority: "high" },
          { content: "Do not reorder this item", status: "pending", priority: "medium" },
        ]
        Todo.update({ sessionID: session.id, todos })
        const user = {
          id: "m-user",
          sessionID: session.id,
          role: "user",
          time: { created: 0 },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        } as Message.User

        const runtime = await SessionCompaction.TestHooks.runtimeContext({
          sessionID: session.id,
          userMessage: user,
          selectedHead: [],
        })

        expect(runtime.text).toContain("Current todos. Copy this JSON array exactly")
        expect(runtime.text).toContain('"content": "Keep exact todo text"')
        expect(runtime.evidenceRequirements.todos).toEqual(todos)
      },
    })
  })

  test("runtime context keeps build input evidence behind active build contract ids", async () => {
    await resetDatabase()
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const session = await Session.create({ kind: "assistant", title: "build contract compaction" })
        const taskID = `tsk_compaction_contract_${now.toString(16)}`
        const runID = `run_compaction_contract_${now.toString(16)}`
        const goalID = `gol_compaction_contract_${now.toString(16)}`
        const goalRunID = `glr_compaction_contract_${now.toString(16)}`
        const contractID = `artifact_compaction_contract_${now.toString(16)}`
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              source: "test",
              title: "Compaction contract projection",
              request: "preserve active build contract ids",
              kind: "workflow",
              priority: "normal",
              attachments: [
                {
                  sha: "current-task-sha",
                  url: `/attachment/${Instance.project.id}/current-task-sha.png`,
                  mime: "image/png",
                  size: 10,
                  filename: "current.png",
                },
              ],
              time_created: now,
              time_updated: now,
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: contractID,
              task_id: taskID,
              run_id: runID,
              goal_run_id: goalRunID,
              kind: "build_session_contract",
              label: "build-session-contract",
              payload: {
                session_id: session.id,
                task_id: taskID,
                goal_id: goalID,
                goal_run_id: goalRunID,
                source_artifact_ids: ["artifact-source-contract"],
                digest: "digest-compaction-contract",
                input_evidence: {
                  version: 1,
                  project_id: Instance.project.id,
                  task_id: taskID,
                  goal_id: goalID,
                  goal_run_id: goalRunID,
                  session_id: session.id,
                  entries: [
                    {
                      role: "source",
                      project_id: Instance.project.id,
                      sha: "contract-input-sha",
                      mime: "image/png",
                      size: 10,
                      filename: "contract.png",
                      legacy_attachment_url: `/attachment/${Instance.project.id}/contract-input-sha.png`,
                      staged_rel_path: ".opencorvus/input/contract.png",
                      sha_verified_at: now,
                    },
                  ],
                },
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        const user = {
          id: "m-user",
          sessionID: session.id,
          role: "user",
          time: { created: 0 },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        } as Message.User

        const runtime = await SessionCompaction.TestHooks.runtimeContext({
          sessionID: session.id,
          userMessage: user,
          selectedHead: [],
        })

        expect(runtime.evidenceRequirements.activeBuildContracts).toEqual([
          {
            sessionID: session.id,
            goalID,
            goalRunID,
            artifactID: contractID,
            sourceArtifactIDs: ["artifact-source-contract"],
            digest: "digest-compaction-contract",
          },
        ])
        expect(runtime.text).toContain(contractID)
        expect(runtime.text).toContain("artifact-source-contract")
        expect(runtime.text).not.toContain("contract-input-sha")
        expect(runtime.text).not.toContain("current-task-sha")
      },
    })
  })

  test("runtime context carries previous structured handoff retention requirements", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "previous handoff retention" })
        const previous = handoffFixture()
        const user = {
          id: "m-user",
          sessionID: session.id,
          role: "user",
          time: { created: 0 },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        } as Message.User

        const runtime = await SessionCompaction.TestHooks.runtimeContext({
          sessionID: session.id,
          userMessage: user,
          selectedHead: [],
          previousHandoff: previous,
        })

        expect(runtime.evidenceRequirements.previousHandoff?.acceptanceCriteria).toEqual(previous.acceptanceCriteria)
        expect(runtime.evidenceRequirements.previousHandoff?.workingContext).toEqual(previous.workingContext)
        expect(runtime.evidenceRequirements.previousHandoff?.chronology).toEqual(
          previous.chronology.map((item) => item.event),
        )
        expect(runtime.evidenceRequirements.previousHandoff?.agentHandoff).toContain(
          "agentHandoff.deliverables.fact=Structured compaction handoff implementation is the active build deliverable",
        )
        expect(runtime.text).toContain("<previous-handoff-required-retention>")
        expect(runtime.text).toContain("<agentHandoff>")
      },
    })
  })
})

describe("session.compaction.prune", () => {
  const largeOutput = "tool output evidence\n".repeat(6_000)

  function compactedHistoryMessages(input?: { structured?: boolean; tail?: boolean }) {
    const anchor = userMessage("m-anchor", [
      { ...basePart("m-anchor", "p-anchor"), type: "text", text: "original user request" },
    ])
    const coveredOlder = assistantMessage("m-covered-older", "m-anchor", [
      toolPart("m-covered-older", "p-covered-older", largeOutput),
    ])
    const coveredNewer = assistantMessage("m-covered-newer", "m-anchor", [
      toolPart("m-covered-newer", "p-covered-newer", largeOutput),
    ])
    const tailUser = userMessage("m-tail", [
      { ...basePart("m-tail", "p-tail-user"), type: "text", text: "retained tail request" },
    ])
    const tailAssistant = assistantMessage("m-tail-assistant", "m-tail", [
      toolPart("m-tail-assistant", "p-tail-tool", largeOutput),
    ])
    const compactUser = userMessage("m-compact", [
      {
        ...basePart("m-compact", "p-compact"),
        type: "compaction",
        auto: true,
        anchor_id: "m-anchor",
        ...(input?.tail ? { tail_start_id: "m-tail" } : {}),
      },
    ])
    const compactSummary = assistantMessage(
      "m-compact-summary",
      "m-compact",
      [{ ...basePart("m-compact-summary", "p-summary"), type: "text", text: "rendered summary" }],
      input?.structured
        ? {
            summary: true,
            finish: "stop",
            structured: handoffFixture(),
          }
        : {
            summary: true,
            finish: "stop",
          },
    )
    return [anchor, coveredOlder, coveredNewer, tailUser, tailAssistant, compactUser, compactSummary]
  }

  test("does not prune tool outputs without a valid structured handoff boundary", () => {
    const messages = compactedHistoryMessages({ structured: false, tail: true })

    const selected = SessionCompaction.TestHooks.prunableToolParts(messages)

    expect(selected).toHaveLength(0)
  })

  test("does not prune when stored tail_start_id is missing", () => {
    const messages = compactedHistoryMessages({ structured: true, tail: true }).map((message) => {
      if (message.info.id !== "m-compact") return message
      return {
        ...message,
        parts: message.parts.map((part) =>
          part.type === "compaction" ? { ...part, tail_start_id: "m-missing-tail" } : part,
        ),
      }
    })

    const selected = SessionCompaction.TestHooks.prunableToolParts(messages)

    expect(selected).toHaveLength(0)
  })

  test("does not prune when stored tail_start_id points to an assistant message", () => {
    const messages = compactedHistoryMessages({ structured: true, tail: true }).map((message) => {
      if (message.info.id !== "m-compact") return message
      return {
        ...message,
        parts: message.parts.map((part) =>
          part.type === "compaction" ? { ...part, tail_start_id: "m-tail-assistant" } : part,
        ),
      }
    })

    const selected = SessionCompaction.TestHooks.prunableToolParts(messages)

    expect(selected).toHaveLength(0)
  })

  test("prunes only tool outputs covered by the latest structured handoff", () => {
    const messages = compactedHistoryMessages({ structured: true, tail: true })

    const selected = SessionCompaction.TestHooks.prunableToolParts(messages)

    expect(selected.map((part) => part.id)).toEqual(["p-covered-older"])
    expect(selected.some((part) => part.id === "p-tail-tool")).toBe(false)
  })

  test("uses compaction marker as prune boundary when no tail was preserved", () => {
    const messages = compactedHistoryMessages({ structured: true, tail: false })

    const selected = SessionCompaction.TestHooks.prunableToolParts(messages)

    expect(selected.map((part) => part.id)).toEqual(["p-covered-newer", "p-covered-older"])
  })

  test("uses marker-on-anchor summary as prune boundary when no tail was preserved", () => {
    const anchor = userMessage("m-anchor", [
      { ...basePart("m-anchor", "p-anchor"), type: "text", text: "original user request" },
      {
        ...basePart("m-anchor", "p-anchor-compaction"),
        type: "compaction",
        auto: true,
        anchor_id: "m-anchor",
      },
    ])
    const coveredOlder = assistantMessage("m-covered-older", "m-anchor", [
      toolPart("m-covered-older", "p-covered-older", largeOutput),
    ])
    const coveredNewer = assistantMessage("m-covered-newer", "m-anchor", [
      toolPart("m-covered-newer", "p-covered-newer", largeOutput),
    ])
    const compactSummary = assistantMessage(
      "m-compact-summary",
      "m-anchor",
      [{ ...basePart("m-compact-summary", "p-summary"), type: "text", text: "rendered summary" }],
      {
        summary: true,
        finish: "stop",
        structured: handoffFixture(),
      },
    )
    const messages = [anchor, coveredOlder, coveredNewer, compactSummary]

    const selected = SessionCompaction.TestHooks.prunableToolParts(messages)

    expect(selected.map((part) => part.id)).toEqual(["p-covered-older"])
  })

  test("uses marker-on-anchor tail_start_id as prune boundary when a user tail was preserved", () => {
    const anchor = userMessage("m-anchor", [
      { ...basePart("m-anchor", "p-anchor"), type: "text", text: "original user request" },
      {
        ...basePart("m-anchor", "p-anchor-compaction"),
        type: "compaction",
        auto: true,
        anchor_id: "m-anchor",
        tail_start_id: "m-tail",
      },
    ])
    const coveredOlder = assistantMessage("m-covered-older", "m-anchor", [
      toolPart("m-covered-older", "p-covered-older", largeOutput),
    ])
    const coveredNewer = assistantMessage("m-covered-newer", "m-anchor", [
      toolPart("m-covered-newer", "p-covered-newer", largeOutput),
    ])
    const tailUser = userMessage("m-tail", [
      { ...basePart("m-tail", "p-tail-user"), type: "text", text: "preserved tail request" },
    ])
    const tailAssistant = assistantMessage("m-tail-assistant", "m-tail", [
      toolPart("m-tail-assistant", "p-tail-tool", largeOutput),
    ])
    const compactSummary = assistantMessage(
      "m-compact-summary",
      "m-anchor",
      [{ ...basePart("m-compact-summary", "p-summary"), type: "text", text: "rendered summary" }],
      {
        summary: true,
        finish: "stop",
        structured: handoffFixture(),
      },
    )
    const messages = [anchor, coveredOlder, coveredNewer, tailUser, tailAssistant, compactSummary]

    const selected = SessionCompaction.TestHooks.prunableToolParts(messages)

    expect(selected.map((part) => part.id)).toEqual(["p-covered-older"])
    expect(selected.some((part) => part.id === "p-tail-tool")).toBe(false)
  })

  test("database prune does not compact tool output when tail_start_id points to assistant", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "malformed prune tail" })
        const anchor = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        } as Message.User)
        const covered = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          parentID: anchor.id,
          time: { created: Date.now() + 1 },
          agent: "build",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test-model",
          providerID: "test",
          mode: "",
        } as Message.Assistant)
        const tailUser = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() + 2 },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        } as Message.User)
        const tailAssistant = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          parentID: tailUser.id,
          time: { created: Date.now() + 3 },
          agent: "build",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test-model",
          providerID: "test",
          mode: "",
        } as Message.Assistant)
        const compactUser = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() + 4 },
          agent: "compaction",
          model: { providerID: "test", modelID: "test-model" },
        } as Message.User)
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          parentID: compactUser.id,
          time: { created: Date.now() + 5 },
          agent: "compaction",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test-model",
          providerID: "test",
          mode: "",
          summary: true,
          finish: "stop",
          structured: handoffFixture(),
        } as Message.Assistant)
        const toolID = Identifier.ascending("part")
        await Session.updatePart({
          id: toolID,
          sessionID: session.id,
          messageID: covered.id,
          type: "tool",
          callID: "call-covered",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo covered" },
            output: largeOutput,
            title: "bash",
            metadata: {},
            time: { start: 0, end: 1 },
          },
        } satisfies Message.ToolPart)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: compactUser.id,
          type: "compaction",
          auto: true,
          anchor_id: anchor.id,
          tail_start_id: tailAssistant.id,
        } satisfies Message.CompactionPart)

        await SessionCompaction.prune({ sessionID: session.id })

        const parts = await Message.parts(covered.id)
        const tool = parts.find((part): part is Message.ToolPart => part.type === "tool")
        expect(tool?.state.status).toBe("completed")
        if (tool?.state.status === "completed") {
          expect(tool.state.time.compacted).toBeUndefined()
        }
      },
    })
  }, 15_000)
})

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

describe("session.compaction.isOverflow", () => {
  test("returns true when token count exceeds usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when token count within usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("includes cache.read in token count", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 60_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("respects input limit for input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 271_000, output: 1_000, reasoning: 0, cache: { read: 2_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when below input-limit compaction threshold", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 120_000, output: 20_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("default auto-compaction threshold is ninety percent of usable input budget", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 20_000 })
        // usable = 100_000 - reserved(20_000) = 80_000; threshold 0.9 -> limit 72_000.
        // usageCount = input + output + cache.
        const below = { input: 70_000, output: 1_999, reasoning: 0, cache: { read: 0, write: 0 } }
        const atLimit = { input: 70_000, output: 2_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens: below, model })).toBe(false)
        expect(await SessionCompaction.isOverflow({ tokens: atLimit, model })).toBe(true)
      },
    })
  })

  test("returns false when output within limit with input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, input: 120_000, output: 10_000 })
        const tokens = { input: 50_000, output: 9_999, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("reserves headroom when limit.input is set", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })
        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("without limit.input, same token count triggers compaction", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }

        const result = await SessionCompaction.isOverflow({ tokens, model })
        expect(result).toBe(true)
      },
    })
  })

  test("input-limit and context-only models compact consistently near the boundary", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const withInputLimit = createModel({ context: 200_000, input: 200_000, output: 32_000 })
        const withoutInputLimit = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 166_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }

        const withLimit = await SessionCompaction.isOverflow({ tokens, model: withInputLimit })
        const withoutLimit = await SessionCompaction.isOverflow({ tokens, model: withoutInputLimit })

        expect(withLimit).toBe(true)
        expect(withoutLimit).toBe(true)
      },
    })
  })

  test("returns false when model context limit is 0", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 0, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when compaction.auto is disabled", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const configDir = path.join(dir, ".opencorvus")
        await fs.mkdir(configDir, { recursive: true })
        await Bun.write(
          path.join(configDir, "opencorvus.json"),
          JSON.stringify({
            compaction: { auto: false },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })
})

describe("util.token.estimate", () => {
  test("estimates tokens from text (4 chars per token)", () => {
    const text = "x".repeat(4000)
    expect(Token.estimate(text)).toBe(1000)
  })

  test("estimates tokens from larger text", () => {
    const text = "y".repeat(20_000)
    expect(Token.estimate(text)).toBe(5000)
  })

  test("returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })
})

describe("session.getUsage", () => {
  test("normalizes standard usage to token format", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(result.tokens.total).toBe(1500)
  })

  test("derives total token usage when the provider omits totalTokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: 100,
        cachedInputTokens: 200,
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(100)
    expect(result.tokens.cache.read).toBe(200)
    expect(result.tokens.total).toBe(1600)
  })

  test("extracts cached tokens to cache.read", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles anthropic cache write metadata", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.cache.write).toBe(300)
  })

  test("does not subtract cached tokens for anthropic provider", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
      metadata: {
        anthropic: {},
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles reasoning tokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 100,
      },
    })

    expect(result.tokens.reasoning).toBe(100)
  })

  test("handles undefined optional values gracefully", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    })

    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(Number.isNaN(result.cost)).toBe(false)
  })

  test("calculates cost correctly", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
      },
    })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
      },
    })

    expect(result.cost).toBe(3 + 1.5)
  })

  test.each(["@ai-sdk/anthropic", "@ai-sdk/amazon-bedrock", "@ai-sdk/google-vertex/anthropic"])(
    "computes total from components for %s models",
    (npm) => {
      const model = createModel({ context: 100_000, output: 32_000, npm })
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        // These providers typically report total as input + output only,
        // excluding cache read/write.
        totalTokens: 1500,
        cachedInputTokens: 200,
      }
      if (npm === "@ai-sdk/amazon-bedrock") {
        const result = Session.getUsage({
          model,
          usage,
          metadata: {
            bedrock: {
              usage: {
                cacheWriteInputTokens: 300,
              },
            },
          },
        })

        expect(result.tokens.input).toBe(1000)
        expect(result.tokens.cache.read).toBe(200)
        expect(result.tokens.cache.write).toBe(300)
        expect(result.tokens.total).toBe(2000)
        return
      }

      const result = Session.getUsage({
        model,
        usage,
        metadata: {
          anthropic: {
            cacheCreationInputTokens: 300,
          },
        },
      })

      expect(result.tokens.input).toBe(1000)
      expect(result.tokens.cache.read).toBe(200)
      expect(result.tokens.cache.write).toBe(300)
      expect(result.tokens.total).toBe(2000)
    },
  )
})
