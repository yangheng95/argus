/**
 * Vendor-specific HTTP header rules.
 *
 * Same registry pattern as provider/vendor-messages.ts: per-vendor quirks
 * live here as data-driven rules, not as branches inside ProviderLLM. Adding
 * a new vendor's header convention means appending one entry.
 */
import { Installation } from "../installation"
import type { Provider } from "./provider"

interface HeaderRule {
  tag: string
  match: (model: Provider.Model) => boolean
  apply: (headers: Record<string, string>, model: Provider.Model, stickyKey?: string) => void
}

const HEADER_RULES: HeaderRule[] = [
  {
    tag: "user-agent-except-anthropic",
    // Anthropic's SDK sets its own User-Agent; don't override.
    match: (m) => m.providerID !== "anthropic",
    apply: (h) => {
      h["User-Agent"] = `opencorvus/${Installation.VERSION}`
    },
  },
  {
    tag: "hexin-sticky-x-user",
    // The hexin LiteLLM gateway hashes `x-user` for sticky upstream-key
    // routing. Without it, round-robin lands each request on a cold
    // Anthropic cache, paying cache-creation (~1.25× input) every time.
    // Empirically took claude-sonnet-4-6 hit ratio from ~60% to 100%.
    // Scoped to hexin only so other openai-compatible providers aren't
    // affected.
    match: (m) => m.providerID === "hexin",
    apply: (h, _m, stickyKey) => {
      if (stickyKey) h["x-user"] = stickyKey
    },
  },
]

export function applyVendorHeaders(headers: Record<string, string>, model: Provider.Model, stickyKey?: string): void {
  for (const rule of HEADER_RULES) {
    if (rule.match(model)) rule.apply(headers, model, stickyKey)
  }
}
