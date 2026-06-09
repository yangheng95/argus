import { OpencorvusExecutor } from "./opencorvus"
import { ManagedCodingExecutor } from "./managed"
import type { CodingProvider, CodingProviderOptions, ExecutorAdapter, ExecutorNameInfo } from "./contract"
import { ExecutorNotConfiguredError } from "./contract"

const base = () => new Map<ExecutorNameInfo, ExecutorAdapter>([["opencorvus", OpencorvusExecutor]])

const state = {
  items: base(),
}

const providerRegistry = new Map<string, { provider: CodingProvider; options: CodingProviderOptions }>()

export namespace ExecutorRegistry {
  function get(name: ExecutorNameInfo): ExecutorAdapter | undefined {
    if (name === "opencorvus") return state.items.get(name) ?? OpencorvusExecutor
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
    name: Exclude<ExecutorNameInfo, "opencorvus">,
    provider: CodingProvider,
    options: CodingProviderOptions,
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

  /**
   * Returns the registered CodingProvider together with the dynamic options
   * that feed model/system/maxTurns/tools into provider.run(). Direct callers
   * such as BuildAgent must use this rather than the provider alone; otherwise
   * the external executor loses its OpenCorvus tool surface.
   */
  export function requireCoding(name: Exclude<ExecutorNameInfo, "opencorvus">) {
    const entry = providerRegistry.get(name)
    if (!entry) {
      throw new ExecutorNotConfiguredError({
        executor: name,
        message: `coding provider not registered: ${name}`,
      })
    }
    return entry
  }

  export function reset() {
    state.items = base()
    providerRegistry.clear()
  }

  export function has(name: ExecutorNameInfo) {
    return !!get(name)
  }

  export function list() {
    return [...state.items.keys()]
  }
}
