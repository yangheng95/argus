import { tool } from "ai"
import z from "zod"
import type { AcceptanceSpec } from "@/acceptance/types"
import { createCodebaseTools } from "@/engine/codebase-tools"
import { Instance } from "@/project/instance"
import { runGuardedCommand } from "@/shell/guarded-command"
import { DEFAULT_BASH_TIMEOUT_MS } from "@/shell/timeout"
import { Filesystem } from "@/util/filesystem"
import {
  agentContextPacketTextByStructuredSchema,
  agentContextStructuredPartBySchema,
  textContextPacket,
  type AgentContextPacket,
} from "@/agent/context-packet"
import type { TaskAgentOutcome } from "@/agent/outcomes"

/**
 * Integrity acceptance tools are scoped to semantic review. They expose
 * read-only project exploration, guarded command verification, and bounded
 * evidence drilldown; mutation and nested review are intentionally excluded.
 */
export type IntegrityEvidenceToolContext = {
  sessionID?: string
  taskID?: string
  evidenceID?: string
  goals?: Array<{
    id: string
    latest_goal_run_id?: string
    title: string
    description: string
    criteria: string
    priority: "blocking" | "advisory"
    acceptance_spec_count?: number
    acceptance_scenarios?: AcceptanceSpec[]
    acceptance_specs?: AcceptanceSpec[]
    check_selector?: string[]
    requirement_ids: string[]
    depends_on: string[]
    owned_paths: string[]
  }>
  contextPackets?: AgentContextPacket[]
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  signal?: AbortSignal
}

export type IntegrityImplementationEvidenceContext = {
  summary: string
  changedFiles: string[]
  diffs?: Array<{
    file: string
    diff?: string
    before?: string
    after?: string
    additions?: number
    deletions?: number
    status?: string
  }>
  goalReports?: Array<{
    goalTitle: string
    report: {
      files_changed: Array<{ path: string; summary: string }>
      checks_run: Array<{ name: string; command: string; exit_code: number; output_excerpt?: string }>
      implementation_approach: string
      design_decisions: Array<{ choice: string; alternatives: string[]; reason: string }>
      blockers: string[]
    }
  }>
}

export const IMPLEMENTATION_EVIDENCE_CONTEXT_PACKET_SOURCE = "agent_outcomes"
export const IMPLEMENTATION_EVIDENCE_CONTEXT_PACKET_SCHEMA = "opencorvus.integrity.implementation_evidence.v1"
export const FRONTEND_DESIGN_INTEGRITY_CONTEXT_PACKET_SCHEMA = "opencorvus.integrity.frontend_design_context.v1"
export const VISUAL_QA_IMPLEMENTATION_CONTEXT_PACKET_SCHEMA =
  "opencorvus.integrity.visual_qa_implementation_context.v1"

function taggedTextContextPacket(input: {
  id: string
  title: string
  source: string
  body: string
  schema: string
  label: string
}): AgentContextPacket | undefined {
  const packet = textContextPacket({
    id: input.id,
    title: input.title,
    source: input.source,
    scope: "task",
    body: input.body,
  })
  if (!packet) return undefined
  return {
    ...packet,
    parts: [
      ...packet.parts,
      {
        type: "structured",
        schema: input.schema,
        label: input.label,
        summary: `${input.label}=present`,
        data: { present: true },
      },
    ],
  }
}

export function frontendDesignIntegrityContextPacket(body: string): AgentContextPacket | undefined {
  return taggedTextContextPacket({
    id: "frontend-design-integrity-context",
    title: "Frontend Design Integrity Context",
    source: "frontend_design",
    body,
    schema: FRONTEND_DESIGN_INTEGRITY_CONTEXT_PACKET_SCHEMA,
    label: "frontend_design_integrity_context",
  })
}

export function visualQaImplementationContextPacket(body: string): AgentContextPacket | undefined {
  return taggedTextContextPacket({
    id: "visual-qa-integrity-context",
    title: "Visual QA Implementation Defect Context",
    source: "visual_qa",
    body,
    schema: VISUAL_QA_IMPLEMENTATION_CONTEXT_PACKET_SCHEMA,
    label: "visual_qa_implementation_context",
  })
}

