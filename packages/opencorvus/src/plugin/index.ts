import type {
  Hooks,
  PluginInput,
  PluginResource,
  PluginResourceManifestEntry,
  PluginResources,
  PluginServiceRegistration,
  Plugin as PluginInstance,
  PluginTaskArtifact,
  PluginTaskArtifactCreateInput,
  PluginTaskArtifactLookupInput,
} from "@opencorvus-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Instance, lazyInstanceState } from "../project/instance"
import { Session } from "../session"
import { NamedError } from "@opencorvus-ai/util/error"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "@gitlab/opencode-gitlab-auth"
import { IN_PROCESS_BASE_URL, createInProcessFetch } from "@/server/in-process-client"
import { runHookIsolated } from "./isolate"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { and, desc, eq } from "drizzle-orm"
import z from "zod"
import { Database } from "@/storage/db"
import { EngineArtifactTable, type EngineArtifactKind } from "@/engine/engine.sql"
import { Identifier } from "@/id/id"
import { requireTask } from "@/engine/store"

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
    serviceID?: string
    message: string
  }

  const PluginManifest = z.object({
    packageSpecifier: z.string().min(1),
    serviceID: z.string().min(1),
    backendExport: z.string().min(1),
    overlayExport: z.string().min(1),
    resources: z.array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(["worker", "asset", "runtime"]),
        path: z.string().min(1).optional(),
        paths: z
          .object({
            win32: z.string().min(1).optional(),
            linux: z.string().min(1).optional(),
            darwin: z.string().min(1).optional(),
          })
          .optional(),
      }),
    ),
  })

  // Built-in plugins that are directly imported (not installed from npm)
  // GitlabAuthPlugin is compiled against an older @opencode-ai/plugin version whose
  // OpenCorvusClient type is a strict subset of the current one; safe to cast.
  const INTERNAL_PLUGINS: PluginInstance[] = [GitlabAuthPlugin as unknown as PluginInstance]

  function pluginTaskArtifactFromRow(row: typeof EngineArtifactTable.$inferSelect): PluginTaskArtifact {
    return {
      id: row.id,
      taskID: row.task_id,
      kind: row.kind,
      label: row.label,
      payload: row.payload ?? {},
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  function createTaskArtifacts(): PluginInput["taskArtifacts"] {
    return {
      async create(input: PluginTaskArtifactCreateInput): Promise<PluginTaskArtifact> {
        requireTask(input.taskID)
        const now = Date.now()
        const id = Identifier.ascending("artifact")
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id,
              task_id: input.taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: input.kind as EngineArtifactKind,
              label: input.label,
              payload: input.payload,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        return {
          id,
          taskID: input.taskID,
          kind: input.kind,
          label: input.label,
          payload: input.payload,
          timeCreated: now,
          timeUpdated: now,
        }
      },
      async latest(input: PluginTaskArtifactLookupInput): Promise<PluginTaskArtifact | undefined> {
        requireTask(input.taskID)
        const clauses = [
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.kind, input.kind as EngineArtifactKind),
        ]
        if (input.label) clauses.push(eq(EngineArtifactTable.label, input.label))
        const row = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(...clauses))
            .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
            .limit(1)
            .get(),
        )
        return row ? pluginTaskArtifactFromRow(row) : undefined
      },
      async get(input: PluginTaskArtifactLookupInput & { id: string }): Promise<PluginTaskArtifact | undefined> {
        requireTask(input.taskID)
        const row = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(
                eq(EngineArtifactTable.task_id, input.taskID),
                eq(EngineArtifactTable.kind, input.kind as EngineArtifactKind),
                eq(EngineArtifactTable.id, input.id),
              ),
            )
            .limit(1)
            .get(),
        )
        if (!row) return undefined
        if (input.label && row.label !== input.label) return undefined
        return pluginTaskArtifactFromRow(row)
      },
    }
  }

  function emptyResources(): PluginResources {
    return {
      all: () => [],
      get(id) {
        throw new Error(`Plugin resource not available: ${id}`)
      },
    }
  }

  function pluginManifestPath(plugin: string) {
    return plugin.startsWith("file://") ? fileURLToPath(plugin) : plugin
  }

  function pluginManifestResourceRoot(manifestPath: string) {
    const segments = path.resolve(manifestPath).split(path.sep)
    const pluginSegment = segments.lastIndexOf("plugins")
    if (pluginSegment > 0) return segments.slice(0, pluginSegment).join(path.sep)
    return path.dirname(manifestPath)
  }

  function resourceManifestPath(resource: PluginResourceManifestEntry) {
    const osPath = resource.paths?.[process.platform as "win32" | "linux" | "darwin"]
    const selected = osPath ?? resource.path
    if (!selected) throw new Error(`Plugin resource ${resource.id} has no path for ${process.platform}`)
    return selected
  }

  function createPluginResources(manifestPath: string, resources: PluginResourceManifestEntry[]): PluginResources {
    const root = pluginManifestResourceRoot(manifestPath)
    const resolved = resources.map((resource): PluginResource => {
      const selectedPath = resourceManifestPath(resource)
      return {
        id: resource.id,
        kind: resource.kind,
        path: selectedPath,
        absolutePath: path.resolve(root, selectedPath),
      }
    })
    return {
      all: () => [...resolved],
      get(id) {
        const resource = resolved.find((item) => item.id === id)
        if (!resource) throw new Error(`Plugin resource not available: ${id}`)
        return resource
      },
    }
  }

  const state = lazyInstanceState(async () => {
    const { createOpenCorvusClient } = await import("@opencorvus-ai/sdk")
    const client = createOpenCorvusClient({
      baseUrl: IN_PROCESS_BASE_URL,
      directory: Instance.directory,
      fetch: createInProcessFetch(),
    })
    const config = await Config.get()
    const hooks: Array<{ specifier: string; serviceID?: string; hook: Hooks }> = []
    const diagnostics: PluginLoadDiagnostic[] = []
    const baseInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: new URL(IN_PROCESS_BASE_URL),
      $: Bun.$,
      taskArtifacts: createTaskArtifacts(),
    }

    function pluginInput(resources: PluginResources = emptyResources()): PluginInput {
      return {
        ...baseInput,
        resources,
      }
    }

    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const specifier = `internal:${plugin.name || "anonymous"}`
      const init = await plugin(pluginInput()).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        diagnostics.push({ specifier, message })
        log.error("failed to load internal plugin", { name: plugin.name, error: err })
      })
      if (init) hooks.push({ specifier, hook: init })
    }

    function manifestModuleSpecifier(manifest: z.infer<typeof PluginManifest>) {
      if (manifest.backendExport.startsWith("./")) {
        return `${manifest.packageSpecifier}/${manifest.backendExport.slice(2)}`
      }
      if (manifest.backendExport.startsWith("/")) {
        return `${manifest.packageSpecifier}${manifest.backendExport}`
      }
      return manifest.backendExport
    }

    async function loadPluginModule(
      plugin: string,
      diagnosticSpecifier = plugin,
      serviceID?: string,
      resources = emptyResources(),
    ) {
      await import(plugin)
        .then(async (mod) => {
          const seen = new Set<PluginInstance>()
          for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
            if (seen.has(fn)) continue
            seen.add(fn)
            hooks.push({ specifier: diagnosticSpecifier, serviceID, hook: await fn(pluginInput(resources)) })
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          diagnostics.push({ specifier: diagnosticSpecifier, serviceID, message })
          log.error("failed to load plugin", { path: diagnosticSpecifier, error: message })
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to load plugin ${diagnosticSpecifier}: ${message}`,
            }).toObject(),
          })
        })
    }

    async function loadPluginSpecifier(plugin: string) {
      if (plugin.endsWith(".json") || plugin.endsWith(".jsonc")) {
        try {
          const manifestPath = pluginManifestPath(plugin)
          const raw = await readFile(manifestPath, "utf8")
          const manifest = PluginManifest.parse(JSON.parse(raw))
          const backend = manifestModuleSpecifier(manifest)
          const resources = createPluginResources(manifestPath, manifest.resources)
          log.info("loading plugin manifest", {
            path: plugin,
            packageSpecifier: manifest.packageSpecifier,
            backendExport: manifest.backendExport,
            serviceID: manifest.serviceID,
          })
          await loadPluginModule(backend, plugin, manifest.serviceID, resources)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          diagnostics.push({ specifier: plugin, message })
          log.error("failed to load plugin manifest", { path: plugin, error: message })
        }
        return
      }

      await loadPluginModule(plugin)
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
      await loadPluginSpecifier(plugin)
    }

    return {
      hooks,
      input: pluginInput(),
      diagnostics,
      services: undefined as
        | Promise<{
            services: Map<string, PluginServiceInfo>
            diagnostics: PluginLoadDiagnostic[]
          }>
        | undefined,
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
          diagnostics.push({ specifier: entry.specifier, serviceID: entry.serviceID, message })
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
            diagnostics.push({ specifier: entry.specifier, serviceID: registration.id, message: error.message })
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
