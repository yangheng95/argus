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
  if (!key) return undefined
  const model = process.env[key]?.trim()
  if (!model) return undefined
  assertExecutorModel(id, model, key)
  return model
}

export function setModelOverride(id: ExecutorID, model: string | null): boolean {
  const key = envKeyFor(id)
  if (!key) return false
  const next = model?.trim() ?? ""
  if (!next) {
    delete process.env[key]
    log.info("executor model env cleared", { id, key })
  } else {
    assertExecutorModel(id, next, key)
    process.env[key] = next
    log.info("executor model env set", { id, key, model: next })
  }
  return true
}

export function assertExecutorModel(id: ExecutorID, model: string, key = envKeyFor(id)) {
  if (id !== "claude-code" && id !== "codex") return
  if (!model.includes("/")) return
  const source = key ? `${key}=${model}` : model
  if (id === "codex") {
    throw new Error(
      `Invalid codex executor model: ${source}. ` +
        "Codex expects the native Codex CLI --model value here, not an OpenCorvus provider/model reference. " +
        "Keep the OpenCorvus task model in opencorvus.json and set the Codex executor model separately.",
    )
  }
  throw new Error(
    `Invalid claude-code executor model: ${source}. ` +
      "Claude Code expects the native Claude CLI --model value here, not an OpenCorvus provider/model reference. " +
      "Keep the OpenCorvus task model in opencorvus.json and set the Claude executor model separately.",
  )
}
