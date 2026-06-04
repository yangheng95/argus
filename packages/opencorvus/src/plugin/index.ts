import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencorvus-ai/plugin"
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

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

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
    const hooks: Hooks[] = []
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
      const init = await plugin(input).catch((err) => {
        log.error("failed to load internal plugin", { name: plugin.name, error: err })
      })
      if (init) hooks.push(init)
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
            hooks.push(await fn(input))
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
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
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
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
    return state().then((x) => x.hooks)
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const hook of hooks) {
      // audit-2026-04-29 W2-V19 — pre-fix a plugin's `config` hook
      // throwing here aborted Plugin.init, which is awaited from
      // session bootstrap; the entire session became unreachable.
      await runHookIsolated("config", hook.config, [config])
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        // audit-2026-04-29 W2-V19 — pre-fix the optional-chained
        // call could surface as an UNHANDLED PROMISE REJECTION when
        // the plugin's event handler was async and rejected.
        await runHookIsolated("event", hook["event"], [{ event: input }])
      }
    })
  }
}
