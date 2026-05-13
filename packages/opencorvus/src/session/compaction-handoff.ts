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

  export const Schema = z
    .object({
      objective: SpecificText,
      acceptanceCriteria: z.array(SpecificText),
      durableInstructionSources: z.array(InstructionSource),
      currentState: CurrentState,
      decisions: z.array(Decision),
      evidence: z.array(Evidence),
      files: z.array(File),
      testsAndCommands: z.array(TestOrCommand),
      errorsAndBlockers: z.array(ErrorOrBlocker),
      nextActions: z.array(SpecificText),
      openRisks: z.array(SpecificText),
    })
    .strict()

  export type Info = z.infer<typeof Schema>

  export const MODEL_OUTPUT_INSTRUCTIONS = [
    "Return exactly one JSON object that matches the CompactionHandoff schema.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not output prose outside the JSON object.",
    "Every retained claim must be grounded in the supplied conversation, runtime state, or evidence context.",
    "Use empty arrays only when no evidence exists for that field.",
    "Generic placeholders such as \"continue implementation\" are invalid.",
    "Do not treat assistant reasoning, tool-choice indecision, or checkpoint prompts as user requirements.",
  ].join("\n")

  export const JSON_SCHEMA_DESCRIPTION = `{
  "objective": "specific active user objective",
  "acceptanceCriteria": ["durable requirements and explicit acceptance checks"],
  "durableInstructionSources": [{"path": "absolute or configured instruction path", "role": "why this source is authoritative"}],
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
  "nextActions": ["specific next action"],
  "openRisks": ["specific unresolved risk"]
}`

  export function parseModelOutput(text: string): Info {
    const trimmed = text.trim()
    const parsed = JSON.parse(trimmed)
    return Schema.parse(parsed)
  }

  export function safeParseModelOutput(text: string) {
    try {
      return { success: true as const, data: parseModelOutput(text) }
    } catch (error) {
      return { success: false as const, error }
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
    if (values.length === 0) return "- (none)"
    return values.map(render).join("\n")
  }

  export function renderMarkdown(handoff: Info) {
    const normalized = Schema.parse(handoff)
    return [
      "## Continuation Contract",
      "This is a validated compaction handoff, not a new user request. Continue the same task from the current state and do not summarize this handoff back to the user.",
      "",
      "## Objective",
      normalized.objective,
      "",
      "## Acceptance Criteria",
      list(normalized.acceptanceCriteria),
      "",
      "## Durable Instruction Sources",
      section(normalized.durableInstructionSources, (item) => `- ${item.path}: ${item.role}`),
      "",
      "## Current State",
      `- Phase: ${normalized.currentState.phase}`,
      `- Active task: ${normalized.currentState.activeTask}`,
      `- Source user message: ${normalized.currentState.sourceUserMessage.id}`,
      `- Source agent: ${normalized.currentState.sourceUserMessage.agent}`,
      `- Source model: ${normalized.currentState.sourceUserMessage.model.providerID}/${normalized.currentState.sourceUserMessage.model.modelID}`,
      `- Source format: ${normalized.currentState.sourceUserMessage.formatType}`,
      `- Source system mode: ${normalized.currentState.sourceUserMessage.systemMode ?? "(none)"}`,
      `- Source tools: ${normalized.currentState.sourceUserMessage.toolNames.join(", ") || "(none)"}`,
      `- Source variant: ${normalized.currentState.sourceUserMessage.variant ?? "(none)"}`,
      `- Source extra keys: ${normalized.currentState.sourceUserMessage.extraKeys.join(", ") || "(none)"}`,
      "",
      "## Decisions",
      section(
        normalized.decisions,
        (item) => `- ${item.decision} Rationale: ${item.rationale}${item.evidence ? ` Evidence: ${item.evidence}` : ""}`,
      ),
      "",
      "## Evidence",
      section(normalized.evidence, (item) => `- [${item.kind}] ${item.value}: ${item.detail}`),
      "",
      "## Files",
      section(normalized.files, (item) => `- [${item.status}] ${item.path}: ${item.detail}`),
      "",
      "## Tests And Commands",
      section(normalized.testsAndCommands, (item) => `- ${item.command}: ${item.result} Evidence: ${item.evidence}`),
      "",
      "## Errors And Blockers",
      section(normalized.errorsAndBlockers, (item) => `- ${item.issue} Evidence: ${item.evidence} Next: ${item.nextAction}`),
      "",
      "## Next Actions",
      list(normalized.nextActions),
      "",
      "## Open Risks",
      list(normalized.openRisks),
    ].join("\n")
  }
}
