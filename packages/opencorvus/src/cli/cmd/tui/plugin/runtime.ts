// Copied from OpenCode's TUI plugin runtime and reduced to the internal-plugin path until
// OpenCode's external plugin loader/meta/install modules are copied into OpenCorvus.
import { runtimeModules as keymapRuntimeModules } from "@opentui/keymap/runtime-modules"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import type {
  TuiDispose,
  TuiPlugin,
  TuiPluginApi,
  TuiPluginInstallResult,
  TuiPluginMeta,
  TuiPluginModule,
  TuiPluginStatus,
  TuiSlotPlugin,
} from "@opencorvus-ai/plugin/tui"
import { TuiConfig } from "@/config/tui"
import { internalTuiPlugins, type InternalTuiPlugin } from "./internal"
import { setupSlots, Slot as View } from "./slots"
import type { HostPluginApi, HostSlots } from "./slots"
import { createCommandShim } from "./command-shim"

ensureRuntimePluginSupport({ additional: keymapRuntimeModules })

type PluginLoad = {
  spec: string
  target: string
  source: "internal"
  id: string
  module: TuiPluginModule
  plugin_root: string
}

type Api = HostPluginApi

type PluginScope = {
  lifecycle: TuiPluginApi["lifecycle"]
  track: (fn: (() => void) | undefined) => () => void
  dispose: () => Promise<void>
}

type PluginEntry = {
  id: string
  load: PluginLoad
  meta: TuiPluginMeta
  plugin: TuiPlugin
  enabled: boolean
  scope?: PluginScope
}

type RuntimeState = {
  directory: string
  api: Api
  dispose?: () => void
  slots: HostSlots
  plugins: PluginEntry[]
  plugins_by_id: Map<string, PluginEntry>
  dispose_timeout_ms: number
}

const DISPOSE_TIMEOUT_MS = 5000

const ScopedKeymapMethods = new Set<PropertyKey>([
  "acquireResource",
  "registerLayer",
  "registerLayerFields",
  "prependLayerBindingsTransformer",
  "appendLayerBindingsTransformer",
  "prependBindingTransformer",
  "appendBindingTransformer",
  "prependBindingParser",
  "appendBindingParser",
  "registerToken",
  "registerSequencePattern",
  "prependBindingExpander",
  "appendBindingExpander",
  "registerBindingFields",
  "registerCommandFields",
  "prependCommandTransformer",
  "appendCommandTransformer",
  "prependCommandResolver",
  "appendCommandResolver",
  "prependLayerAnalyzer",
  "appendLayerAnalyzer",
  "intercept",
  "on",
  "prependEventMatchResolver",
  "appendEventMatchResolver",
  "prependDisambiguationResolver",
  "appendDisambiguationResolver",
])

function fail(message: string, data: Record<string, unknown>) {
  if (!("error" in data)) {
    console.error(`[tui.plugin] ${message}`, data)
    return
  }

  const text = `${message}: ${errorMessage(data.error)}`
  const next = { ...data, error: errorData(data.error) }
  console.error(`[tui.plugin] ${text}`, next)
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function errorData(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return error
}

function createScopedKeymap(keymap: TuiPluginApi["keymap"], scope: PluginScope): TuiPluginApi["keymap"] {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(keymap, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== "function") return value
      if (cache.has(prop)) return cache.get(prop)
      const fn = ScopedKeymapMethods.has(prop)
        ? (...args: unknown[]) => {
            const dispose = (value as (...args: unknown[]) => unknown).apply(target, args)
            return scope.track(typeof dispose === "function" ? (dispose as () => void) : undefined)
          }
        : (...args: unknown[]) => (value as (...args: unknown[]) => unknown).apply(target, args)
      cache.set(prop, fn)
      return fn
    },
  })
}

function createScopedAttention(attention: TuiPluginApi["attention"], scope: PluginScope): TuiPluginApi["attention"] {
  return {
    notify(input) {
      return attention.notify(input)
    },
    soundboard: {
      registerPack(pack) {
        return scope.track(attention.soundboard.registerPack(pack))
      },
      activate(id, options) {
        return attention.soundboard.activate(id, options)
      },
      current() {
        return attention.soundboard.current()
      },
      list() {
        return attention.soundboard.list()
      },
    },
  }
}

function createScopedMode(mode: TuiPluginApi["mode"], scope: PluginScope): TuiPluginApi["mode"] {
  return {
    current() {
      return mode.current()
    },
    push(value) {
      return scope.track(mode.push(value))
    },
  }
}

type CleanupResult = { type: "ok" } | { type: "error"; error: unknown } | { type: "timeout" }

