import { tool } from "ai"
import z from "zod"
import type { AcceptanceSpec } from "@/acceptance/types"
import { createCodebaseTools } from "@/engine/codebase-tools"
import { Instance } from "@/project/instance"
import { runGuardedCommand } from "@/shell/guarded-command"
import { DEFAULT_BASH_TIMEOUT_MS } from "@/shell/timeout"
import { Filesystem } from "@/util/filesystem"

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
  buildEvidence?: {
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
  frontendDesign?: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  signal?: AbortSignal
}

export function createIntegrityAcceptanceTools(input?: IntegrityEvidenceToolContext) {
  const projectDir = Filesystem.resolve(Instance.directory)
  return {
    ...createCodebaseTools(projectDir),
    run_command: tool({
      description:
        "Run a read-only shell command in the project directory and capture stdout/stderr/exit code. " +
        "Use for verification only: builds, tests, smoke checks, or short server startup checks. " +
        "For dev/preview servers that browser tools must inspect, set background=true instead of shell-backgrounding with `&`; the result returns a PID and detected URL when available. " +
        "If implementation files change during the command, the result includes a readonly_guard warning and must not be treated as a repair.",
      inputSchema: z.object({
        command: z.string().min(1).describe("Shell command to run in the project root"),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .max(120_000)
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
            env: process.env,
            signal: input?.signal,
            readOnlyGuard: true,
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
    | "attachments",
  directory?: string,
  filePath?: string,
  goalID?: string,
): string {
  const evidence = input?.buildEvidence
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
      return "# Frontend Design Contract\n\n" + (input?.frontendDesign?.trim() || "(none)")

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
  reports: NonNullable<IntegrityEvidenceToolContext["buildEvidence"]>["goalReports"],
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