export function implementationEvidenceContextPacket(
  evidence: IntegrityImplementationEvidenceContext,
): AgentContextPacket {
  return {
    id: "implementation-evidence-context",
    title: "Implementation Evidence Context",
    source: IMPLEMENTATION_EVIDENCE_CONTEXT_PACKET_SOURCE,
    scope: "task",
    parts: [
      {
        type: "text",
        text: [
          `summary: ${evidence.summary || "(none)"}`,
          `changed_files: ${evidence.changedFiles.length}`,
          `diffs: ${evidence.diffs?.length ?? 0}`,
          `goal_reports: ${evidence.goalReports?.length ?? 0}`,
        ].join("\n"),
      },
      {
        type: "structured",
        schema: IMPLEMENTATION_EVIDENCE_CONTEXT_PACKET_SCHEMA,
        label: "implementation_evidence",
        summary: `changed_files=${evidence.changedFiles.length}; diffs=${evidence.diffs?.length ?? 0}; goal_reports=${evidence.goalReports?.length ?? 0}`,
        data: evidence,
      },
    ],
  }
}

export function implementationEvidenceFromAgentOutcomes(
  outcomes: readonly TaskAgentOutcome[],
): IntegrityImplementationEvidenceContext {
  const changedFiles = uniqueSorted(outcomes.flatMap((outcome) => outcome.changedFiles ?? []))
  const diffs = uniqueDiffs(outcomes.flatMap((outcome) => outcome.diffs ?? []))
  const summaries = outcomes
    .map((outcome) => {
      const prefix = `${outcome.provider}/${outcome.id} ${outcome.scope} ${outcome.status}/${outcome.result ?? "unknown"}`
      return outcome.summary ? `${prefix}: ${outcome.summary}` : prefix
    })
    .filter((line) => line.trim().length > 0)
  return {
    summary:
      summaries.length > 0
        ? summaries.join("\n")
        : "No implementation outcome rows were found; review the requirement status snapshot and repository directly.",
    changedFiles,
    diffs,
  }
}

export function implementationEvidenceFromContextPackets(
  packets: readonly AgentContextPacket[] | undefined,
): IntegrityImplementationEvidenceContext | undefined {
  const evidence = agentContextStructuredPartBySchema<IntegrityImplementationEvidenceContext>(
    packets,
    IMPLEMENTATION_EVIDENCE_CONTEXT_PACKET_SCHEMA,
  )
  return evidence ? parseImplementationEvidenceContext(evidence, IMPLEMENTATION_EVIDENCE_CONTEXT_PACKET_SCHEMA) : undefined
}