function runCleanup(fn: () => unknown, ms: number): Promise<CleanupResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ type: "timeout" })
    }, ms)

    Promise.resolve()
      .then(fn)
      .then(
        () => {
          resolve({ type: "ok" })
        },
        (error) => {
          resolve({ type: "error", error })
        },
      )
      .finally(() => {
        clearTimeout(timer)
      })
  })
}

function createMeta(entry: PluginLoad): TuiPluginMeta {
  const now = Date.now()
  return {
    state: "same",
    id: entry.id,
    source: entry.source,
    spec: entry.spec,
    target: entry.target,
    first_time: now,
    last_time: now,
    time_changed: now,
    load_count: 1,
    fingerprint: entry.target,
  }
}

function loadInternalPlugin(item: InternalTuiPlugin): PluginLoad {
  const spec = item.id
  const target = spec

  return {
    spec,
    target,
    source: "internal",
    id: item.id,
    module: item,
    plugin_root: process.cwd(),
  }
}

function createPluginScope(load: PluginLoad, id: string, disposeTimeoutMs: number) {
  const ctrl = new AbortController()
  let list: { key: symbol; fn: TuiDispose }[] = []
  let done = false

  const onDispose = (fn: TuiDispose) => {
    if (done) return () => {}
    const key = Symbol()
    list.push({ key, fn })
    let drop = false
    return () => {
      if (drop) return
      drop = true
      list = list.filter((x) => x.key !== key)
    }
  }

  const track = (fn: (() => void) | undefined) => {
    if (!fn) return () => {}
    let drop = false
    let off = () => {}
    const wrapped = () => {
      if (drop) return
      drop = true
      off()
      fn()
    }
    off = onDispose(wrapped)
    return wrapped
  }

  const lifecycle: TuiPluginApi["lifecycle"] = {
    signal: ctrl.signal,
    onDispose,
  }

  const dispose = async () => {
    if (done) return
    done = true
    ctrl.abort()
    const queue = [...list].reverse()
    list = []
    const until = Date.now() + disposeTimeoutMs
    for (const item of queue) {
      const left = until - Date.now()
      if (left <= 0) {
        fail("timed out cleaning up tui plugin", {
          path: load.spec,
          id,
          timeout: disposeTimeoutMs,
        })
        break
      }

      const out = await runCleanup(item.fn, left)
      if (out.type === "ok") continue
      if (out.type === "timeout") {
        fail("timed out cleaning up tui plugin", {
          path: load.spec,
          id,
          timeout: disposeTimeoutMs,
        })
        break
      }

      if (out.type === "error") {
        fail("failed to clean up tui plugin", {
          path: load.spec,
          id,
          error: out.error,
        })
      }
    }
  }

  return {
    lifecycle,
    track,
    dispose,
  }
}

function listPluginStatus(state: RuntimeState): TuiPluginStatus[] {
  return state.plugins.map((plugin) => ({
    id: plugin.id,
    source: plugin.meta.source,
    spec: plugin.meta.spec,
    target: plugin.meta.target,
    enabled: plugin.enabled,
    active: plugin.scope !== undefined,
  }))
}

async function deactivatePluginEntry(state: RuntimeState, plugin: PluginEntry) {
  plugin.enabled = false
  if (!plugin.scope) return true
  const scope = plugin.scope
  plugin.scope = undefined
  await scope.dispose()
  return true
}

async function activatePluginEntry(state: RuntimeState, plugin: PluginEntry) {
  plugin.enabled = true
  if (plugin.scope) return true

  const scope = createPluginScope(plugin.load, plugin.id, state.dispose_timeout_ms)
  const api = pluginApi(state, plugin, scope, plugin.id)
  const ok = await Promise.resolve()
    .then(async () => {
      await plugin.plugin(api, undefined, plugin.meta)
      return true
    })
    .catch((error) => {
      fail("failed to initialize tui plugin", {
        path: plugin.load.spec,
        id: plugin.id,
        error,
      })
      return false
    })

  if (!ok) {
    await scope.dispose()
    return false
  }

  if (!plugin.enabled) {
    await scope.dispose()
    return true
  }

  plugin.scope = scope
  return true
}

async function activatePluginById(state: RuntimeState | undefined, id: string) {
  if (!state) return false
  const plugin = state.plugins_by_id.get(id)
  if (!plugin) return false
  return activatePluginEntry(state, plugin)
}

async function deactivatePluginById(state: RuntimeState | undefined, id: string) {
  if (!state) return false
  const plugin = state.plugins_by_id.get(id)
  if (!plugin) return false
  return deactivatePluginEntry(state, plugin)
}

