// ── IntentBundle ──
//
// Materializes the user's task request as a stable, on-disk bundle that
// downstream agents (planner / architect / build executor / integrity) can
// reference by path.
//
// Why this exists:
//
// Several stage prompts (planner-core.txt, architect-core.txt, session
// system.txt) tell the LLM that the executor "has the intent bundle at
// `.opencorvus/intent/`" and explicitly point at `.opencorvus/intent/request.md`
// as the canonical source for the user's original request. Architect-generated
// goal contracts then reference paths like "see .opencorvus/intent/request.md
// §3 for the full entity list" verbatim. Without this writer, those paths
// resolved to nothing on disk — the architect was producing references to a
// path the project never created. Either the executor would silently miss the
// reference (and lean on the goal contract's paraphrase, leaking architect
// intent into build), or it would search the workspace and hallucinate.
//
// Single source of truth: `<project.worktree>/.opencorvus/intent/request.md`.
// Mirrors AttachmentStore's resolution path (Project.get(projectID).worktree
// — NOT Instance.directory, which can drift) so writers and readers always
// agree on the location.
//
// Bundle is written before `persistQueuedTask` runs so it is on disk by the
// time the orchestrator wakes the planner. The contents are deterministic
// from {request, attachments}; rerunning is idempotent.

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { Project } from "@/project/project"
import { Log } from "@/util/log"
import type { AttachmentStore } from "@/storage/attachment-store"

const log = Log.create({ service: "intent-bundle" })

export namespace IntentBundle {
  export type WriteInput = {
    projectID: string
    taskID: string
    request: string
    attachments?: AttachmentStore.Reference[]
    source?: string
    kind?: "workflow" | "build"
    createdAt?: number
  }

  function bundleDir(projectDir: string): string {
    return path.join(projectDir, ".opencorvus", "intent")
  }

  function renderRequest(input: WriteInput): string {
    const created = new Date(input.createdAt ?? Date.now()).toISOString()
    const lines: string[] = []
    lines.push("---")
    lines.push(`taskID: ${input.taskID}`)
    lines.push(`projectID: ${input.projectID}`)
    if (input.kind) lines.push(`kind: ${input.kind}`)
    if (input.source) lines.push(`source: ${input.source}`)
    lines.push(`createdAt: ${created}`)
    lines.push("---")
    lines.push("")
    lines.push("# User request")
    lines.push("")
    lines.push(input.request.replace(/\r\n/g, "\n").trimEnd())
    lines.push("")

    if (input.attachments && input.attachments.length > 0) {
      lines.push("## Attachments")
      lines.push("")
      lines.push("| sha (short) | filename | mime | intent | source | url |")
      lines.push("|---|---|---|---|---|---|")
      for (const att of input.attachments) {
        const shortSha = att.sha.slice(0, 12)
        lines.push(
          `| \`${shortSha}\` | ${att.filename ?? "—"} | ${att.mime} | ${att.intent ?? "—"} | ${att.source ?? "—"} | \`${att.url}\` |`,
        )
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * Write the bundle for a task. Returns the absolute path of request.md.
   * Throws if the project cannot be resolved — callers should treat the bundle
   * as load-bearing for downstream agents.
   */
  export async function write(input: WriteInput): Promise<string> {
    const project = Project.get(input.projectID)
    if (!project) {
      throw new Error(`IntentBundle.write: unknown project ${input.projectID}`)
    }
    const dir = bundleDir(project.worktree)
    await fs.mkdir(dir, { recursive: true })
    const abs = path.join(dir, "request.md")
    const body = renderRequest(input)
    await fs.writeFile(abs, body, "utf8")
    log.info("intent bundle written", {
      taskID: input.taskID,
      projectID: input.projectID,
      path: abs,
      bytes: body.length,
      attachments: input.attachments?.length ?? 0,
    })
    return abs
  }
}
