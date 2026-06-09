import z from "zod"
import { Todo } from "./todo"

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

  export const ChronologyEntry = z
    .object({
      event: SpecificText,
      evidence: NonEmpty.optional(),
    })
    .strict()

  export const Schema = z
    .object({
      objective: SpecificText,
      acceptanceCriteria: z.array(SpecificText),
      durableInstructionSources: z.array(InstructionSource),
      activeBuildContracts: z.array(ActiveBuildContract),
      todos: z.array(Todo.Info),
      workingContext: z.array(SpecificText),
      chronology: z.array(ChronologyEntry),
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
    richContext?: boolean
    fileEvidence: boolean
    errorsAndBlockers: boolean
    acceptanceCriteria: boolean
    todos: Todo.Info[]
    previousHandoff?: {
      acceptanceCriteria: string[]
      workingContext: string[]
      chronology: string[]
      decisions: string[]
      evidence: string[]
      files: string[]
      testsAndCommands: string[]
      errorsAndBlockers: string[]
      userMessages: string[]
      nextActions: string[]
      openRisks: string[]
    }
  }

  function instructionPathKey(value: string) {
    const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "")
    return normalized.replace(/^([A-Za-z]):/, (_, drive: string) => `${drive.toLowerCase()}:`)
  }

  export const MODEL_OUTPUT_INSTRUCTIONS = [
    "Call the StructuredOutput tool exactly once with one object that matches the CompactionHandoff schema.",
    "Do not write Markdown, prose, or a raw JSON text response; the handoff object must be the StructuredOutput tool input.",
    "Every retained claim must be grounded in the supplied conversation, runtime state, or evidence context.",
    "List all user-authored messages that appear in the compacted history in userMessages, preserving their intent and important wording.",
    'Every non-empty line inside <required-file-evidence> MUST appear verbatim in files[].path or evidence[].value with kind="file".',
    "The <runtime-error-context> block lists internal error tokens collected during this session. For each distinct root cause, write at least one errorsAndBlockers entry in your own words with concrete issue, evidence, and nextAction. Verbatim echo of the internal tokens is not required.",
    "If the StructuredOutput tool returns an error, read the error text, fix the handoff object, and call StructuredOutput again.",
    "Use empty arrays only when no evidence exists for that field.",
    'Generic placeholders such as "continue implementation" are invalid.',
    "Do not treat assistant reasoning, tool-choice indecision, or checkpoint prompts as user requirements.",
    "When active build-session contract facts are supplied, copy their ids into activeBuildContracts instead of paraphrasing them.",
    "When current todos are supplied, copy the todo array exactly into todos with the same item order, content, status, and priority.",
    "Fill workingContext with the compact active working set: concrete requirements, constraints, file relationships, ids, paths, and partial conclusions the next agent must keep in mind.",
    "Fill chronology with ordered progress events from the compacted history, including what changed, what was verified, and what remains unresolved.",
    "When <previous-handoff-required-retention> is supplied, retain every listed value verbatim in the same handoff field while merging new facts.",
  ].join("\n")

  export function renderRequiredEvidence(
    requirements: Pick<EvidenceRequirements, "patchFiles" | "errorNames" | "previousHandoff">,
  ) {
    const prior = requirements.previousHandoff
    const priorBlock = prior
      ? [
          "",
          "<previous-handoff-required-retention>",
          "<acceptanceCriteria>",
          ...prior.acceptanceCriteria,
          "</acceptanceCriteria>",
          "<workingContext>",
          ...prior.workingContext,
          "</workingContext>",
          "<chronology>",
          ...prior.chronology,
          "</chronology>",
          "<decisions>",
          ...prior.decisions,
          "</decisions>",
          "<evidence>",
          ...prior.evidence,
          "</evidence>",
          "<files>",
          ...prior.files,
          "</files>",
          "<testsAndCommands>",
          ...prior.testsAndCommands,
          "</testsAndCommands>",
          "<errorsAndBlockers>",
          ...prior.errorsAndBlockers,
          "</errorsAndBlockers>",
          "<userMessages>",
          ...prior.userMessages,
          "</userMessages>",
          "<nextActions>",
          ...prior.nextActions,
          "</nextActions>",
          "<openRisks>",
          ...prior.openRisks,
          "</openRisks>",
          "</previous-handoff-required-retention>",
        ]
      : []
    return [
      "<required-file-evidence>",
      ...requirements.patchFiles,
      "</required-file-evidence>",
      "",
      "<runtime-error-context>",
      ...requirements.errorNames,
      "</runtime-error-context>",
      ...priorBlock,
    ].join("\n")
  }

  export const JSON_SCHEMA_DESCRIPTION = `{
  "objective": "specific active user objective",
  "acceptanceCriteria": ["durable requirements and explicit acceptance checks"],
  "durableInstructionSources": [{"path": "absolute or configured instruction path", "role": "why this source is authoritative"}],
  "activeBuildContracts": [{"sessionID": "build session id", "goalID": "goal id", "goalRunID": "active logical attempt id", "artifactID": "build_session_contract artifact id", "sourceArtifactIDs": ["source artifact ids"], "digest": "contract snapshot digest"}],
  "todos": [{"content": "exact todo content", "status": "exact todo status", "priority": "exact todo priority"}],
  "workingContext": ["compact active working set: requirements, constraints, ids, paths, file relationships, partial conclusions"],
  "chronology": [{"event": "ordered progress event from the compacted history", "evidence": "optional exact source"}],
  "currentState": {
    "phase": "specific current phase",
    "activeTask": "specific active task",
    "sourceUserMessage": {
      "id": "message id",
      "agent": "agent name",
      "model": {"providerID": "provider id", "modelID": "model id"},
      "formatType": "text or structured output format type",
      "systemMode": "system mode or null",
      "toolNames": ["explicit tool switches enabled on the source user message"],
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
    const reportedInstructionPaths = new Set(
      handoff.durableInstructionSources.map((item) => instructionPathKey(item.path)),
    )
    const omittedInstructionPaths = requirements.instructionPaths.filter(
      (item) => !reportedInstructionPaths.has(instructionPathKey(item)),
    )
    if (omittedInstructionPaths.length > 0) {
      missing.push(`durableInstructionSources (missing: ${omittedInstructionPaths.join(", ")})`)
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
    const requiresRichContext = requirements.richContext ?? requirements.userMessages
    if (requiresRichContext && handoff.workingContext.length === 0) {
      missing.push("workingContext")
    }
    if (requiresRichContext && handoff.chronology.length === 0) {
      missing.push("chronology")
    }
    if (requirements.previousHandoff) {
      const missingAcceptance = requirements.previousHandoff.acceptanceCriteria.filter(
        (item) => !handoff.acceptanceCriteria.includes(item),
      )
      if (missingAcceptance.length > 0) {
        missing.push(`previousHandoff.acceptanceCriteria (${missingAcceptance.length} omitted)`)
      }
      const missingWorkingContext = requirements.previousHandoff.workingContext.filter(
        (item) => !handoff.workingContext.includes(item),
      )
      if (missingWorkingContext.length > 0) {
        missing.push(`previousHandoff.workingContext (${missingWorkingContext.length} omitted)`)
      }
      const chronologyEvents = new Set(handoff.chronology.map((item) => item.event))
      const missingChronology = requirements.previousHandoff.chronology.filter((item) => !chronologyEvents.has(item))
      if (missingChronology.length > 0) {
        missing.push(`previousHandoff.chronology (${missingChronology.length} omitted)`)
      }
      const decisionTexts = new Set(handoff.decisions.map((item) => item.decision))
      const missingDecisions = requirements.previousHandoff.decisions.filter((item) => !decisionTexts.has(item))
      if (missingDecisions.length > 0) {
        missing.push(`previousHandoff.decisions (${missingDecisions.length} omitted)`)
      }
      const evidenceTexts = new Set(handoff.evidence.map((item) => item.value))
      const missingEvidence = requirements.previousHandoff.evidence.filter((item) => !evidenceTexts.has(item))
      if (missingEvidence.length > 0) {
        missing.push(`previousHandoff.evidence (${missingEvidence.length} omitted)`)
      }
      const filePaths = new Set(handoff.files.map((item) => item.path))
      const missingFiles = requirements.previousHandoff.files.filter((item) => !filePaths.has(item))
      if (missingFiles.length > 0) {
        missing.push(`previousHandoff.files (${missingFiles.length} omitted)`)
      }
      const commands = new Set(handoff.testsAndCommands.map((item) => item.command))
      const missingCommands = requirements.previousHandoff.testsAndCommands.filter((item) => !commands.has(item))
      if (missingCommands.length > 0) {
        missing.push(`previousHandoff.testsAndCommands (${missingCommands.length} omitted)`)
      }
      const blockerIssues = new Set(handoff.errorsAndBlockers.map((item) => item.issue))
      const missingBlockers = requirements.previousHandoff.errorsAndBlockers.filter((item) => !blockerIssues.has(item))
      if (missingBlockers.length > 0) {
        missing.push(`previousHandoff.errorsAndBlockers (${missingBlockers.length} omitted)`)
      }
      const missingUserMessages = requirements.previousHandoff.userMessages.filter(
        (item) => !handoff.userMessages.includes(item),
      )
      if (missingUserMessages.length > 0) {
        missing.push(`previousHandoff.userMessages (${missingUserMessages.length} omitted)`)
      }
      const missingNextActions = requirements.previousHandoff.nextActions.filter(
        (item) => !handoff.nextActions.includes(item),
      )
      if (missingNextActions.length > 0) {
        missing.push(`previousHandoff.nextActions (${missingNextActions.length} omitted)`)
      }
      const missingOpenRisks = requirements.previousHandoff.openRisks.filter(
        (item) => !handoff.openRisks.includes(item),
      )
      if (missingOpenRisks.length > 0) {
        missing.push(`previousHandoff.openRisks (${missingOpenRisks.length} omitted)`)
      }
    }
    if (JSON.stringify(handoff.todos) !== JSON.stringify(requirements.todos)) {
      missing.push("todos")
    }
    if (missing.length === 0) return { success: true as const }
    return {
      success: false as const,
      error: `Compaction handoff omitted required evidence fields: ${missing.join(", ")}`,
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
      ...normalized.workingContext.map((item) => `   - Working context: ${item}`),
      `   - Source agent/model: ${source.agent} using ${source.model.providerID}/${source.model.modelID}`,
      `   - Source format/system mode: ${source.formatType}; ${source.systemMode ?? "(none)"}`,
      `   - Source enabled tool switches: ${source.toolNames.join(", ") || "(none)"}`,
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
      ...normalized.chronology.map(
        (item) => `   - Chronology: ${item.event}${item.evidence ? ` Evidence: ${item.evidence}` : ""}`,
      ),
      "",
      "6. All user messages:",
      section(normalized.userMessages, (item) => `   - ${item}`),
      `   - Source user message id: ${source.id}`,
      "",
      "7. Todo List (verbatim):",
      "```json",
      JSON.stringify(normalized.todos, null, 2),
      "```",
      "",
      "8. Pending Tasks:",
      list(normalized.nextActions).replaceAll("\n- ", "\n   - ").replace(/^- /, "   - "),
      "",
      "9. Current Work:",
      `   - Phase: ${normalized.currentState.phase}`,
      `   - Active task: ${normalized.currentState.activeTask}`,
      ...normalized.testsAndCommands.map((item) => `   - ${item.command}: ${item.result} Evidence: ${item.evidence}`),
      "",
      "10. Optional Next Step:",
      normalized.nextActions[0] ? `   - ${normalized.nextActions[0]}` : "   - (none)",
      ...normalized.openRisks.map((item) => `   - Risk: ${item}`),
    ].join("\n")
  }

  export function renderMemoryEpisode(handoff: Info) {
    const normalized = Schema.parse(handoff)
    const source = normalized.currentState.sourceUserMessage
    return [
      "# Compaction Handoff Memory",
      "",
      "## Objective",
      normalized.objective,
      "",
      "## Acceptance Criteria",
      list(normalized.acceptanceCriteria),
      "",
      "## Current State",
      `- Phase: ${normalized.currentState.phase}`,
      `- Active task: ${normalized.currentState.activeTask}`,
      `- Source user message: ${source.id}`,
      `- Source agent/model: ${source.agent} ${source.model.providerID}/${source.model.modelID}`,
      "",
      "## Working Context",
      list(normalized.workingContext),
      "",
      "## Chronology",
      section(normalized.chronology, (item) => `- ${item.event}${item.evidence ? ` Evidence: ${item.evidence}` : ""}`)
        .replaceAll("\n   - ", "\n- ")
        .replace(/^   - /, "- "),
      "",
      "## Decisions",
      section(
        normalized.decisions,
        (item) =>
          `- ${item.decision} Rationale: ${item.rationale}${item.evidence ? ` Evidence: ${item.evidence}` : ""}`,
      )
        .replaceAll("\n   - ", "\n- ")
        .replace(/^   - /, "- "),
      "",
      "## Files",
      section(normalized.files, (item) => `- [${item.status}] ${item.path}: ${item.detail}`)
        .replaceAll("\n   - ", "\n- ")
        .replace(/^   - /, "- "),
      "",
      "## Evidence",
      section(normalized.evidence, (item) => `- [${item.kind}] ${item.value}: ${item.detail}`)
        .replaceAll("\n   - ", "\n- ")
        .replace(/^   - /, "- "),
      "",
      "## Tests And Commands",
      section(normalized.testsAndCommands, (item) => `- ${item.command}: ${item.result} Evidence: ${item.evidence}`)
        .replaceAll("\n   - ", "\n- ")
        .replace(/^   - /, "- "),
      "",
      "## Errors And Blockers",
      section(
        normalized.errorsAndBlockers,
        (item) => `- ${item.issue} Evidence: ${item.evidence} Next: ${item.nextAction}`,
      )
        .replaceAll("\n   - ", "\n- ")
        .replace(/^   - /, "- "),
      "",
      "## Todos",
      JSON.stringify(normalized.todos, null, 2),
      "",
      "## User Messages",
      list(normalized.userMessages),
      "",
      "## Next Actions",
      list(normalized.nextActions),
      "",
      "## Open Risks",
      list(normalized.openRisks),
    ].join("\n")
  }
}