function pluginApi(runtime: RuntimeState, plugin: PluginEntry, scope: PluginScope, base: string): TuiPluginApi {
  const api = runtime.api
  const host = runtime.slots

  const route: TuiPluginApi["route"] = {
    register(list) {
      return scope.track(api.route.register(list))
    },
    navigate(name, params) {
      api.route.navigate(name, params)
    },
    get current() {
      return api.route.current
    },
  }

  const event: TuiPluginApi["event"] = {
    on(type, handler) {
      return scope.track(api.event.on(type, handler))
    },
  }

  const keymap = createScopedKeymap(api.keymap, scope)

  let count = 0

  const slots: TuiPluginApi["slots"] = {
    register(plugin: TuiSlotPlugin) {
      const id = count ? `${base}:${count}` : base
      count += 1
      scope.track(host.register({ ...(plugin as object), id } as never))
      return id
    },
  }

  return {
    app: api.app,
    attention: createScopedAttention(api.attention, scope),
    command: createCommandShim(keymap, api.ui.dialog, api.tuiConfig.keybinds),
    keys: api.keys,
    keymap,
    mode: createScopedMode(api.mode, scope),
    route,
    ui: api.ui,
    tuiConfig: api.tuiConfig,
    kv: api.kv,
    state: api.state,
    theme: api.theme,
    get client() {
      return api.client
    },
    event,
    renderer: api.renderer,
    slots,
    plugins: {
      list() {
        return listPluginStatus(runtime)
      },
      activate(id) {
        return activatePluginById(runtime, id)
      },
      deactivate(id) {
        return deactivatePluginById(runtime, id)
      },
      async add() {
        return false
      },
      async install(_spec): Promise<TuiPluginInstallResult> {
        return {
          ok: false,
          message: "External TUI plugin install requires the OpenCode loader copy round.",
        }
      },
    },
    lifecycle: scope.lifecycle,
  }
}

function addPluginEntry(state: RuntimeState, plugin: PluginEntry) {
  if (state.plugins_by_id.has(plugin.id)) {
    fail("duplicate tui plugin id", {
      id: plugin.id,
      path: plugin.load.spec,
    })
    return false
  }

  state.plugins_by_id.set(plugin.id, plugin)
  state.plugins.push(plugin)
  return true
}

let dir = ""
let loaded: Promise<void> | undefined
let runtime: RuntimeState | undefined
export const Slot = View

export async function init(input: {
  api: HostPluginApi
  config: TuiConfig.Resolved
  dispose?: () => void
  disposeTimeoutMs?: number
  internalPlugins?: InternalTuiPlugin[]
}) {
  const cwd = process.cwd()
  if (loaded) {
    if (dir !== cwd) {
      throw new Error(`TuiPluginRuntime.init() called with a different working directory. expected=${dir} got=${cwd}`)
    }
    return loaded
  }

  dir = cwd
  loaded = load(input)
  return loaded
}

export function list() {
  if (!runtime) return []
  return listPluginStatus(runtime)
}

export async function activatePlugin(id: string) {
  return activatePluginById(runtime, id)
}

export async function deactivatePlugin(id: string) {
  return deactivatePluginById(runtime, id)
}

export async function addPlugin(_spec: string) {
  return false
}

export async function installPlugin(_spec: string, _options?: { global?: boolean }): Promise<TuiPluginInstallResult> {
  return {
    ok: false,
    message: "External TUI plugin install requires the OpenCode loader copy round.",
  }
}

export async function dispose() {
  const task = loaded
  loaded = undefined
  dir = ""
  if (task) await task
  const state = runtime
  runtime = undefined
  if (!state) return
  const queue = [...state.plugins].reverse()
  for (const plugin of queue) {
    await deactivatePluginEntry(state, plugin)
  }
  state.dispose?.()
}

async function load(input: {
  api: Api
  config: TuiConfig.Resolved
  dispose?: () => void
  disposeTimeoutMs?: number
  internalPlugins?: InternalTuiPlugin[]
}) {
  const { api } = input
  const cwd = process.cwd()
  const slots = setupSlots(api)
  const next: RuntimeState = {
    directory: cwd,
    api,
    dispose: input.dispose,
    slots,
    plugins: [],
    plugins_by_id: new Map(),
    dispose_timeout_ms: input.disposeTimeoutMs ?? DISPOSE_TIMEOUT_MS,
  }
  runtime = next
  try {
    const internal = input.internalPlugins ?? internalTuiPlugins()
    for (const item of internal) {
      const entry = loadInternalPlugin(item)
      addPluginEntry(next, {
        id: entry.id,
        load: entry,
        meta: createMeta(entry),
        plugin: entry.module.tui,
        enabled: item.enabled ?? true,
      })
    }

    for (const plugin of next.plugins) {
      if (!plugin.enabled) continue
      await activatePluginEntry(next, plugin)
    }
  } catch (error) {
    fail("failed to load tui plugins", { directory: cwd, error })
  }
}

export * as TuiPluginRuntime from "./runtime"
