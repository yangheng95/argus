/**
 * Per-agent model resolution.
 *
 * Single source of truth for "which model does agent X use?". Resolution order:
 *
 *   1. Explicit `agent.<name>.model` from user config (Agent.Info.model)
 *      — user's deliberate per-agent override always wins.
 *   2. Most recent user-message-level model pick on the user's task session.
 *      The lookup uses `opts.sessionID` if supplied, otherwise resolves it
 *      from `opts.taskID` (most callers already hold a taskID, so they can
 *      pass that without fetching the task themselves). This is how a user's
 *      in-task model selection ("use claude-sonnet for THIS task") propagates
 *      to every sub-agent the orchestrator dispatches.
 *   3. `OPENCORVUS_BENCHMARK_MODEL` / `OPENCORVUS_E2E_MODEL` env override
 *      (used by benchmarks to pin a model without touching user config).
 *   4. Top-level `model` field in opencorvus.jsonc.
 *   5. Provider.defaultModel().
 *
 * Sub-agents (architect, planner, requirements, design-analyst, delivery,
 * orchestrator) all call this with the originating task's ID so the user's
 * choice is honored consistently across the pipeline. Without taskID/sessionID
 * the function still works — the session step is simply skipped.
 */
import { Agent } from "./agent"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Message } from "@/session/message"
import { findTask } from "@/engine/store"

type ModelRef = {
  providerID: string
  modelID: string
}

/**
 * Walk the session newest-to-oldest and return the most recent user-chosen
 * model. Returns undefined if no user message in the session ever carried a
 * model selection. Iterator stops at the first hit, so the common case
 * (user's most recent message has a model) is O(1).
 */
async function sessionModel(sessionID: string): Promise<ModelRef | undefined> {
  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) {
      return {
        providerID: item.info.model.providerID,
        modelID: item.info.model.modelID,
      }
    }
  }
  return undefined
}

function envModel(): ModelRef | undefined {
  for (const key of ["OPENCORVUS_BENCHMARK_MODEL", "OPENCORVUS_E2E_MODEL"]) {
    const value = process.env[key]?.trim()
    if (value && value.includes("/")) return Provider.parseModel(value)
  }
  return undefined
}

async function configuredModel(): Promise<ModelRef | undefined> {
  const env = envModel()
  if (env) return env
  const cfg = await Config.get()
  if (cfg.model) return Provider.parseModel(cfg.model)
  return undefined
}

/**
 * Resolve the Provider.Model for a given agent by name. See file header for
 * the full priority order.
 *
 * `opts.sessionID` takes precedence over `opts.taskID` for the session lookup;
 * pass sessionID directly when the caller already holds it (e.g. delivery has
 * `task.sessionID` in scope), pass taskID when the caller only holds an ID
 * (e.g. architect / planner / requirements receive `taskID`).
 *
 * A failure to load an explicitly-configured model is NOT silently swallowed:
 * if the user pointed `agent.<name>.model` at a missing provider/model, the
 * call fails so the misconfiguration surfaces instead of being papered over
 * with the default.
 */
export async function resolveAgentModel(
  name: string,
  opts?: { taskID?: string; sessionID?: string },
): Promise<Provider.Model> {
  const agent = await Agent.get(name)
  if (agent?.model) {
    return Provider.getModel(agent.model.providerID, agent.model.modelID)
  }
  const sessionID =
    opts?.sessionID ??
    (opts?.taskID ? findTask(opts.taskID)?.session_id ?? undefined : undefined)
  if (sessionID) {
    const session = await sessionModel(sessionID)
    if (session) {
      return Provider.getModel(session.providerID, session.modelID)
    }
  }
  const configured = await configuredModel()
  if (configured) {
    return Provider.getModel(configured.providerID, configured.modelID)
  }
  const def = await Provider.defaultModel()
  return Provider.getModel(def.providerID, def.modelID)
}

/**
 * Resolve a model ref from the env/config layers only — used by tests and by
 * the benchmark path to inspect the configured default without engaging the
 * agent or session layers. Mirrors the env → config → Provider.defaultModel
 * tail of resolveAgentModel.
 */
export async function resolveConfiguredModelRef(): Promise<ModelRef> {
  const configured = await configuredModel()
  if (configured) return configured
  return Provider.defaultModel()
}
