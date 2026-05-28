/**
 * Per-agent model resolution — strict, no fallbacks.
 *
 * Resolution rule (exactly two levels, in order):
 *
 *   1. Explicit `agent.<name>.model` in opencorvus.jsonc — per-agent override.
 *   2. Top-level `model` in opencorvus.jsonc — project default.
 *
 * If neither is set, this function throws `MissingModelConfigError`. We do not
 * fall back to any implicit source (session user-message selection, env vars,
 * provider registry order, recent-model state file). The previous
 * "Provider.defaultModel() reads model.json.recent[0]" chain was a mutable
 * global whose value changed when the operator clicked a model in the overlay
 * UI — that directly caused goal retries to silently switch provider/model
 * between runs (hexin/claude-sonnet-4-6 → alibaba-coding-plan-cn/glm-5),
 * collapsing prompt cache across retries because Anthropic/GLM caches are
 * physically isolated.
 *
 * opencorvus.jsonc is the single source of truth. If the operator wants to
 * change the model, they edit the config file (which the overlay settings
 * panel surfaces read-only). Everything else — env variables, recent-model
 * state, session user-message propagation — is a fallback and forbidden.
 */
import { Config } from "@/config/config"
import { EffectiveConfig } from "@/config/effective"
import { Provider } from "@/provider/provider"
import { SessionContext } from "@/session/context"
import { NamedError } from "@opencorvus-ai/util/error"
import z from "zod"

type ModelRef = {
  providerID: string
  modelID: string
}

export const MissingModelConfigError = NamedError.create(
  "MissingModelConfigError",
  z.object({
    agent: z.string().optional(),
    message: z.string(),
  }),
)

/**
 * THE single model resolver (spec §11.1/§13.1, R5.1 item 3/4/5). Monotone
 * precedence — every other model-derivation path in the codebase funnels
 * here; a new parallel derivation is a rule 8 violation:
 *
 *   1. explicitModel             — per-request, user-specified for THIS call
 *                                  only (the ONLY input outside the resolver).
 *   2. explicit taskID root overlay
 *   3. explicit sessionID overlay (resolved to its root session)
 *   4. ambient SessionContext overlay (resolved to its root session)
 *   5. project base              — agent.<name>.model, then top-level model
 *   6. MissingModelConfigError   — NO history-derived / DEFAULT_MODEL fallback.
 *
 * The session overlay is sourced through the single `resolveSessionOverlay`
 * chokepoint (R5.1 item 3) so model and prompt/temperature reuse the exact
 * same overlay. Explicit `taskID` / `sessionID` take precedence over the
 * ambient context (R5.1 item 3); ambient and an explicit task root are NOT a
 * conflict — only contradictory same-call explicit `taskID` vs `sessionID`
 * inputs throw. A `taskID` whose engine task has a null `session_id` is a
 * hard error, never a silent project-base fallback (R5.1 item 4).
 */
export async function resolveAgentModelRef(
  name: string,
  opts?: { taskID?: string; sessionID?: string; explicitModel?: ModelRef | null },
): Promise<ModelRef> {
  if (opts?.explicitModel) {
    return { providerID: opts.explicitModel.providerID, modelID: opts.explicitModel.modelID }
  }
  const overlay = await resolveSessionOverlay(opts)
  const overlayAgentModel = overlay?.agent?.[name]?.model
  if (overlayAgentModel) return Provider.parseModel(overlayAgentModel)
  if (overlay?.model) return Provider.parseModel(overlay.model)
  const cfg = await EffectiveConfig.base(opts)
  const { Agent } = await import("./agent")
  const agent = await Agent.get(name, { config: cfg })
  if (agent?.model) {
    return { providerID: agent.model.providerID, modelID: agent.model.modelID }
  }
  if (cfg.model) return Provider.parseModel(cfg.model)
  throw new MissingModelConfigError({
    agent: name,
    message:
      `No model configured for agent "${name}". ` +
      `Set \`agent.${name}.model\` or top-level \`model\` in opencorvus.jsonc.`,
  })
}

/** As resolveAgentModelRef, but returns the loaded Provider.Model. */
export async function resolveAgentModel(
  name: string,
  opts?: { taskID?: string; sessionID?: string; explicitModel?: ModelRef | null },
): Promise<Provider.Model> {
  const ref = await resolveAgentModelRef(name, opts)
  return Provider.getModel(ref.providerID, ref.modelID, { config: await EffectiveConfig.effective(opts) })
}

