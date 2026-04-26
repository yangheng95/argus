import { Log } from "@/util/log"

const log = Log.create({ service: "executor-runtime-env" })

const EXECUTOR_MODEL_ENV: Record<string, string> = {
  codex: "OPENCORVUS_EXECUTOR_CODEX_MODEL",
  "claude-code": "OPENCORVUS_EXECUTOR_CLAUDE_MODEL",
}

export type ExecutorID = keyof typeof EXECUTOR_MODEL_ENV | string

export function envKeyFor(id: ExecutorID): string | undefined {
  return EXECUTOR_MODEL_ENV[id]
}

export function getModelOverride(id: ExecutorID): string | undefined {
  const key = envKeyFor(id)
  return key ? process.env[key] : undefined
}

export function setModelOverride(id: ExecutorID, model: string | null): boolean {
  const key = envKeyFor(id)
  if (!key) return false
  if (model === null || model === "") {
    delete process.env[key]
    log.info("executor model env cleared", { id, key })
  } else {
    process.env[key] = model
    log.info("executor model env set", { id, key, model })
  }
  return true
}
