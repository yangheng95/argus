import { Database, eq } from "@/storage/db"
import { CheckConfig } from "./model"
import { OrchestratorTaskTable } from "./orchestrator.sql"
import { requireTask, type TaskRow, viewTask } from "./store"

function requiredSpecCheck(current: unknown) {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? structuredClone(current as Record<string, unknown>)
      : {}
  if (base.enabled === false) {
    return {
      ...base,
      enabled: false,
      mode: base.mode ?? "strict",
    }
  }
  return {
    ...base,
    enabled: true,
    mode: "strict",
  }
}

export function normalizeTaskChecks(raw: unknown) {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? structuredClone(raw as Record<string, unknown>)
      : {}
  const checks = Object.fromEntries(
    Object.entries(source).filter(([key]) => key in CheckConfig.shape),
  )
  checks.spec_check = requiredSpecCheck(checks.spec_check)
  return checks
}

export function writeTaskChecks(task: TaskRow, checks: Record<string, unknown> | undefined) {
  const next = normalizeTaskChecks(checks)
  const metadata = {
    ...(task.metadata ?? {}),
    checks: next,
  }
  Database.use((db) =>
    db
      .update(OrchestratorTaskTable)
      .set({
        metadata,
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run(),
  )
  return viewTask(requireTask(task.id))
}

export function mergeTaskChecks(raw: unknown, selection: Record<string, boolean>) {
  const checks = normalizeTaskChecks(raw)

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

    if (key === "spec_check") {
      checks.spec_check = enabled
        ? requiredSpecCheck(checks.spec_check)
        : requiredSpecCheck({
            ...(checks.spec_check && typeof checks.spec_check === "object" && !Array.isArray(checks.spec_check)
              ? checks.spec_check as Record<string, unknown>
              : {}),
            enabled: false,
          })
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

  return normalizeTaskChecks(checks)
}

function checkSelectionConfig(key: string, current: unknown) {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? structuredClone(current as Record<string, unknown>)
      : undefined

  if (key === "artifact") return base ?? {}
  if (key === "ui_review") return { ...(base ?? {}), target: "web" }
  if (["code_quality", "code_review", "dead_code_review", "spec_check"].includes(key)) {
    return { ...(base ?? {}), enabled: true }
  }
  if (["startup", "visual", "puppeteer"].includes(key)) return base
  return { ...(base ?? {}), enabled: true }
}
