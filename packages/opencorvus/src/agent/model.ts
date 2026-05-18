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
 * THE single model resolver (spec §11.1/§13.1). Monotone precedence — every
 * other model-derivation path in the codebase funnels here; a new parallel
 * derivation is a rule 8 violation:
 *
 *   1. explicitModel        — per-request, user-specified for THIS call only
 *                             (the ONLY allowed input outside the resolver).
 *   2. session overlay      — agent.<name>.model, then top-level model
 *   3. project base         — agent.<name>.model, then top-level model
 *   4. MissingModelConfigError — NO history-derived / DEFAULT_MODEL fallback.
 *
 * The session overlay comes from the ambient SessionContext (established at
 * every session execution entry point). Subagents/out-of-context callers that
 * need a specific session's choice pass `explicitModel` resolved by the caller
 * (spec §13.3) — the resolver never does its own session/task DB lookup, so
 * it stays cycle-free and single-source. `sessionID`/`taskID` are accepted for
 * call-site provenance/telemetry only; overlay is read from the ambient scope.
 */
export async function resolveAgentModelRef(
  name: string,
  opts?: { taskID?: string; sessionID?: string; explicitModel?: ModelRef | null },
): Promise<ModelRef> {
  if (opts?.explicitModel) {
    return { providerID: opts.explicitModel.providerID, modelID: opts.explicitModel.modelID }
  }
  const overlay = SessionContext.overlay()
  const overlayAgentModel = overlay?.agent?.[name]?.model
  if (overlayAgentModel) return Provider.parseModel(overlayAgentModel)
  if (overlay?.model) return Provider.parseModel(overlay.model)
  const { Agent } = await import("./agent")
  const agent = await Agent.get(name)
  if (agent?.model) {
    return { providerID: agent.model.providerID, modelID: agent.model.modelID }
  }
  const cfg = await Config.get()
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
  return Provider.getModel(ref.providerID, ref.modelID)
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
export async function resolveConfiguredModelRef(): Promise<ModelRef> {
  const overlay = SessionContext.overlay()
  if (overlay?.model) return Provider.parseModel(overlay.model)
  const cfg = await Config.get()
  if (cfg.model) return Provider.parseModel(cfg.model)
  throw new MissingModelConfigError({
    message:
      "No `model` configured (session overlay or opencorvus.jsonc). " +
      "The project must declare a default model — fallbacks are not allowed.",
  })
}

/**
 * Resolve a Provider.Model from an optional explicit ref, falling back to the
 * supplied `fallback` argument (which the caller has already resolved through
 * the strict path above). This helper exists only to deduplicate the
 * "ref ? getModel(ref) : alreadyResolvedDefault" shape at subtask dispatch /
 * compaction sites. It is NOT a config fallback — the caller owns the
 * `fallback` argument and is responsible for it being valid.
 */
export async function resolveModelRef(
  ref: { providerID: string; modelID: string } | undefined | null,
  fallback: Provider.Model,
): Promise<Provider.Model> {
  if (!ref) return fallback
  return Provider.getModel(ref.providerID, ref.modelID)
}
