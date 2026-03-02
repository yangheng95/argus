import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { Event } from "@opencorvus-ai/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import * as prompts from "@clack/prompts"
import { ModelsDev } from "@/provider/models"
import { Auth } from "@/auth"

declare global {
  const OPENCORVUS_WORKER_PATH: string
}

const PROVIDER_PRIORITY: Record<string, number> = {
  anthropic: 0,
  openai: 1,
  google: 2,
  openrouter: 3,
  "amazon-bedrock": 4,
}

async function promptProviderSelection(): Promise<void> {
  const database = await ModelsDev.get()
  const existingAuth = await Auth.all()

  // Check which providers already have credentials (env var or auth.json)
  const configured: string[] = []
  for (const [id, provider] of Object.entries(database)) {
    const hasEnv = provider.env.some((e) => process.env[e])
    const hasAuth = !!existingAuth[id]
    if (hasEnv || hasAuth) configured.push(id)
  }

  const configuredHint = configured.length > 0 ? ` [${configured.join(", ")}]` : ""

  prompts.intro("Provider Configuration")

  if (configured.length > 0) {
    prompts.log.info(`Currently configured:${configuredHint}`)
  }

  const options = Object.values(database)
    .filter((p) => p.env.length > 0)
    .sort((a, b) => (PROVIDER_PRIORITY[a.id] ?? 99) - (PROVIDER_PRIORITY[b.id] ?? 99))
    .map((p) => ({
      label: p.name + (configured.includes(p.id) ? UI.Style.TEXT_DIM + " (configured)" : ""),
      value: p.id,
      hint: p.env[0],
    }))

  const provider = await prompts.select({
    message: "Select LLM provider (Ctrl+C to skip)",
    options: [{ label: "Skip - use existing config", value: "__skip__" }, ...options],
  })

  if (prompts.isCancel(provider) || provider === "__skip__") {
    prompts.outro("Using existing configuration")
    return
  }

  const providerInfo = database[provider]
  if (!providerInfo) return

  const key = await prompts.password({
    message: `Enter API key for ${providerInfo.name}`,
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })

  if (prompts.isCancel(key)) {
    prompts.outro("Using existing configuration")
    return
  }

  // Set env vars so the worker process inherits them
  for (const envVar of providerInfo.env) {
    process.env[envVar] = key
  }

  // Ask for model ID
  const model = await prompts.text({
    message: `Model for ${providerInfo.name}`,
    placeholder: `${provider}/model-name`,
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })

  if (prompts.isCancel(model)) {
    prompts.outro("Using existing configuration")
    return
  }

  // Persist to auth.json for future sessions
  await Auth.set(provider, { type: "api", key })

  prompts.outro(`${providerInfo.name} configured (env: ${providerInfo.env.join(", ")}, model: ${model})`)
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    on: (handler) => client.on<Event>("event", handler),
  }
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencorvus tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start opencorvus in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => {
    if (args.fork && !args.continue && !args.session) {
      UI.error("--fork requires --continue or --session")
      process.exitCode = 1
      return
    }

    // Show provider selection before Worker spawn so env vars are inherited.
    try {
      await promptProviderSelection()
    } catch {
      // Prompt library failure (e.g. non-interactive env) — skip silently
    }

    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()

      // Resolve relative paths against PWD to preserve behavior when using --cwd flag
      const baseCwd = process.env.PWD ?? process.cwd()
      const cwd = args.project ? path.resolve(baseCwd, args.project) : process.cwd()
      const localWorker = new URL("./worker.ts", import.meta.url)
      const distWorker = new URL("./cli/cmd/tui/worker.js", import.meta.url)
      const workerPath = await iife(async () => {
        if (typeof OPENCORVUS_WORKER_PATH !== "undefined") return OPENCORVUS_WORKER_PATH
        if (await Filesystem.exists(fileURLToPath(distWorker))) return distWorker
        return localWorker
      })
      try {
        process.chdir(cwd)
      } catch (e) {
        UI.error("Failed to change directory to " + cwd)
        return
      }

      const worker = new Worker(workerPath, {
        env: Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      })
      worker.onerror = (e) => {
        Log.Default.error(e)
      }
      const client = Rpc.client<typeof rpc>(worker)
      process.on("uncaughtException", (e) => {
        Log.Default.error(e)
      })
      process.on("unhandledRejection", (e) => {
        Log.Default.error(e)
      })
      process.on("SIGUSR2", async () => {
        await client.call("reload", undefined)
      })

      const prompt = await iife(async () => {
        const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
        if (!args.prompt) return piped
        return piped ? piped + "\n" + args.prompt : args.prompt
      })
      const config = await Instance.provide({
        directory: cwd,
        fn: () => TuiConfig.get(),
      })

      // Check if server should be started (port or hostname explicitly set in CLI or config)
      const networkOpts = await resolveNetworkOptions(args)
      const shouldStartServer =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        networkOpts.mdns ||
        networkOpts.port !== 0 ||
        networkOpts.hostname !== "127.0.0.1"

      let url: string
      let customFetch: typeof fetch | undefined
      let events: EventSource | undefined

      if (shouldStartServer) {
        // Start HTTP server for external access
        const server = await client.call("server", networkOpts)
        url = server.url
      } else {
        // Use direct RPC communication (no HTTP)
        url = "http://opencorvus.internal"
        customFetch = createWorkerFetch(client)
        events = createEventSource(client)
      }

      const tuiPromise = tui({
        url,
        config,
        directory: cwd,
        fetch: customFetch,
        events,
        args: {
          continue: args.continue,
          sessionID: args.session,
          agent: args.agent,
          model: args.model,
          prompt,
          fork: args.fork,
        },
        onExit: async () => {
          await client.call("shutdown", undefined)
        },
      })

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000)

      await tuiPromise
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})

