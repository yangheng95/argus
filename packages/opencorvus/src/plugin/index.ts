import type { Hooks, PluginInput, PluginServiceRegistration, Plugin as PluginInstance } from "@opencorvus-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpenCorvusClient } from "@opencorvus-ai/sdk"
import { BunProc } from "../bun"
import { Instance, lazyInstanceState } from "../project/instance"
import { Session } from "../session"
import { NamedError } from "@opencorvus-ai/util/error"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "@gitlab/opencode-gitlab-auth"
import { IN_PROCESS_BASE_URL, createInProcessFetch } from "@/server/in-process-client"
import { runHookIsolated } from "./isolate"
import z from "zod"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  export const PluginServiceNotFoundError = NamedError.create(
    "PluginServiceNotFoundError",
    z.object({
      message: z.string(),
      serviceID: z.string(),
    }),
  )

  export const PluginServiceRegistrationError = NamedError.create(
    "PluginServiceRegistrationError",
    z.object({
      message: z.string(),
      serviceID: z.string().optional(),
      specifier: z.string().optional(),
    }),
  )

  // ID = identifier. Duplicate plugin service identifiers would make route
  // ownership ambiguous, so startup keeps this as a hard registration error.
  export const PluginServiceDuplicateIDError = NamedError.create(
    "PluginServiceDuplicateIDError",
    z.object({
      message: z.string(),
      serviceID: z.string(),
      firstSpecifier: z.string(),
      secondSpecifier: z.string(),
    }),
  )

  export type PluginServiceInfo = PluginServiceRegistration & {
    specifier: string
  }

  type PluginLoadDiagnostic = {
    specifier: string
    message: string
  }

  // Built-in plugins that are directly imported (not installed from npm)
  // GitlabAuthPlugin is compiled against an older @opencode-ai/plugin version whose
  // OpencodeClient type is a strict subset of the current one — safe to cast.
  const INTERNAL_PLUGINS: PluginInstance[] = [GitlabAuthPlugin as unknown as PluginInstance]

  const state = lazyInstanceState(async () => {
    const client = createOpenCorvusClient({
      baseUrl: IN_PROCESS_BASE_URL,
      directory: Instance.directory,
      fetch: createInProcessFetch(),
    })
    const config = await Config.get()
    const hooks: Array<{ specifier: string; hook: Hooks }> = []
    const diagnostics: PluginLoadDiagnostic[] = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: new URL(IN_PROCESS_BASE_URL),
      $: Bun.$,
    }

    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const specifier = `internal:${plugin.name || "anonymous"}`
      const init = await plugin(input).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        diagnostics.push({ specifier, message })
        log.error("failed to load internal plugin", { name: plugin.name, error: err })
      })
      if (init) hooks.push({ specifier, hook: init })
    }

    let plugins = config.plugin ?? []
    if (plugins.length) await Config.waitForDependencies()

    for (let plugin of plugins) {
      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        plugin = await BunProc.install(pkg, version).catch((err) => {
          const cause = err instanceof Error ? err.cause : err
          const detail = cause instanceof Error ? cause.message : String(cause ?? err)
          log.error("failed to install plugin", { pkg, version, error: detail })
          diagnostics.push({
            specifier: plugin,
            message: `Failed to install plugin ${pkg}@${version}: ${detail}`,
          })
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to install plugin ${pkg}@${version}: ${detail}`,
            }).toObject(),
          })
          return ""
        })
        if (!plugin) continue
      }
      // Prevent duplicate initialization when plugins export the same function
      // as both a named export and default export (e.g., `export const X` and `export default X`).
      // Object.entries(mod) would return both entries pointing to the same function reference.
      await import(plugin)
        .then(async (mod) => {
          const seen = new Set<PluginInstance>()
          for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
            if (seen.has(fn)) continue
            seen.add(fn)
            hooks.push({ specifier: plugin, hook: await fn(input) })
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          diagnostics.push({ specifier: plugin, message })
          log.error("failed to load plugin", { path: plugin, error: message })
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to load plugin ${plugin}: ${message}`,
            }).toObject(),
          })
        })
    }

    return {
      hooks,
      input,
      diagnostics,
      services: undefined as Promise<{
        services: Map<string, PluginServiceInfo>
        diagnostics: PluginLoadDiagnostic[]
      }> | undefined,
    }
  })

  function registrationList(result: PluginServiceRegistration | PluginServiceRegistration[] | void) {
    if (!result) return []
    return Array.isArray(result) ? result : [result]
  }

  export async function services() {
    const current = await state()
    current.services ??= (async () => {
      const services = new Map<string, PluginServiceInfo>()
      const diagnostics = [...current.diagnostics]
      for (const entry of current.hooks) {
        if (!entry.hook.service) continue
        let registrations: PluginServiceRegistration[]
        try {
          registrations = registrationList(await entry.hook.service())
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          diagnostics.push({ specifier: entry.specifier, message })
          continue
        }
        for (const registration of registrations) {
          const existing = services.get(registration.id)
          if (existing) {
            const error = new PluginServiceDuplicateIDError({
              message: `Plugin service ${registration.id} is registered by both ${existing.specifier} and ${entry.specifier}`,
              serviceID: registration.id,
              firstSpecifier: existing.specifier,
              secondSpecifier: entry.specifier,
            })
            diagnostics.push({ specifier: entry.specifier, message: error.message })
            throw error
          }
          services.set(registration.id, { ...registration, specifier: entry.specifier })
        }
      }
      return { services, diagnostics }
    })()
    return current.services
  }

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool" | "service">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const entry of await state().then((x) => x.hooks)) {
      const fn = entry.hook[name]
      if (!fn) continue
      // audit-2026-04-29 W2-V19 — runHookIsolated catches throws
      // and rejecting promises so a 3rd-party plugin can't kill
      // the session lifecycle that called us. The previous
      // `@ts-expect-error` covered a generic-typing mismatch on
      // the direct `fn(input, output)` call; the helper takes
      // `args: any[]` so the cast lives at the boundary.
      await runHookIsolated(name, fn as unknown as (...a: any[]) => any, [input, output])
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks.map((entry) => entry.hook))
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const entry of hooks) {
      // audit-2026-04-29 W2-V19 — pre-fix a plugin's `config` hook
      // throwing here aborted Plugin.init, which is awaited from
      // session bootstrap; the entire session became unreachable.
      await runHookIsolated("config", entry.hook.config, [config])
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const entry of hooks) {
        // audit-2026-04-29 W2-V19 — pre-fix the optional-chained
        // call could surface as an UNHANDLED PROMISE REJECTION when
        // the plugin's event handler was async and rejected.
        await runHookIsolated("event", entry.hook["event"], [{ event: input }])
      }
    })
  }
}
