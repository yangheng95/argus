/**
 * Provider-side LLM helpers reused by `session/llm.ts`.
 *
 * As of Phase E of specs/new-arch/2026-04-28-structured-output-systemic-fix.md
 * this module no longer exposes its own `streamText` entry point. The earlier
 * `ProviderLLM.stream()` was a parallel agent-level stream wrapper that
 * carried its own `toolChoice` typedef (limited to the string forms
 * `auto / required / none`), creating a dual-source risk vs `LLM.stream`'s
 * widened `{ type: "tool", toolName: string }` form. The function had
 * already been migrated away from by every agent (task-agent, decompose,
 * architect, planner — all now route through `SessionPrompt.prompt` →
 * `SessionLoop` → `LLM.stream`), so it was dead code that could only drift
 * out of sync with the canonical session stream. Rule 2 (delete旧) +
 * rule 22 (no dual sources) → remove.
 *
 * What this module still owns:
 *
 *   - `wrapModel(language, model, options)` — wraps a `LanguageModelV3`
 *     with the message-transform middleware that normalises messages for
 *     the target provider (Anthropic empty-content filtering, modality
 *     pruning, cache markers, …). Used by `session/llm.ts:241`.
 *
 *   - `baseHeaders(model, stickyKey?)` — default request headers including
 *     LiteLLM-fronted gateway sticky-routing for hexin. Used by
 *     `session/llm.ts:170`.
 */
import { wrapLanguageModel } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Provider } from "./provider"
import { ProviderTransform } from "./transform"
import { applyVendorHeaders } from "./vendor-headers"

export namespace ProviderLLM {
  /**
   * Wrap a LanguageModelV3 with the message-transform middleware that
   * normalizes messages for the target provider (Anthropic empty-content
   * filtering, unsupported modality removal, cache markers, etc.).
   */
  export function wrapModel(
    language: Awaited<ReturnType<typeof Provider.getLanguage>>,
    model: Provider.Model,
    options: Record<string, any>,
  ) {
    if (!isLanguageModelV3(language)) return language
    return wrapLanguageModel({
      model: language,
      middleware: [
        {
          specificationVersion: "v3",
          async transformParams(args: any) {
            if (args.type === "stream") {
              args.params.prompt = ProviderTransform.message(
                args.params.prompt,
                model,
                options,
              )
            }
            return args.params
          },
        },
      ],
    })
  }

  function isLanguageModelV3(language: Awaited<ReturnType<typeof Provider.getLanguage>>): language is LanguageModelV3 {
    return typeof language === "object" && language !== null && language.specificationVersion === "v3"
  }

  /**
   * Compute default request headers for a model.
   * Does NOT include opencorvus project/session headers — those are session-specific.
   *
   * @param stickyKey optional stable identifier used for upstream-key sticky
   *   routing at LiteLLM-fronted gateways (currently only hexin). Pass
   *   sessionID for session calls, taskID for agent calls.
   */
  export function baseHeaders(model: Provider.Model, stickyKey?: string): Record<string, string> {
    const headers: Record<string, string> = { ...model.headers }
    applyVendorHeaders(headers, model, stickyKey)
    return headers
  }
}
