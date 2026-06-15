import { Log } from "@/util/log"

const log = Log.create({ service: "runtime.memory" })

const DEFAULT_INTERVAL_MS = 60_000
const DISABLED_VALUES = new Set(["0", "false", "no", "off"])

export type RuntimeMemorySnapshot = {
  pid: number
  uptimeMs: number
  process: {
    rss: number
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
  }
  providers: Record<string, unknown>
}

export namespace ServeRuntimeMemoryMetrics {
  export type Provider = {
    id: string
    snapshot: () => unknown | Promise<unknown>
  }

  const providers = new Map<string, Provider["snapshot"]>()

  export function register(provider: Provider): () => void {
    if (!provider.id.trim()) throw new Error("Runtime memory metrics provider id is required")
    providers.set(provider.id, provider.snapshot)
    return () => {
      if (providers.get(provider.id) === provider.snapshot) providers.delete(provider.id)
    }
  }

  export function resetProvidersForTest() {
    providers.clear()
  }

  export async function providerSnapshots(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {}
    for (const [id, snapshot] of providers) {
      try {
        result[id] = await snapshot()
      } catch (error) {
        result[id] = {
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    return result
  }

  export function intervalMsFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
    const raw = env.OPENCORVUS_RUNTIME_MEMORY_METRICS_INTERVAL_MS
    if (raw && DISABLED_VALUES.has(raw.toLowerCase())) return undefined
    if (!raw) return DEFAULT_INTERVAL_MS
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS
    return Math.floor(parsed)
  }

  export async function collect(input: { providers?: () => Record<string, unknown> | Promise<Record<string, unknown>> } = {}): Promise<RuntimeMemorySnapshot> {
    const mem = process.memoryUsage()
    return {
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      process: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
      providers: await (input.providers ?? providerSnapshots)(),
    }
  }

  export function start(input: { intervalMs?: number; logger?: Pick<Log.Logger, "info" | "warn"> } = {}) {
    const intervalMs = input.intervalMs ?? intervalMsFromEnv()
    const logger = input.logger ?? log
    if (!intervalMs) {
      return {
        intervalMs: 0,
        stop() {},
      }
    }

    const emit = async () => {
      try {
        logger.info("runtime.memory.metrics", await collect())
      } catch (error) {
        logger.warn("runtime.memory.metrics.failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const timer = setInterval(() => {
      void emit()
    }, intervalMs)
    timer.unref()
    void emit()
    return {
      intervalMs,
      stop() {
        clearInterval(timer)
      },
    }
  }
}
