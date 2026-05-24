import { describe, expect, test } from "bun:test"
import path from "path"
import { CompactionHandoff } from "../../src/session/compaction-handoff"
import { SessionCompaction } from "../../src/session/compaction"
import { Instance } from "../../src/project/instance"
import { Snapshot } from "../../src/snapshot"
import { tmpdir } from "../fixture/fixture"

function handoffFixture(): CompactionHandoff.Info {
  return {
    objective: "Preserve compaction evidence contracts across context handoff",
    acceptanceCriteria: ["Every required evidence token survives the handoff exactly"],
    durableInstructionSources: [{ path: "/repo/AGENTS.md", role: "project rules" }],
    activeBuildContracts: [],
    currentState: {
      phase: "validating compaction handoff evidence",
      activeTask: "pin required file and error evidence",
      sourceUserMessage: {
        id: "msg-source",
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        formatType: "text",
        systemMode: null,
        toolNames: ["edit"],
        variant: null,
        extraKeys: [],
      },
    },
    decisions: [
      {
        decision: "Use worktree-relative patch paths as the evidence source",
        rationale: "The prompt and validator must compare tokens in the same path space",
        evidence: "server/db/schema.ts",
      },
    ],
    evidence: [],
    files: [{ path: "server/db/schema.ts", status: "modified", detail: "required patch file evidence" }],
    testsAndCommands: [],
    errorsAndBlockers: [
      {
        issue: "StructuredOutputPayloadError",
        evidence: "StructuredOutput tool error",
        nextAction: "teach the model the exact required error tokens in the prompt",
      },
      {
        issue: "Structured output validation failed during compaction",
        evidence: "The StructuredOutput tool returned a validation error",
        nextAction: "retry compaction after correcting the handoff evidence fields",
      },
    ],
    userMessages: ["Fix compaction evidence validation."],
    nextActions: ["run targeted compaction evidence tests"],
    openRisks: [],
  }
}