/**
 * Resolve a model ref from config (session overlay over project base) without
 * going through an agent — e.g. the overlay settings panel asking "what's the
 * effective default?". Same single-source precedence as resolveAgentModel for
 * the non-agent levels. Throws when no `model` anywhere (no fallback).
 *
 * This is also the ONLY "configured default model" entrypoint — Provider's old
 * parallel defaultModel() (duplicate cfg.model→parse→throw, rule 8) is removed
 * and delegates here.
 */
export async function resolveConfiguredModelRef(opts?: { taskID?: string; sessionID?: string }): Promise<ModelRef> {
  const overlay = await resolveSessionOverlay(opts)
  if (overlay?.model) return Provider.parseModel(overlay.model)
  const cfg = await EffectiveConfig.base(opts)
  if (cfg.model) return Provider.parseModel(cfg.model)
  throw new MissingModelConfigError({
    message:
      "No `model` configured (session overlay or opencorvus.jsonc). " +
      "The project must declare a default model — fallbacks are not allowed.",
  })
}

/**
 * THE single session-config-overlay chokepoint (R5.1 item 3). Both model
 * resolution and prompt/temperature resolution (`Agent.resolveSessionAgent`)
 * read the overlay through here so they never diverge (rule 8 single source).
 *
 * Precedence: explicit taskID root > explicit sessionID > ambient. Every
 * branch resolves to the *root* session and reads the root's overlay — a
 * child execution session runs normally but never reads its own
 * `metadata.configOverlay`; it inherits the task-root overlay (R5.1 item 5).
 *
 * - `taskID`: the engine task's bound `session_id` IS the task root. A null
 *   `session_id` is a hard error (R5.1 item 4) — no project-base fallback.
 * - `taskID` + `sessionID` together: only a *contradiction* (they resolve to
 *   different root sessions) throws; otherwise taskID wins (R5.1 item 3).
 */
export async function resolveSessionOverlay(opts?: {
  taskID?: string
  sessionID?: string
}): Promise<Config.Overlay | undefined> {
  if (opts?.taskID) {
    const taskRoot = await sessionIDForTask(opts.taskID)
    if (!taskRoot) {
      throw new MissingModelConfigError({
        message:
          `Task ${opts.taskID} has no bound root session (engine_task.session_id is null); ` +
          `cannot resolve session config overlay. Repair task.session_id — ` +
          `the resolver must not silently fall back to the project base.`,
      })
    }
    if (opts.sessionID) {
      const explicitRoot = await resolveRootSessionID(opts.sessionID)
      if (explicitRoot !== taskRoot) {
        throw new MissingModelConfigError({
          message:
            `Contradictory model-resolution inputs: taskID ${opts.taskID} binds root session ` +
            `${taskRoot} but sessionID ${opts.sessionID} resolves to root ${explicitRoot}.`,
        })
      }
    }
    return loadRootOverlay(taskRoot)
  }
  if (opts?.sessionID) return loadEffectiveOverlay(opts.sessionID)
  const ambient = SessionContext.tryUse()
  if (!ambient) return undefined
  // Root session: read the in-context Session.Info directly — no DB hit,
  // preserving the prior ambient semantics and concurrent-session isolation
  // (each provide() carries its own Session.Info).
  if (!ambient.parentID) return parseOverlay(ambient.metadata?.configOverlay)
  // Child execution session: it runs normally but never reads its OWN
  // metadata.configOverlay — it inherits the task-root overlay (R5.1 item 5).
  return loadEffectiveOverlay(ambient.id)
}

async function sessionIDForTask(taskID: string): Promise<string | undefined> {
  const { requireTask } = await import("@/engine/store")
  return requireTask(taskID).session_id ?? undefined
}

/**
 * Walk `parentID` to the top-most root session. A child execution session
 * inherits its task-root overlay (R5.1 item 5). The hop count is bounded
 * purely as a cycle guard — this is not state-machine flow control (rule 13).
 */
async function resolveRootSessionID(sessionID: string): Promise<string> {
  const { Session } = await import("@/session")
  let current = await Session.get(sessionID)
  for (let hops = 0; current.parentID && hops < 64; hops++) {
    current = await Session.get(current.parentID)
  }
  return current.id
}

async function loadEffectiveOverlay(sessionID: string): Promise<Config.Overlay | undefined> {
  return loadRootOverlay(await resolveRootSessionID(sessionID))
}

async function loadRootOverlay(rootSessionID: string): Promise<Config.Overlay | undefined> {
  const { Session } = await import("@/session")
  const session = await Session.get(rootSessionID)
  return parseOverlay(session.metadata?.configOverlay)
}

function parseOverlay(raw: unknown): Config.Overlay | undefined {
  return raw ? Config.Overlay.parse(raw) : undefined
}
