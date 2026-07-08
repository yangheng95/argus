import { Database } from "@/storage/db"
import { requireTask, type TaskRow, viewTask } from "./store"
import { setEngineTaskMetadata } from "./task"

export function writeTaskChecks(task: TaskRow, checks: Record<string, unknown> | undefined) {
  const metadata = {
    ...(task.metadata ?? {}),
    ...(checks ? { checks } : {}),
  }
  if (!checks) delete metadata.checks
  Database.use((db) => setEngineTaskMetadata(db, { taskID: task.id, metadata }))
  return viewTask(requireTask(task.id))
}

export function mergeTaskChecks(raw: unknown, selection: Record<string, boolean>) {
  const checks =
    raw && typeof raw === "object" && !Array.isArray(raw) ? structuredClone(raw as Record<string, unknown>) : {}

  const named =
    checks.named && typeof checks.named === "object" && !Array.isArray(checks.named)
      ? structuredClone(checks.named as Record<string, unknown>)
      : {}

  for (const [key, enabled] of Object.entries(selection)) {
    if (key.startsWith("named:")) {
      const name = key.slice("named:".length)
      const current = named[name]
      if (!name || !current || typeof current !== "object" || Array.isArray(current)) continue
      named[name] = {
        ...current,
        enabled,
      }
      continue
    }

    if (["lint", "build", "test", "verify_cmd"].includes(key)) {
      if (enabled) {
        if (checks[key] === false) delete checks[key]
        continue
      }
      checks[key] = false
      continue
    }

    if (enabled) {
      const next = checkSelectionConfig(key, checks[key])
      if (next) checks[key] = next
      continue
    }
    delete checks[key]
  }

  if (Object.keys(named).length > 0) checks.named = named
  else delete checks.named

  return Object.keys(checks).length > 0 ? checks : undefined
}

function checkSelectionConfig(key: string, current: unknown) {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? structuredClone(current as Record<string, unknown>)
      : undefined

  if (key === "artifact") return base ?? {}
  if (key === "ui_review") return { ...(base ?? {}), target: "web" }
  if (["code_quality", "code_review", "dead_code_review", "judge", "spec_check"].includes(key)) {
    return { ...(base ?? {}), enabled: true }
  }
  if (["startup", "visual", "playwright"].includes(key)) return base
  return { ...(base ?? {}), enabled: true }
}
