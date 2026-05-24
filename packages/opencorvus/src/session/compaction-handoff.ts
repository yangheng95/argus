import z from "zod"

export namespace CompactionHandoff {
  const NonEmpty = z.string().trim().min(1)
  const GenericAction = /^(continue|keep going|next|next steps?|continue implementation|tbd|n\/a|none)$/i
  const SpecificText = NonEmpty.refine((value) => !GenericAction.test(value.trim()), {
    message: "Generic placeholder text is not a resumable handoff fact",
  })

  export const InstructionSource = z
    .object({
      path: NonEmpty,
      role: NonEmpty,
    })
    .strict()

  export const SourceUserMessage = z
    .object({
      id: NonEmpty,
      agent: NonEmpty,
      model: z
        .object({
          providerID: NonEmpty,
          modelID: NonEmpty,
        })
        .strict(),
      formatType: NonEmpty,
      systemMode: z.string().nullable(),
      toolNames: z.array(NonEmpty),
      variant: z.string().nullable(),
      extraKeys: z.array(NonEmpty),
    })
    .strict()

  export const CurrentState = z
    .object({
      phase: SpecificText,
      activeTask: SpecificText,
      sourceUserMessage: SourceUserMessage,
    })
    .strict()

  export const Decision = z
    .object({
      decision: SpecificText,
      rationale: SpecificText,
      evidence: NonEmpty.optional(),
    })
    .strict()

  export const Evidence = z
    .object({
      kind: z.enum(["file", "command", "test", "error", "tool", "artifact"]),
      value: NonEmpty,
      detail: SpecificText,
    })
    .strict()

  export const File = z
    .object({
      path: NonEmpty,
      status: z.enum(["read", "modified", "created", "deleted", "referenced"]),
      detail: SpecificText,
    })
    .strict()

  export const TestOrCommand = z
    .object({
      command: NonEmpty,
      result: SpecificText,
      evidence: NonEmpty,
    })
    .strict()

  export const ErrorOrBlocker = z
    .object({
      issue: SpecificText,
      evidence: NonEmpty,
      nextAction: SpecificText,
    })
    .strict()

  export const ActiveBuildContract = z
    .object({
      sessionID: NonEmpty,
      goalID: NonEmpty,
      goalRunID: NonEmpty,
      artifactID: NonEmpty,
      sourceArtifactIDs: z.array(NonEmpty),
      digest: NonEmpty,
    })
    .strict()

  export const Schema = z
    .object({
      objective: SpecificText,
      acceptanceCriteria: z.array(SpecificText),
      durableInstructionSources: z.array(InstructionSource),
      activeBuildContracts: z.array(ActiveBuildContract),
      currentState: CurrentState,
      decisions: z.array(Decision),
      evidence: z.array(Evidence),
      files: z.array(File),
      testsAndCommands: z.array(TestOrCommand),
      errorsAndBlockers: z.array(ErrorOrBlocker),
      userMessages: z.array(SpecificText),
      nextActions: z.array(SpecificText),
      openRisks: z.array(SpecificText),
    })
    .strict()

  export type Info = z.infer<typeof Schema>

  export type EvidenceRequirements = {
    sourceUserMessageID: string
    instructionPaths: string[]
    patchFiles: string[]
    errorNames: string[]
    userMessages: boolean
    fileEvidence: boolean
    errorsAndBlockers: boolean
    acceptanceCriteria: boolean
  }

  export const MODEL_OUTPUT_INSTRUCTIONS = [
    "Call the StructuredOutput tool exactly once with one object that matches the CompactionHandoff schema.",
    "Do not write Markdown, prose, or a raw JSON text response; the handoff object must be the StructuredOutput tool input.",
    "Every retained claim must be grounded in the supplied conversation, runtime state, or evidence context.",
    "List all user-authored messages that appear in the compacted history in userMessages, preserving their intent and important wording.",
    'Every non-empty line inside <required-file-evidence> MUST appear verbatim in files[].path or evidence[].value with kind="file".',
    "The <runtime-error-context> block lists internal error tokens collected during this session. For each distinct root cause, write at least one errorsAndBlockers entry in your own words with concrete issue, evidence, and nextAction. Verbatim echo of the internal tokens is not required.",
    "Use empty arrays only when no evidence exists for that field.",
    'Generic placeholders such as "continue implementation" are invalid.',
    "Do not treat assistant reasoning, tool-choice indecision, or checkpoint prompts as user requirements.",
    "When active build-session contract facts are supplied, copy their ids into activeBuildContracts instead of paraphrasing them.",
  ].join("\n")

  export function renderRequiredEvidence(requirements: Pick<EvidenceRequirements, "patchFiles" | "errorNames">) {
    return [
      "<required-file-evidence>",
      ...requirements.patchFiles,
      "</required-file-evidence>",
      "",
      "<runtime-error-context>",
      ...requirements.errorNames,
      "</runtime-error-context>",
    ].join("\n")
  }

