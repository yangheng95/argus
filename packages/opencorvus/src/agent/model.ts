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
import { Agent } from "./agent"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
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
 * Resolve the Provider.Model for a given agent by name.
 *
 * Throws `MissingModelConfigError` when neither `agent.<name>.model` nor
 * top-level `model` is configured. Callers must not catch-and-default this
 * error; the expected remediation is for the operator to set `model` in
 * opencorvus.jsonc (or a per-agent override).
 */
export async function resolveAgentModel(
  name: string,
  _opts?: { taskID?: string; sessionID?: string },
): Promise<Provider.Model> {
  const agent = await Agent.get(name)
  if (agent?.model) {
    return Provider.getModel(agent.model.providerID, agent.model.modelID)
  }
  const cfg = await Config.get()
  if (cfg.model) {
    const ref = Provider.parseModel(cfg.model)
    return Provider.getModel(ref.providerID, ref.modelID)
  }
  throw new MissingModelConfigError({
    agent: name,
    message:
      `No model configured for agent "${name}". ` +
      `Set \`agent.${name}.model\` or top-level \`model\` in opencorvus.jsonc.`,
  })
}

/**
 * Resolve a model ref from config only — used by paths that need the project
 * default without going through an agent (e.g. the overlay settings panel
 * asking "what's the configured default?"). Throws when `model` is missing.
 */
export async function resolveConfiguredModelRef(): Promise<ModelRef> {
  const cfg = await Config.get()
  if (cfg.model) return Provider.parseModel(cfg.model)
  throw new MissingModelConfigError({
    message:
      "No top-level `model` configured in opencorvus.jsonc. " +
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