export function createIntegrityAcceptanceTools(input?: IntegrityEvidenceToolContext) {
  const projectDir = Filesystem.resolve(Instance.directory)
  return {
    ...createCodebaseTools(projectDir),
    run_command: tool({
      description:
        "Run a verification shell command in an isolated copy of the project and capture stdout/stderr/exit code. " +
        "Use for verification only: builds, tests, smoke checks, or short server startup checks. " +
        "For dev/preview servers that browser tools must inspect, set background=true instead of shell-backgrounding with `&`; the result returns a PID and detected URL when available. " +
        "Commands never write to the implementation worktree; output includes source_cwd and execution_cwd so reviewers can cite the isolated verification workspace.",
      inputSchema: z.object({
        command: z.string().min(1).describe("Shell command to run in the project root"),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .max(DEFAULT_BASH_TIMEOUT_MS)
          .default(DEFAULT_BASH_TIMEOUT_MS)
          .describe("Max execution time ms; for background=true this is the process lease"),
        background: z
          .boolean()
          .default(false)
          .describe("Keep a dev/preview/serve command running after this tool call so browser tools can inspect it."),
      }),
      execute: async ({ command, timeout_ms, background }) => {
        try {
          return await runGuardedCommand({
            command,
            timeoutMs: timeout_ms,
            background,
            projectDir,
            taskID: input?.taskID,
            env: process.env,
            signal: input?.signal,
          })
        } catch (err) {
          return `Error running command: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    }),
    inspect_integrity_evidence: tool({
      description:
        "Inspect scoped integrity evidence on demand. Start from changed_directories, then request exact files or diffs only for directories and files relevant to this review scope.",
      inputSchema: z.object({
        section: z.enum([
          "overview",
          "changed_directories",
          "changed_files_in_directory",
          "diff_for_file",
          "goal_summary",
          "goal_detail",
          "executor_reports",
          "frontend_design_contract",
          "visual_qa_report",
          "attachments",
        ]),
        directory: z.string().optional(),
        file_path: z.string().optional(),
        goal_id: z.string().optional(),
        max_chars: z.number().int().min(1_000).max(40_000).default(12_000),
      }),
      execute: async ({ section, directory, file_path, goal_id, max_chars }) =>
        truncateIntegrityEvidence(
          renderIntegrityEvidenceSection(input, section, directory, file_path, goal_id),
          max_chars,
        ),
    }),
  }
}

function renderIntegrityEvidenceSection(
  input: IntegrityEvidenceToolContext | undefined,
  section:
    | "overview"
    | "changed_directories"
    | "changed_files_in_directory"
    | "diff_for_file"
    | "goal_summary"
    | "goal_detail"
    | "executor_reports"
    | "frontend_design_contract"
    | "visual_qa_report"
    | "attachments",
  directory?: string,
  filePath?: string,
  goalID?: string,
): string {
  const evidence = implementationEvidenceFromContextPackets(input?.contextPackets)
  const changedFiles = evidence?.changedFiles ?? []
  const diffs = evidence?.diffs ?? []
  switch (section) {
    case "overview":
      return [
        "# Integrity Evidence Overview",
        `task_id=${input?.taskID ?? "(none)"}`,
        `goals=${input?.goals?.length ?? 0}`,
        `changed_files=${changedFiles.length}`,
        `changed_directories=${pathDirectories(changedFiles).length}`,
        `diffs=${diffs.length}`,
        `attachments=${input?.attachments?.length ?? 0}`,
      ].join("\n")

    case "changed_directories":
      return (
        "# Changed Directories\n\n" +
        (pathDirectories(changedFiles)
          .map((item) => `- ${item}`)
          .join("\n") || "(none)")
      )

    case "changed_files_in_directory": {
      const dir = normalizeDirectory(directory)
      if (!dir) return "changed_files_in_directory requires directory."
      const files = changedFiles.filter((file) => normalizeDirectory(fileDirectory(file)) === dir)
      return `# Changed Files In ${dir}\n\n` + (files.map((file) => `- ${file}`).join("\n") || "(none)")
    }

    case "diff_for_file": {
      const normalized = normalizePath(filePath ?? "")
      if (!normalized) return "diff_for_file requires file_path."
      const diff = diffs.find((item) => normalizePath(item.file) === normalized)
      if (!diff) return `No diff evidence for ${normalized}.`
      return [
        `# Diff For ${diff.file}`,
        `status=${diff.status ?? "unknown"} additions=${diff.additions ?? "unknown"} deletions=${diff.deletions ?? "unknown"}`,
        diff.diff ? `[diff]\n${diff.diff}` : "",
        diff.before || diff.after ? `[before]\n${diff.before || "(empty)"}\n[after]\n${diff.after || "(empty)"}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    }

    case "goal_summary":
      return [
        "# Goal Summary",
        ...((input?.goals ?? []).map(
          (goal) =>
            `- ${goal.id}: ${goal.title}; priority=${goal.priority}; owned_directories=${
              pathDirectories(goal.owned_paths).join(", ") || "(none)"
            }; acceptance_specs=${goal.acceptance_spec_count ?? goal.acceptance_specs?.length ?? 0}`,
        ) || ["(none)"]),
      ].join("\n")

    case "goal_detail": {
      if (!goalID) return "goal_detail requires goal_id."
      const goal = (input?.goals ?? []).find((candidate) => candidate.id === goalID)
      if (!goal) return `No goal evidence for ${goalID}.`
      return [
        `# Goal Detail: ${goal.id}`,
        `Title: ${goal.title}`,
        `Description: ${goal.description}`,
        `Criteria: ${goal.criteria}`,
        `Priority: ${goal.priority}`,
        `Requirements: ${goal.requirement_ids.join(", ") || "(none)"}`,
        `Depends on: ${goal.depends_on.join(", ") || "(none)"}`,
        `Owned directories: ${pathDirectories(goal.owned_paths).join(", ") || "(none)"}`,
        `Acceptance spec count: ${goal.acceptance_spec_count ?? goal.acceptance_specs?.length ?? 0}`,
      ].join("\n")
    }

    case "executor_reports":
      return renderExecutorReportEvidence(evidence?.goalReports ?? [])

    case "frontend_design_contract":
      return (
        "# Frontend Design Contract\n\n" +
        (agentContextPacketTextByStructuredSchema(
          input?.contextPackets,
          FRONTEND_DESIGN_INTEGRITY_CONTEXT_PACKET_SCHEMA,
        ) || "(none)")
      )

    case "visual_qa_report":
      return (
        "# Visual QA Implementation Defect Context\n\n" +
        (agentContextPacketTextByStructuredSchema(
          input?.contextPackets,
          VISUAL_QA_IMPLEMENTATION_CONTEXT_PACKET_SCHEMA,
        ) || "(none)")
      )

    case "attachments":
      return [
        "# Attachments",
        ...((input?.attachments ?? []).map(
          (attachment) =>
            `- ${attachment.filename ?? attachment.sha}: mime=${attachment.mime}; size=${attachment.size}; url=${attachment.url}`,
        ) || ["(none)"]),
      ].join("\n")
  }
}

function renderExecutorReportEvidence(
  reports: IntegrityImplementationEvidenceContext["goalReports"],
): string {
  const lines = ["# Executor Reports"]
  if (!reports?.length) {
    lines.push("(none)")
    return lines.join("\n")
  }
  for (const entry of reports) {
    lines.push(`## ${entry.goalTitle}`)
    lines.push(`Approach: ${entry.report.implementation_approach || "(none)"}`)
    if (entry.report.files_changed.length > 0) {
      lines.push("Files changed:")
      for (const file of entry.report.files_changed) lines.push(`- ${file.path}: ${file.summary}`)
    }
    if (entry.report.checks_run.length > 0) {
      lines.push("Checks run:")
      for (const check of entry.report.checks_run) {
        lines.push(`- ${check.name}: ${check.command}; exit=${check.exit_code}; ${check.output_excerpt ?? ""}`)
      }
    }
    if (entry.report.blockers.length > 0) lines.push(`Blockers: ${entry.report.blockers.join("; ")}`)
  }
  return lines.join("\n")
}

function parseImplementationEvidenceContext(value: unknown, packetID: string): IntegrityImplementationEvidenceContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`context packet ${packetID} has invalid implementation_evidence structured payload`)
  }
  const candidate = value as Record<string, unknown>
  const unsupported = Object.keys(candidate).filter((key) => !["summary", "changedFiles", "diffs", "goalReports"].includes(key))
  if (unsupported.length > 0) {
    throw new Error(`context packet ${packetID} has unsupported implementation_evidence field ${unsupported[0]}`)
  }
  if (typeof candidate.summary !== "string") {
    throw new Error(`context packet ${packetID}.summary must be a string`)
  }
  const changedFiles = requiredStringArray(candidate.changedFiles, `context packet ${packetID}.changedFiles`)
  const result: IntegrityImplementationEvidenceContext = {
    summary: candidate.summary,
    changedFiles,
  }
  if (candidate.diffs !== undefined) {
    if (!Array.isArray(candidate.diffs)) throw new Error(`context packet ${packetID}.diffs must be an array`)
    result.diffs = candidate.diffs.map((item, index) => parseImplementationDiff(item, `context packet ${packetID}.diffs[${index}]`))
  }
  if (candidate.goalReports !== undefined) {
    if (!Array.isArray(candidate.goalReports)) throw new Error(`context packet ${packetID}.goalReports must be an array`)
    result.goalReports = candidate.goalReports.map((item, index) =>
      parseImplementationGoalReport(item, `context packet ${packetID}.goalReports[${index}]`),
    )
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  return value
}

function assertAllowedFields(record: Record<string, unknown>, allowedFields: readonly string[], path: string): void {
  const allowed = new Set(allowedFields)
  const unsupported = Object.keys(record).filter((key) => !allowed.has(key))
  if (unsupported.length > 0) throw new Error(`${path} contains unsupported field ${unsupported[0]}`)
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`)
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, path)
}

function optionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

function requiredStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value.map((item, index) => requiredString(item, `${path}[${index}]`))
}

function parseImplementationDiff(value: unknown, path: string): NonNullable<IntegrityImplementationEvidenceContext["diffs"]>[number] {
  const record = requiredRecord(value, path)
  assertAllowedFields(record, ["file", "diff", "before", "after", "additions", "deletions", "status"], path)
  const diff = optionalString(record.diff, `${path}.diff`)
  const before = optionalString(record.before, `${path}.before`)
  const after = optionalString(record.after, `${path}.after`)
  const additions = optionalNumber(record.additions, `${path}.additions`)
  const deletions = optionalNumber(record.deletions, `${path}.deletions`)
  const status = optionalString(record.status, `${path}.status`)
  return {
    file: requiredString(record.file, `${path}.file`),
    ...(diff !== undefined ? { diff } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(additions !== undefined ? { additions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
    ...(status !== undefined ? { status } : {}),
  }
}

function parseImplementationGoalReport(
  value: unknown,
  path: string,
): NonNullable<IntegrityImplementationEvidenceContext["goalReports"]>[number] {
  const record = requiredRecord(value, path)
  assertAllowedFields(record, ["goalTitle", "report"], path)
  const report = requiredRecord(record.report, `${path}.report`)
  assertAllowedFields(report, ["files_changed", "checks_run", "implementation_approach", "design_decisions", "blockers"], `${path}.report`)
  return {
    goalTitle: requiredString(record.goalTitle, `${path}.goalTitle`),
    report: {
      files_changed: requiredArray(report.files_changed, `${path}.report.files_changed`).map((item, index) => {
        const file = requiredRecord(item, `${path}.report.files_changed[${index}]`)
        assertAllowedFields(file, ["path", "summary"], `${path}.report.files_changed[${index}]`)
        return {
          path: requiredString(file.path, `${path}.report.files_changed[${index}].path`),
          summary: requiredString(file.summary, `${path}.report.files_changed[${index}].summary`),
        }
      }),
      checks_run: requiredArray(report.checks_run, `${path}.report.checks_run`).map((item, index) => {
        const check = requiredRecord(item, `${path}.report.checks_run[${index}]`)
        assertAllowedFields(check, ["name", "command", "exit_code", "output_excerpt"], `${path}.report.checks_run[${index}]`)
        const outputExcerpt = optionalString(check.output_excerpt, `${path}.report.checks_run[${index}].output_excerpt`)
        return {
          name: requiredString(check.name, `${path}.report.checks_run[${index}].name`),
          command: requiredString(check.command, `${path}.report.checks_run[${index}].command`),
          exit_code: requiredNumber(check.exit_code, `${path}.report.checks_run[${index}].exit_code`),
          ...(outputExcerpt !== undefined ? { output_excerpt: outputExcerpt } : {}),
        }
      }),
      implementation_approach: requiredString(report.implementation_approach, `${path}.report.implementation_approach`),
      design_decisions: requiredArray(report.design_decisions, `${path}.report.design_decisions`).map((item, index) => {
        const decision = requiredRecord(item, `${path}.report.design_decisions[${index}]`)
        assertAllowedFields(decision, ["choice", "alternatives", "reason"], `${path}.report.design_decisions[${index}]`)
        return {
          choice: requiredString(decision.choice, `${path}.report.design_decisions[${index}].choice`),
          alternatives: requiredStringArray(decision.alternatives, `${path}.report.design_decisions[${index}].alternatives`),
          reason: requiredString(decision.reason, `${path}.report.design_decisions[${index}].reason`),
        }
      }),
      blockers: requiredStringArray(report.blockers, `${path}.report.blockers`),
    },
  }
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

function uniqueSorted(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

function uniqueDiffs(
  diffs: readonly NonNullable<TaskAgentOutcome["diffs"]>[number][],
): NonNullable<IntegrityImplementationEvidenceContext["diffs"]> {
  const seen = new Set<string>()
  const out: NonNullable<IntegrityImplementationEvidenceContext["diffs"]> = []
  for (const diff of diffs) {
    const file = diff.file.trim()
    if (!file || seen.has(file)) continue
    seen.add(file)
    out.push({
      file,
      ...(diff.status ? { status: diff.status } : {}),
      ...(typeof diff.additions === "number" ? { additions: diff.additions } : {}),
      ...(typeof diff.deletions === "number" ? { deletions: diff.deletions } : {}),
    })
  }
  return out.sort((left, right) => left.file.localeCompare(right.file))
}

function pathDirectories(paths: readonly string[]): string[] {
  return [...new Set(paths.map(fileDirectory))].sort((left, right) => left.localeCompare(right))
}

function fileDirectory(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index > 0 ? normalized.slice(0, index) : "."
}

function normalizeDirectory(path: string | undefined): string {
  if (!path) return ""
  return normalizePath(path).replace(/\/+$/, "") || "."
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim()
}

function truncateIntegrityEvidence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n... (truncated by inspect_integrity_evidence at ${maxChars} chars; request a narrower section for more detail)`
}
