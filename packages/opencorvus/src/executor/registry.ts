import { OpencodeExecutor } from "./opencode"
import { ManagedCodingExecutor } from "./managed"
import type { CodingProvider, CodingToolInfo, ExecutorAdapter, ExecutorNameInfo } from "./contract"
import { ExecutorNotConfiguredError } from "./contract"

const base = () =>
  new Map<ExecutorNameInfo, ExecutorAdapter>([
    ["opencode", OpencodeExecutor],
  ])

const state = {
  items: base(),
}

const providerRegistry = new Map<string, { provider: CodingProvider; options: Record<string, any> }>()

export namespace ExecutorRegistry {
  function get(name: ExecutorNameInfo): ExecutorAdapter | undefined {
    if (name === "opencode") return state.items.get(name) ?? OpencodeExecutor
    return state.items.get(name)
  }

  export function require(name: ExecutorNameInfo) {
    const value = get(name)
    if (value) return value
    throw new ExecutorNotConfiguredError({
      executor: name,
      message: `executor not configured: ${name}`,
    })
  }

  export function register(name: ExecutorNameInfo, executor: ExecutorAdapter) {
    state.items.set(name, executor)
    return executor
  }

  export function registerCoding(
    name: Exclude<ExecutorNameInfo, "opencode">,
    provider: CodingProvider,
    options: {
      model?: string | (() => string | undefined)
      cwd?: string | (() => string | undefined)
      system?: string | (() => string | undefined)
      maxTurns?: number | (() => number | undefined)
      tools?: CodingToolInfo[] | (() => CodingToolInfo[] | undefined)
    },
  ) {
    // Store provider + options so createInstance() can spawn fresh adapters
    providerRegistry.set(name, { provider, options })
    return register(name, ManagedCodingExecutor.create(provider, options))
  }

  /**
   * Create a fresh, independent executor adapter instance.
   * Used by per-goal dispatch so each goal gets its own state.
   * Falls back to the shared singleton if no provider is registered.
   */
  export function createInstance(name: ExecutorNameInfo): ExecutorAdapter {
    const entry = providerRegistry.get(name as any)
    if (entry) return ManagedCodingExecutor.create(entry.provider, entry.options)
    return require(name)
  }

  export function reset() {
    state.items = base()
  }

  export function has(name: ExecutorNameInfo) {
    return !!get(name)
  }

  export function list() {
    return [...state.items.keys()]
  }
}
