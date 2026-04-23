/**
 * Intent bundle — the authoritative copy of user-provided task material
 * mounted into every goal's worktree at `.opencorvus/intent/`.
 *
 * The bundle is the executor's primary channel for the user's original
 * request (PRD, bug report, feature ask — whatever shape the user gave).
 * Once this exists, requirements/planner/executor agents can stop copying
 * user request content into their own output fields.
 *
 * Contents (only the files that have data are written):
 *   request.md          — task.request raw, unmodified
 *   clarifications.md   — Q&A transcript (caller-provided string)
 *   operator-notes.md   — operator-provided notes (caller-provided string)
 *   README.md           — index explaining what is in this directory
 *
 * This module is a pure filesystem writer: the caller is responsible for
 * resolving clarifications/notes from the DB (via orchestrator/helpers)
 * and passing the strings in. Keeping the DB lookup out of this module
 * makes it trivially testable without mocking the helpers module.
 *
 * Attachments are NOT copied here. They stay in the project's
 * `.opencorvus/attachments/` store and are referenced indirectly
 * (`attachment://<sha>.<ext>` / `/attachment/<projectID>/<sha>.<ext>`) by
 * whichever task material needs them.
 */
import fs from "fs/promises"
import path from "path"
import { Log } from "@/util/log"

const log = Log.create({ service: "intent-bundle" })

export interface WriteIntentBundleInput {
  worktreeDir: string
  taskID: string
  title: string
  request: string
  /** Clarifications transcript, pre-formatted. Empty string = skip the file. */
  clarifications?: string
  /** Operator notes, pre-formatted. Empty string = skip the file. */
  operatorNotes?: string
}

/**
 * Write the intent bundle under `<worktreeDir>/.opencorvus/intent/`.
 * Idempotent — safe to call multiple times; files are overwritten so
 * the bundle always reflects the latest clarifications and operator
 * notes passed in.
 */
export async function writeIntentBundle(input: WriteIntentBundleInput): Promise<void> {
  const intentDir = path.join(input.worktreeDir, ".opencorvus", "intent")
  await fs.mkdir(intentDir, { recursive: true })

  const manifest: Array<{ path: string; summary: string }> = []

  const requestMd = renderRequestMarkdown(input.title, input.request)
  await fs.writeFile(path.join(intentDir, "request.md"), requestMd, "utf8")
  manifest.push({ path: "request.md", summary: "User's original task request (verbatim)" })

  const clarifications = (input.clarifications ?? "").trim()
  if (clarifications) {
    const clarificationsMd = stripLeadingSectionHeader(clarifications)
    await fs.writeFile(path.join(intentDir, "clarifications.md"), clarificationsMd, "utf8")
    manifest.push({ path: "clarifications.md", summary: "Operator answers to agent questions" })
  }

  const operatorNotes = (input.operatorNotes ?? "").trim()
  if (operatorNotes) {
    const notesMd = stripLeadingSectionHeader(operatorNotes)
    await fs.writeFile(path.join(intentDir, "operator-notes.md"), notesMd, "utf8")
    manifest.push({ path: "operator-notes.md", summary: "Operator notes added during task execution" })
  }

  await fs.writeFile(path.join(intentDir, "README.md"), renderReadme(manifest), "utf8")

  log.info("wrote intent bundle", {
    worktreeDir: input.worktreeDir,
    taskID: input.taskID,
    files: manifest.map((m) => m.path),
  })
}

/**
 * The helpers in `orchestrator/helpers.ts` format their output for inline
 * prompt injection (leading blank lines + an `## <Title>` header). When
 * the same content is mounted as a standalone file, that prompt-shaped
 * preamble is redundant — the file name already states the title.
 */
function stripLeadingSectionHeader(section: string): string {
  const trimmed = section.trimStart()
  const lines = trimmed.split("\n")
  if (lines[0]?.startsWith("## ")) {
    let body = lines.slice(1).join("\n")
    while (body.startsWith("\n")) body = body.slice(1)
    return body
  }
  return trimmed
}

function renderRequestMarkdown(title: string, request: string): string {
  return `# ${title}\n\n${request.replace(/\r\n/g, "\n").trimEnd()}\n`
}

function renderReadme(manifest: Array<{ path: string; summary: string }>): string {
  const lines: string[] = [
    "# Intent Bundle",
    "",
    "This directory holds the authoritative copy of the user-provided material",
    "for THIS task. It is the primary channel for the original request, answers,",
    "and operator notes. Goal objectives and plan steps intentionally do NOT",
    "duplicate this content — read the files here when you need the original",
    "wording, field-level details, or the full context behind a decision.",
    "",
    "## Files",
    "",
  ]
  for (const entry of manifest) {
    lines.push(`- \`${entry.path}\` — ${entry.summary}`)
  }
  lines.push(
    "",
    "## Attachment Lookup",
    "",
    "Task attachments are not duplicated into this directory.",
    "When task material points at an attachment reference such as",
    "`attachment://<sha>.<ext>` or `/attachment/<projectID>/<sha>.<ext>`,",
    "resolve it from the project's `.opencorvus/attachments/` store.",
    "",
  )
  return lines.join("\n")
}
