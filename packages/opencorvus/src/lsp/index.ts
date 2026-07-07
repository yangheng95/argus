import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { LSPClient } from "./client"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { LSPServer } from "./server"
import z from "zod"
import { Config } from "../config/config"
import { Instance, lazyInstanceState } from "../project/instance"
import { Flag } from "@/flag/flag"
import { entries, values as objectValues } from "@/util/object"

export namespace LSP {
  const log = Log.create({ service: "lsp" })
  let clientIdleTtlMs = Number.parseInt(process.env.OPENCORVUS_LSP_CLIENT_IDLE_TTL_MS ?? "600000", 10)
  let brokenTtlMs = Number.parseInt(process.env.OPENCORVUS_LSP_BROKEN_TTL_MS ?? "600000", 10)

  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
  }

  export function setRetentionForTest(input: { clientIdleTtlMs?: number; brokenTtlMs?: number }) {
    const previous = { clientIdleTtlMs, brokenTtlMs }
    if (input.clientIdleTtlMs !== undefined) clientIdleTtlMs = input.clientIdleTtlMs
    if (input.brokenTtlMs !== undefined) brokenTtlMs = input.brokenTtlMs
    return () => {
      clientIdleTtlMs = previous.clientIdleTtlMs
      brokenTtlMs = previous.brokenTtlMs
    }
  }

  export const Range = z
    .object({
      start: z.object({
        line: z.number(),
        character: z.number(),
      }),
      end: z.object({
        line: z.number(),
        character: z.number(),
      }),
    })
    .meta({
      ref: "Range",
    })
  export type Range = z.infer<typeof Range>

  export const Symbol = z
    .object({
      name: z.string(),
      kind: z.number(),
      location: z.object({
        uri: z.string(),
        range: Range,
      }),
    })
    .meta({
      ref: "Symbol",
    })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z
    .object({
      name: z.string(),
      detail: z.string().optional(),
      kind: z.number(),
      range: Range,
      selectionRange: Range,
    })
    .meta({
      ref: "DocumentSymbol",
    })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  const filterExperimentalServers = (servers: Record<string, LSPServer.Info>) => {
    if (Flag.OPENCORVUS_EXPERIMENTAL_LSP_TY) {
      // If experimental flag is enabled, disable pyright
      if (servers["pyright"]) {
        log.info("LSP server pyright is disabled because OPENCORVUS_EXPERIMENTAL_LSP_TY is enabled")
        delete servers["pyright"]
      }
    } else {
      // If experimental flag is disabled, disable ty
      if (servers["ty"]) {
        delete servers["ty"]
      }
    }
  }

  type State = {
    broken: Map<string, number>
    servers: Record<string, LSPServer.Info>
    clients: LSPClient.Info[]
    spawning: Map<string, Promise<LSPClient.Info | undefined>>
    disposed: boolean
  }

  const createState = (servers: Record<string, LSPServer.Info>, clients: LSPClient.Info[] = []): State => ({
    broken: new Map<string, number>(),
    servers,
    clients,
    spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
    disposed: false,
  })

  async function disposeClient(client: LSPClient.Info) {
    await client.shutdown().catch((error) => {
      log.warn("LSP client shutdown failed during dispose", {
        serverID: client.serverID,
        root: client.root,
        error: String(error),
      })
    })
  }

  async function disposeHandle(handle: LSPServer.Handle) {
    if (handle.dispose) {
      await handle.dispose()
      return
    }
    const owned = handle.process as typeof handle.process & { opencorvusDispose?: () => Promise<void> }
    if (owned.opencorvusDispose) {
      await owned.opencorvusDispose()
      return
    }
    handle.process.kill()
  }

  function markBroken(state: State, key: string) {
    state.broken.set(key, Date.now())
  }

  function pruneBroken(state: State, now: number) {
    if (!Number.isFinite(brokenTtlMs) || brokenTtlMs <= 0) return
    for (const [key, failedAt] of state.broken) {
      if (now - failedAt > brokenTtlMs) state.broken.delete(key)
    }
  }

  async function pruneIdleClients(state: State, now: number) {
    if (!Number.isFinite(clientIdleTtlMs) || clientIdleTtlMs <= 0) return
    const keep: LSPClient.Info[] = []
    const stale: LSPClient.Info[] = []
    for (const client of state.clients) {
      if (now - client.lastUsedAt > clientIdleTtlMs) stale.push(client)
      else keep.push(client)
    }
    if (stale.length === 0) return
    state.clients = keep
    await Promise.all(stale.map(disposeClient))
  }

  const state = lazyInstanceState(
    async () => {
      const clients: LSPClient.Info[] = []
      const servers: Record<string, LSPServer.Info> = {}
      const cfg = await Config.get()

      if (cfg.lsp === false) {
        log.info("all LSPs are disabled")
        return createState(servers, clients)
      }

      for (const server of LSPServer.builtInServers()) {
        servers[server.id] = server
      }

      filterExperimentalServers(servers)

      for (const [name, item] of entries((cfg.lsp ?? {}) as Exclude<NonNullable<Config.Info["lsp"]>, false>)) {
        const existing = servers[name]
        if (item.disabled) {
          log.info(`LSP server ${name} is disabled`)
          delete servers[name]
          continue
        }
        servers[name] = {
          ...existing,
          id: name,
          root: existing?.root ?? (async () => Instance.directory),
          extensions: item.extensions ?? existing?.extensions ?? [],
          spawn: async (root) => {
            return {
              process: LSPServer.spawnStdio(item.command[0], item.command.slice(1), {
                cwd: root,
                env: {
                  ...process.env,
                  ...item.env,
                },
              }),
              initialization: item.initialization,
            }
          },
        }
      }

      log.info("enabled LSP servers", {
        serverIds: objectValues(servers)
          .map((server) => server.id)
          .join(", "),
      })

      return createState(servers, clients)
    },
    async (state) => {
      state.disposed = true
      const clients = new Set<LSPClient.Info>(state.clients)
      const inflight = [...state.spawning.values()]
      const settled = await Promise.allSettled(inflight)
      for (const item of settled) {
        if (item.status === "fulfilled" && item.value) clients.add(item.value)
      }
      await Promise.all([...clients].map(disposeClient))
      state.clients.length = 0
      state.spawning.clear()
    },
  )

  export async function init() {
    return state()
  }

  export const Status = z
    .object({
      id: z.string(),
      name: z.string(),
      root: z.string(),
      status: z.union([z.literal("connected"), z.literal("error")]),
    })
    .meta({
      ref: "LSPStatus",
    })
  export type Status = z.infer<typeof Status>

  export async function status() {
    return state().then((x) => {
      const result: Status[] = []
      for (const client of x.clients) {
        result.push({
          id: client.serverID,
          name: x.servers[client.serverID].id,
          root: path.relative(Instance.directory, client.root),
          status: "connected",
        })
      }
      return result
    })
  }

  async function getClients(file: string) {
    const s = await state()
    if (s.disposed) return []
    const now = Date.now()
    pruneBroken(s, now)
    await pruneIdleClients(s, now)
    const extension = path.parse(file).ext || file
    const result: LSPClient.Info[] = []

    async function schedule(server: LSPServer.Info, root: string, key: string) {
      if (s.disposed) return undefined
      const handle = await server
        .spawn(root)
        .then((value) => {
          if (!value) markBroken(s, key)
          return value
        })
        .catch((err) => {
          markBroken(s, key)
          log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
          return undefined
        })

      if (!handle) return undefined
      if (s.disposed) {
        await disposeHandle(handle)
        return undefined
      }
      log.info("spawned lsp server", { serverID: server.id })

      const client = await LSPClient.create({
        serverID: server.id,
        server: handle,
        root,
      }).catch(async (err) => {
        markBroken(s, key)
        await disposeHandle(handle)
        log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
        return undefined
      })

      if (!client) {
        await disposeHandle(handle)
        return undefined
      }
      if (s.disposed) {
        await disposeClient(client)
        return undefined
      }

      const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (existing) {
        await disposeHandle(handle)
        return existing
      }

      s.clients.push(client)
      return client
    }

    for (const server of objectValues(s.servers)) {
      if (s.disposed) break
      if (server.extensions.length && !server.extensions.includes(extension)) continue

      const root = await server.root(file)
      if (!root) continue
      if (s.broken.has(root + server.id)) continue

      const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (match) {
        match.touch()
        result.push(match)
        continue
      }

      const inflight = s.spawning.get(root + server.id)
      if (inflight) {
        const client = await inflight
        if (!client) continue
        result.push(client)
        continue
      }

      const task = schedule(server, root, root + server.id)
      s.spawning.set(root + server.id, task)

      void task
        .finally(() => {
          if (s.spawning.get(root + server.id) === task) {
            s.spawning.delete(root + server.id)
          }
        })
        .catch((error) => {
          log.warn("lsp spawn cleanup failed", {
            serverID: server.id,
            error: error instanceof Error ? error.message : String(error),
          })
        })

      const client = await task
      if (!client) continue
      if (s.disposed) continue

      result.push(client)
      Bus.publish(Event.Updated, {})
    }

    return result
  }

  export async function hasClients(file: string) {
    const s = await state()
    pruneBroken(s, Date.now())
    const extension = path.parse(file).ext || file
    for (const server of objectValues(s.servers)) {
      if (server.extensions.length && !server.extensions.includes(extension)) continue
      const root = await server.root(file)
      if (!root) continue
      if (s.broken.has(root + server.id)) continue
      return true
    }
    return false
  }

  export async function touchFile(input: string, waitForDiagnostics?: boolean) {
    log.info("touching file", { file: input })
    const clients = await getClients(input)
    await Promise.all(
      clients.map(async (client) => {
        const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: input }) : Promise.resolve()
        await client.notify.open({ path: input })
        return wait
      }),
    ).catch((err) => {
      log.error("failed to touch file", { err, file: input })
    })
  }

  export async function diagnostics() {
    const results: Record<string, LSPClient.Diagnostic[]> = {}
    for (const result of await runAll(async (client) => client.diagnostics)) {
      for (const [path, diagnostics] of result.entries()) {
        const arr = results[path] || []
        arr.push(...diagnostics)
        results[path] = arr
      }
    }
    return results
  }

  export async function hover(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) => {
      return client.connection
        .sendRequest("textDocument/hover", {
          textDocument: {
            uri: pathToFileURL(input.file).href,
          },
          position: {
            line: input.line,
            character: input.character,
          },
        })
        .catch(() => null)
    })
  }

  enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
  }

  const kinds = [
    SymbolKind.Class,
    SymbolKind.Function,
    SymbolKind.Method,
    SymbolKind.Interface,
    SymbolKind.Variable,
    SymbolKind.Constant,
    SymbolKind.Struct,
    SymbolKind.Enum,
  ]

  export async function workspaceSymbol(query: string) {
    return runAll((client) =>
      client.connection
        .sendRequest("workspace/symbol", {
          query,
        })
        .then((result: any) => result.filter((x: LSP.Symbol) => kinds.includes(x.kind)))
        .then((result: any) => result.slice(0, 10))
        .catch(() => []),
    ).then((result) => result.flat() as LSP.Symbol[])
  }

  export async function documentSymbol(uri: string) {
    const file = fileURLToPath(uri)
    return run(file, (client) =>
      client.connection.sendRequest("textDocument/documentSymbol", {
        textDocument: {
          uri,
        },
      }),
    )
      .then((result) => result.flat() as (LSP.DocumentSymbol | LSP.Symbol)[])
      .then((result) => result.filter(Boolean))
  }

  export async function definition(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/definition", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => null),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function references(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/references", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
          context: { includeDeclaration: true },
        })
        .catch(() => []),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function implementation(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/implementation", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => null),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function prepareCallHierarchy(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => []),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function incomingCalls(input: { file: string; line: number; character: number }) {
    return run(input.file, async (client) => {
      const items = (await client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => [])) as any[]
      if (!items?.length) return []
      return client.connection.sendRequest("callHierarchy/incomingCalls", { item: items[0] }).catch(() => [])
    }).then((result) => result.flat().filter(Boolean))
  }

  export async function outgoingCalls(input: { file: string; line: number; character: number }) {
    return run(input.file, async (client) => {
      const items = (await client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => [])) as any[]
      if (!items?.length) return []
      return client.connection.sendRequest("callHierarchy/outgoingCalls", { item: items[0] }).catch(() => [])
    }).then((result) => result.flat().filter(Boolean))
  }

  async function runAll<T>(input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await state().then((x) => x.clients)
    const tasks = clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  async function run<T>(file: string, input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await getClients(file)
    const tasks = clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  export namespace Diagnostic {
    export function pretty(diagnostic: LSPClient.Diagnostic) {
      const severityMap = {
        1: "ERROR",
        2: "WARN",
        3: "INFO",
        4: "HINT",
      }

      const severity = severityMap[diagnostic.severity || 1]
      const line = diagnostic.range.start.line + 1
      const col = diagnostic.range.start.character + 1

      return `${severity} [${line}:${col}] ${diagnostic.message}`
    }
  }
}
