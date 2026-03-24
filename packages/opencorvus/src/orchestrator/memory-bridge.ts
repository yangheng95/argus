import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { RetryContext } from "./helpers"

const log = Log.create({ service: "orchestrator-memory-bridge" })

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

interface DeliveryRow {
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

export namespace OrchestratorMemoryBridge {
  export async function flushTaskLearnings(input: {
    task: TaskRow
    run: RunRow
    delivery: DeliveryRow
    evaluation?: EvaluationRow | null
    plan?: PlanRow | null
  }) {
    const { task, run, delivery, evaluation, plan } = input
    try {
      const changedFiles = (delivery.result?.changed_files as string[]) ?? []
      const checks = (evaluation?.checks as Array<{ name: string; status: string; evidence?: string }>) ?? []

      const sections: string[] = [
        `# Task Completed: ${task.title}`,
        "",
        `## Request`,
        task.request.slice(0, 500),
      ]

      if (plan) {
        sections.push("", `## Approach (Plan v${plan.version})`, plan.summary.slice(0, 500))
      }

      if (delivery.summary) {
        sections.push("", "## Outcome", delivery.summary.slice(0, 1000))
      }

      if (changedFiles.length > 0) {
        sections.push("", "## Changed Files", ...changedFiles.slice(0, 30).map((f) => `- ${f}`))
      }

      if (checks.length > 0) {
        const checkLines = checks.map(
          (c) => `- ${c.name}: ${c.status}`,
        )
        sections.push("", "## Check Results", ...checkLines)
      }

      if (run.retry_count > 0) {
        sections.push("", "## Notes", `Required ${run.retry_count} retries before passing.`)
      }

      const markdown = sections.join("\n")
      const atomics: Array<{ kind: "profile" | "lesson" | "fact"; text: string; section: string; importance?: number }> = []

      // Outcome section contains facts about what was delivered
      if (delivery.summary) {
        atomics.push({ kind: "fact", text: delivery.summary.slice(0, 240), section: "Outcome" })
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

  export async function flushFailureLearnings(input: {
    task: TaskRow
    run: RunRow
    summary: string
    retryContext?: RetryContext
  }) {
    const { task, run, summary, retryContext } = input
    try {
      const sections: string[] = [
        `# Task Failed: ${task.title}`,
        "",
        `## Request`,
        task.request.slice(0, 500),
        "",
        "## Failure Summary",
        summary.slice(0, 1000),
      ]

      if (retryContext?.changedFiles && retryContext.changedFiles.length > 0) {
        sections.push("", "## Files Modified Before Failure", ...retryContext.changedFiles.slice(0, 30).map((f) => `- ${f}`))
      }

      if (retryContext?.rootCause) {
        sections.push("", "## Root Cause", retryContext.rootCause)
      }

      if (retryContext?.avoidApproaches && retryContext.avoidApproaches.length > 0) {
        sections.push("", "## Approaches That Failed", ...retryContext.avoidApproaches.map((a) => `- ${a}`))
      }

      if (retryContext?.checks && retryContext.checks.length > 0) {
        const checkLines = retryContext.checks.map(
          (c) => `- ${c.name}: ${c.status}`,
        )
        sections.push("", "## Check Results", ...checkLines)
      }

      sections.push("", "## Lessons", `This task exhausted ${run.retry_count + 1} attempts. Future tasks with similar scope should account for the root cause above.`)

      const markdown = sections.join("\n")
      const failAtomics: Array<{ kind: "profile" | "lesson" | "fact"; text: string; section: string; importance?: number }> = []

      // Failure summary is a lesson
      failAtomics.push({
        kind: "lesson",
        text: summary.slice(0, 240),
        section: "Failure Summary",
        importance: 92,
      })

      // Root cause is a high-importance lesson
      if (retryContext?.rootCause) {
        failAtomics.push({
          kind: "lesson",
          text: retryContext.rootCause.slice(0, 240),
          section: "Root Cause",
          importance: 94,
        })
      }

      // Failed approaches are lessons to avoid
      if (retryContext?.avoidApproaches) {
        for (const approach of retryContext.avoidApproaches.slice(0, 3)) {
          failAtomics.push({
            kind: "lesson",
            text: approach.slice(0, 240),
            section: "Approaches That Failed",
            importance: 90,
          })
        }
      }

      // Exhausted retries is a lesson
      failAtomics.push({
        kind: "lesson",
        text: `This task exhausted ${run.retry_count + 1} attempts. Future tasks with similar scope should account for the root cause above.`,
        section: "Lessons",
        importance: 90,
      })

      const result = Memory.captureEpisode({
        title: `Failed: ${task.title.slice(0, 80)}`,
        content: markdown,
        source: "compaction",
        projectId: task.project_id,
        scope: "global",
        atomics: failAtomics,
      })
      log.info("flushed failure learnings to memory", {
        taskID: task.id,
        fileID: result.episode.id,
        derived: result.derived.length,
      })
    } catch (err) {
      log.warn("failed to flush failure learnings", { taskID: task.id, error: String(err) })
    }
  }
}