describe("compaction evidence contract", () => {
  test("accepts worktree-relative required patch files and semantic error acknowledgments", () => {
    const result = CompactionHandoff.validateMinimumEvidence(handoffFixture(), {
      sourceUserMessageID: "msg-source",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["server/db/schema.ts"],
      errorNames: ["StructuredOutputPayloadError", "StructuredOutput tool error"],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: true,
      acceptanceCriteria: true,
    })

    expect(result.success).toBe(true)
  })

  test("rejects a handoff with no error blocker entries when runtime errors exist", () => {
    const result = CompactionHandoff.validateMinimumEvidence(
      {
        ...handoffFixture(),
        errorsAndBlockers: [],
      },
      {
        sourceUserMessageID: "msg-source",
        instructionPaths: ["/repo/AGENTS.md"],
        patchFiles: ["server/db/schema.ts"],
        errorNames: ["StructuredOutputPayloadError"],
        userMessages: true,
        fileEvidence: true,
        errorsAndBlockers: true,
        acceptanceCriteria: true,
      },
    )

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("errorsAndBlockers (no entries)")
  })

  test("validateHandoffPayload completes host-derived runtime evidence before minimum validation", () => {
    const result = SessionCompaction.validateHandoffPayload(
      {
        ...handoffFixture(),
        files: [],
        evidence: [],
        errorsAndBlockers: [],
      },
      {
        sourceUserMessageID: "msg-source",
        instructionPaths: ["/repo/AGENTS.md"],
        patchFiles: ["server/db/schema.ts", "server/db/connection.ts"],
        errorNames: ["StructuredOutputPayloadError", "StructuredOutput tool error"],
        userMessages: true,
        fileEvidence: true,
        errorsAndBlockers: true,
        acceptanceCriteria: true,
      },
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.files.map((item) => item.path)).toEqual(
        expect.arrayContaining(["server/db/schema.ts", "server/db/connection.ts"]),
      )
      expect(result.data.errorsAndBlockers.map((item) => item.evidence)).toEqual(
        expect.arrayContaining(["StructuredOutputPayloadError", "StructuredOutput tool error"]),
      )
    }
  })

  test("accepts three documented blockers for five runtime error tokens", () => {
    const handoff = {
      ...handoffFixture(),
      errorsAndBlockers: [
        {
          issue: "Compaction could not parse structured output",
          evidence: "StructuredOutput validation returned a schema error",
          nextAction: "repair the handoff object shape and rerun compaction",
        },
        {
          issue: "A tool call failed while gathering runtime evidence",
          evidence: "The tool result status was error in the compacted session",
          nextAction: "inspect the failed tool output before continuing implementation",
        },
        {
          issue: "Assistant message recorded an error during the source run",
          evidence: "The source assistant message contains an error object",
          nextAction: "resolve the recorded source error before reporting completion",
        },
      ],
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "msg-source",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["server/db/schema.ts"],
      errorNames: [
        "read tool error",
        "bash tool error",
        "StructuredOutput tool error",
        "APIError",
        "ToolSchemaBudgetError",
      ],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: true,
      acceptanceCriteria: true,
    })

    expect(result.success).toBe(true)
  })

  test("rejects error blocker entries with empty evidence fields", () => {
    const result = CompactionHandoff.validateMinimumEvidence(
      {
        ...handoffFixture(),
        errorsAndBlockers: [
          {
            issue: "Compaction hit a runtime error",
            evidence: "",
            nextAction: "inspect the runtime error context and rerun compaction",
          },
        ],
      } as CompactionHandoff.Info,
      {
        sourceUserMessageID: "msg-source",
        instructionPaths: ["/repo/AGENTS.md"],
        patchFiles: ["server/db/schema.ts"],
        errorNames: ["StructuredOutputPayloadError"],
        userMessages: true,
        fileEvidence: true,
        errorsAndBlockers: true,
        acceptanceCriteria: true,
      },
    )

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("empty fields")
  })

  test("rejects a handoff that genuinely omits a required patch file", () => {
    const result = CompactionHandoff.validateMinimumEvidence(handoffFixture(), {
      sourceUserMessageID: "msg-source",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["server/db/schema.ts", "server/db/connection.ts"],
      errorNames: ["StructuredOutputPayloadError", "StructuredOutput tool error"],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: true,
      acceptanceCriteria: true,
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("files")
  })

  test("renders required file evidence and runtime error context blocks", () => {
    const requirements: CompactionHandoff.EvidenceRequirements = {
      sourceUserMessageID: "msg-source",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["server/db/schema.ts", "server/db/connection.ts"],
      errorNames: ["StructuredOutputPayloadError", "StructuredOutput tool error"],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: true,
      acceptanceCriteria: true,
    }

    const runtime = CompactionHandoff.renderRequiredEvidence(requirements)
    const prompt = SessionCompaction.buildPrompt({
      previousSummary: undefined,
      runtime,
      context: [],
    })

    expect(prompt).toContain(
      "<required-file-evidence>\nserver/db/schema.ts\nserver/db/connection.ts\n</required-file-evidence>",
    )
    expect(prompt).toContain(
      "<runtime-error-context>\nStructuredOutputPayloadError\nStructuredOutput tool error\n</runtime-error-context>",
    )
    expect(prompt).toContain("Every non-empty line inside <required-file-evidence> MUST appear verbatim")
    expect(prompt).toContain("Verbatim echo of the internal tokens is not required")
    expect(prompt).not.toContain("<required-error-evidence>")
  })

  test("normalizes absolute patch evidence to worktree-relative paths before prompt and validation use it", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const absolute = path.join(Instance.worktree, "server/db/schema.ts").replaceAll("\\", "/")
        const summary = Snapshot.patchEvidenceSummary({
          hash: "abc123",
          files: [absolute, "server/db/connection.ts"],
        })
        const formatted = Snapshot.formatPatchEvidence({
          hash: "abc123",
          files: [absolute, "server/db/connection.ts"],
        })

        expect(summary.filesPreviewHead).toEqual(["server/db/schema.ts", "server/db/connection.ts"])
        expect(formatted).toContain("files=server/db/schema.ts, server/db/connection.ts")
        expect(formatted).not.toContain(absolute)
      },
    })
  })
})