  export const JSON_SCHEMA_DESCRIPTION = `{
  "objective": "specific active user objective",
  "acceptanceCriteria": ["durable requirements and explicit acceptance checks"],
  "durableInstructionSources": [{"path": "absolute or configured instruction path", "role": "why this source is authoritative"}],
  "activeBuildContracts": [{"sessionID": "build session id", "goalID": "goal id", "goalRunID": "active logical attempt id", "artifactID": "build_session_contract artifact id", "sourceArtifactIDs": ["source artifact ids"], "digest": "contract snapshot digest"}],
  "currentState": {
    "phase": "specific current phase",
    "activeTask": "specific active task",
    "sourceUserMessage": {
      "id": "message id",
      "agent": "agent name",
      "model": {"providerID": "provider id", "modelID": "model id"},
      "formatType": "text or structured output format type",
      "systemMode": "system mode or null",
      "toolNames": ["enabled tool names"],
      "variant": "message variant",
      "extraKeys": ["source extra keys"]
    }
  },
  "decisions": [{"decision": "specific decision", "rationale": "why", "evidence": "optional source"}],
  "evidence": [{"kind": "file|command|test|error|tool|artifact", "value": "exact identifier", "detail": "specific observed fact"}],
  "files": [{"path": "exact path", "status": "read|modified|created|deleted|referenced", "detail": "specific relevance"}],
  "testsAndCommands": [{"command": "exact command", "result": "specific result", "evidence": "exit status or output excerpt"}],
  "errorsAndBlockers": [{"issue": "specific issue", "evidence": "exact evidence", "nextAction": "specific next action"}],
  "userMessages": ["all user-authored messages from the compacted history, summarized only enough to remove repetition"],
  "nextActions": ["specific next action"],
  "openRisks": ["specific unresolved risk"]
}`

  export function validateMinimumEvidence(handoff: Info, requirements: EvidenceRequirements) {
    const missing: string[] = []
    if (handoff.currentState.sourceUserMessage.id !== requirements.sourceUserMessageID) {
      missing.push("currentState.sourceUserMessage.id")
    }
    if (requirements.userMessages && handoff.userMessages.length === 0) missing.push("userMessages")
    const reportedInstructionPaths = new Set(handoff.durableInstructionSources.map((item) => item.path))
    const omittedInstructionPaths = requirements.instructionPaths.filter((item) => !reportedInstructionPaths.has(item))
    if (omittedInstructionPaths.length > 0) {
      missing.push("durableInstructionSources")
    }
    const reportedFileEvidence = new Set([
      ...handoff.files.map((item) => item.path),
      ...handoff.evidence.filter((item) => item.kind === "file").map((item) => item.value),
    ])
    const omittedPatchFiles = requirements.patchFiles.filter((item) => !reportedFileEvidence.has(item))
    if (requirements.fileEvidence && omittedPatchFiles.length > 0) {
      missing.push("files")
    }
    if (requirements.errorsAndBlockers) {
      const emptyErrorFields = handoff.errorsAndBlockers.flatMap((item, index) =>
        (["issue", "evidence", "nextAction"] as const).flatMap((field) =>
          item[field].trim().length === 0 ? [`errorsAndBlockers[${index}].${field}`] : [],
        ),
      )
      const requiredErrorEvidenceCount = Math.min(Math.ceil(requirements.errorNames.length / 3), 3)
      const documentedErrorEvidenceCount =
        handoff.errorsAndBlockers.length + handoff.evidence.filter((item) => item.kind === "error").length
      if (handoff.errorsAndBlockers.length === 0) {
        missing.push("errorsAndBlockers (no entries)")
      } else if (emptyErrorFields.length > 0) {
        missing.push(`errorsAndBlockers (empty fields: ${emptyErrorFields.join(", ")})`)
      } else if (documentedErrorEvidenceCount < requiredErrorEvidenceCount) {
        missing.push(
          `errorsAndBlockers (too few entries: ${documentedErrorEvidenceCount}/${requiredErrorEvidenceCount} documented)`,
        )
      }
    }
    if (requirements.acceptanceCriteria && handoff.acceptanceCriteria.length === 0) {
      missing.push("acceptanceCriteria")
    }
    if (missing.length === 0) return { success: true as const }
    return {
      success: false as const,
      error: `Compaction handoff omitted required evidence fields: ${missing.join(", ")}`,
    }
  }

