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
    ],
    userMessages: ["Fix compaction evidence validation."],
    nextActions: ["run targeted compaction evidence tests"],
    openRisks: [],
  }
}

describe("compaction evidence contract", () => {
  test("accepts worktree-relative required patch files and exact error tokens", () => {
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

  test("renders required evidence blocks with every validator token", () => {
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

    expect(prompt).toContain("<required-file-evidence>\nserver/db/schema.ts\nserver/db/connection.ts\n</required-file-evidence>")
    expect(prompt).toContain(
      "<required-error-evidence>\nStructuredOutputPayloadError\nStructuredOutput tool error\n</required-error-evidence>",
    )
    expect(prompt).toContain("Every non-empty line inside <required-file-evidence> MUST appear verbatim")
    expect(prompt).toContain("Every non-empty line inside <required-error-evidence> MUST appear verbatim")
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
