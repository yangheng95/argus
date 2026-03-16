import { OpencodeExecutor } from "./opencode"
import { ManagedCodingExecutor } from "./managed"
import type { CodingProvider, CodingToolInfo, ExecutorAdapter, ExecutorNameInfo } from "./contracts"
import { ExecutorNotConfiguredError } from "./contracts"

const base = () =>
  new Map<ExecutorNameInfo, ExecutorAdapter>([
    ["opencode", OpencodeExecutor],
  ])

const state = {
  items: base(),
}

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
      planning?: {
        spec: boolean
        plan: boolean
      }
    },
  ) {
    return register(name, ManagedCodingExecutor.create(provider, options))
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
