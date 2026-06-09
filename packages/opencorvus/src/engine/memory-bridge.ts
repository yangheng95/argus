import { Memory } from "@/memory"
import { Log } from "@/util/log"

const log = Log.create({ service: "engine-memory-bridge" })

interface TaskRow {
  id: string
  title: string
  request: string
  project_id: string
}

interface RunRow {
  id: string
  retry_count: number
  plan_version_id: string | null
}

interface AcceptanceRow {
  id: string
  summary: string | null
  result: Record<string, unknown> | null
}

interface EvaluationRow {
  id: string
  status: string
  summary: string | null
  checks: unknown
}

interface PlanRow {
  id: string
  summary: string
  version: number
}

export namespace EngineMemoryBridge {
  export async function flushTaskLearnings(input: {
    task: TaskRow
    run: RunRow
    acceptance: AcceptanceRow
    evaluation?: EvaluationRow | null
    plan?: PlanRow | null
  }) {
    const { task, run, acceptance, evaluation, plan } = input
    try {
      const changedFiles = Array.isArray(acceptance.result?.changed_files)
        ? acceptance.result.changed_files.filter((item): item is string => typeof item === "string")
        : []
      const checks = (evaluation?.checks as Array<{ name: string; status: string; evidence?: string }>) ?? []

      const sections: string[] = [`# Task Completed: ${task.title}`, "", `## Request`, task.request.slice(0, 500)]

      if (plan) {
        sections.push("", `## Approach (Plan v${plan.version})`, plan.summary.slice(0, 500))
      }

      if (acceptance.summary) {
        sections.push("", "## Outcome", acceptance.summary.slice(0, 1000))
      }

      if (changedFiles.length > 0) {
        sections.push("", "## Changed Files", ...changedFiles.slice(0, 30).map((f) => `- ${f}`))
      }

      if (checks.length > 0) {
        const checkLines = checks.map((c) => `- ${c.name}: ${c.status}`)
        sections.push("", "## Check Results", ...checkLines)
      }

      if (run.retry_count > 0) {
        sections.push("", "## Notes", `Required ${run.retry_count} retries before passing.`)
      }

      const markdown = sections.join("\n")
      const atomics: Array<{
        kind: "profile" | "lesson" | "fact"
        text: string
        section: string
        importance?: number
      }> = []

      // Outcome section contains facts about what was delivered
      if (acceptance.summary) {
        atomics.push({ kind: "fact", text: acceptance.summary.slice(0, 240), section: "Outcome" })
      }

      // Plan summary is a fact about the approach taken
      if (plan) {
        atomics.push({ kind: "fact", text: plan.summary.slice(0, 240), section: `Approach (Plan v${plan.version})` })
      }

      // Retry count is a lesson worth remembering
      if (run.retry_count > 0) {
        atomics.push({
          kind: "lesson",
          text: `Required ${run.retry_count} retries before passing.`,
          section: "Notes",
          importance: 90,
        })
      }

      const result = Memory.captureEpisode({
        title: `Task: ${task.title.slice(0, 80)}`,
        content: markdown,
        source: "compaction",
        projectId: task.project_id,
        scope: "global",
        atomics: atomics.length > 0 ? atomics : undefined,
      })
      log.info("flushed task learnings to memory", {
        taskID: task.id,
        fileID: result.episode.id,
        derived: result.derived.length,
      })
    } catch (err) {
      log.warn("failed to flush task learnings", { taskID: task.id, error: String(err) })
    }
  }
}