  export function completeRuntimeEvidence(
    handoff: Info,
    requirements: Pick<EvidenceRequirements, "patchFiles" | "errorNames">,
  ): Info {
    const reportedFileEvidence = new Set([
      ...handoff.files.map((item) => item.path),
      ...handoff.evidence.filter((item) => item.kind === "file").map((item) => item.value),
    ])
    const missingFiles = requirements.patchFiles.filter((item) => !reportedFileEvidence.has(item))

    const reportedErrorEvidence = new Set([
      ...handoff.evidence.filter((item) => item.kind === "error").map((item) => item.value),
      ...handoff.errorsAndBlockers.flatMap((item) => [item.issue, item.evidence]),
    ])
    const missingErrors = requirements.errorNames.filter((item) => !reportedErrorEvidence.has(item))

    if (missingFiles.length === 0 && missingErrors.length === 0) return handoff

    return {
      ...handoff,
      files: [
        ...handoff.files,
        ...missingFiles.map(
          (path): z.infer<typeof File> => ({
            path,
            status: "referenced",
            detail: "Host-derived required file evidence from compacted runtime context",
          }),
        ),
      ],
      errorsAndBlockers: [
        ...handoff.errorsAndBlockers,
        ...missingErrors.map(
          (name): z.infer<typeof ErrorOrBlocker> => ({
            issue: `Runtime error evidence during compacted session: ${name}`,
            evidence: name,
            nextAction: "Inspect this runtime error evidence before claiming the task is complete",
          }),
        ),
      ],
    }
  }

  export function isValidStructured(value: unknown): value is Info {
    return Schema.safeParse(value).success
  }

  export function isValidSummaryMessage(message: {
    role: string
    summary?: boolean
    finish?: unknown
    error?: unknown
    structured?: unknown
  }) {
    if (message.role !== "assistant") return false
    if (message.summary !== true) return false
    if (!message.finish || message.error) return false
    return isValidStructured(message.structured)
  }

  function list(values: string[]) {
    if (values.length === 0) return "- (none)"
    return values.map((value) => `- ${value}`).join("\n")
  }

  function section<T>(values: T[], render: (value: T) => string) {
    if (values.length === 0) return "   - (none)"
    return values.map(render).join("\n")
  }

  export function renderMarkdown(handoff: Info) {
    const normalized = Schema.parse(handoff)
    const source = normalized.currentState.sourceUserMessage
    return [
      "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
      "",
      "Summary:",
      "1. Primary Request and Intent:",
      `   - ${normalized.objective}`,
      ...normalized.acceptanceCriteria.map((item) => `   - Acceptance: ${item}`),
      "",
      "2. Key Technical Concepts:",
      ...normalized.durableInstructionSources.map((item) => `   - ${item.path}: ${item.role}`),
      ...normalized.activeBuildContracts.map(
        (item) =>
          `   - Active build contract: session=${item.sessionID} goal=${item.goalID} goal_run=${item.goalRunID} artifact=${item.artifactID} digest=${item.digest}`,
      ),
      `   - Source agent/model: ${source.agent} using ${source.model.providerID}/${source.model.modelID}`,
      `   - Source format/system mode: ${source.formatType}; ${source.systemMode ?? "(none)"}`,
      `   - Source tools: ${source.toolNames.join(", ") || "(none)"}`,
      `   - Source variant: ${source.variant ?? "(none)"}`,
      `   - Source extra keys: ${source.extraKeys.join(", ") || "(none)"}`,
      "",
      "3. Files and Code Sections:",
      section(normalized.files, (item) => `   - [${item.status}] ${item.path}: ${item.detail}`),
      "",
      "4. Errors and fixes:",
      section(
        normalized.errorsAndBlockers,
        (item) => `   - ${item.issue} Evidence: ${item.evidence} Next: ${item.nextAction}`,
      ),
      "",
      "5. Problem Solving:",
      section(
        normalized.decisions,
        (item) =>
          `   - ${item.decision} Rationale: ${item.rationale}${item.evidence ? ` Evidence: ${item.evidence}` : ""}`,
      ),
      ...normalized.evidence.map((item) => `   - [${item.kind}] ${item.value}: ${item.detail}`),
      "",
      "6. All user messages:",
      section(normalized.userMessages, (item) => `   - ${item}`),
      `   - Source user message id: ${source.id}`,
      "",
      "7. Pending Tasks:",
      list(normalized.nextActions).replaceAll("\n- ", "\n   - ").replace(/^- /, "   - "),
      "",
      "8. Current Work:",
      `   - Phase: ${normalized.currentState.phase}`,
      `   - Active task: ${normalized.currentState.activeTask}`,
      ...normalized.testsAndCommands.map((item) => `   - ${item.command}: ${item.result} Evidence: ${item.evidence}`),
      "",
      "9. Optional Next Step:",
      normalized.nextActions[0] ? `   - ${normalized.nextActions[0]}` : "   - (none)",
      ...normalized.openRisks.map((item) => `   - Risk: ${item}`),
    ].join("\n")
  }
}
