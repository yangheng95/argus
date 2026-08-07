import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { ProcessSupervisor } from "@/shell/process-supervisor"
import { Global } from "@/global"
import { z } from "zod"
import { ComputerError, computerError } from "./errors"
import { verifyProvisionedComputerRuntimeBundle, type VerifiedComputerRuntimeBundle } from "./runtime-bundle"

export type ComputerPoint = { x: number; y: number }
export type ComputerBackendObservation = {
  computerId: string
  displayId: string
  pngBase64: string
}

export type ComputerBackendAction =
  | { kind: "click"; computerId: string; displayId: string; x: number; y: number; button: "left" | "right" }
  | { kind: "type_text"; computerId: string; displayId: string; text: string }
  | { kind: "keypress"; computerId: string; displayId: string; keys: string[] }
  | { kind: "scroll"; computerId: string; displayId: string; deltaX: number; deltaY: number }
  | { kind: "drag"; computerId: string; displayId: string; from: ComputerPoint; to: ComputerPoint; durationMs: number }

export type ComputerBackendActionInput = ComputerBackendAction extends infer Action
  ? Action extends ComputerBackendAction
    ? Omit<Action, "computerId" | "displayId">
    : never
  : never

export interface ComputerBackend {
  create(): Promise<{ computerId: string; displayId: string; bundleId: string }>
  observe(input: { computerId: string; displayId: string }): Promise<ComputerBackendObservation>
  act(action: ComputerBackendAction): Promise<{ accepted: true; backendActionId: string }>
  destroy(input: { computerId: string }): Promise<{ destroyed: true }>
  close(): Promise<void>
}

type JsonLineComputerBackendOptions = {
  manifestPath?: string
  workspace?: string
  verifyRuntime?: typeof verifyProvisionedComputerRuntimeBundle
  spawnRuntime?: typeof ProcessSupervisor.spawnHostCommand
}

const ProtocolResponse = z
  .object({
    request_id: z.string().min(1),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((response) => (response.result === undefined) !== (response.error === undefined), {
    message: "Computer runtime response must contain exactly one result or error",
  })

const CreateResult = z
  .object({
    computer_id: z.string().min(1),
    display_id: z.string().min(1),
  })
  .strict()
const ObserveResult = z
  .object({
    computer_id: z.string().min(1),
    display_id: z.string().min(1),
    png_base64: z.string().min(1),
  })
  .strict()
const ActionResult = z.object({ backend_action_id: z.string().min(1) }).strict()
const DestroyResult = z.object({ destroyed: z.literal(true) }).strict()

type Pending = {
  operation: string
  effect: ComputerOperationEffect
  resolve(value: unknown): void
  reject(error: unknown): void
}

type ComputerOperationEffect = "read" | "effect"

function failureCode(effect: ComputerOperationEffect) {
  return effect === "effect" ? "COMPUTER_OUTCOME_UNKNOWN" : "COMPUTER_BACKEND_ERROR"
}

export class JsonLineComputerBackend implements ComputerBackend {
  private runtime?: VerifiedComputerRuntimeBundle
  private child?: ProcessSupervisor.Handle
  private pending = new Map<string, Pending>()
  private startup?: Promise<void>
  private workspaceDirectory?: string
  private closePromise?: Promise<void>

  private readonly manifestPath?: string
  private readonly configuredWorkspace?: string
  private readonly verifyRuntime: typeof verifyProvisionedComputerRuntimeBundle
  private readonly spawnRuntime: typeof ProcessSupervisor.spawnHostCommand

  constructor(options: JsonLineComputerBackendOptions = {}) {
    this.manifestPath = options.manifestPath ?? process.env.OPENCORVUS_COMPUTER_RUNTIME_MANIFEST
    this.configuredWorkspace = options.workspace ?? process.env.OPENCORVUS_COMPUTER_WORKSPACE
    this.verifyRuntime = options.verifyRuntime ?? verifyProvisionedComputerRuntimeBundle
    this.spawnRuntime = options.spawnRuntime ?? ProcessSupervisor.spawnHostCommand
  }

  private async ensureStarted() {
    if (this.closePromise) throw new ComputerError("COMPUTER_BACKEND_ERROR", "Computer runtime backend is closed")
    this.startup ??= this.start()
    return this.startup
  }

  private async start() {
    const runtime = await this.verifyRuntime({ manifestPath: this.manifestPath })
    const workspaceRoot = path.join(Global.Path.temporary, "computer-runtime")
    const configuredWorkspace = this.configuredWorkspace?.trim()
    if (!configuredWorkspace) {
      throw new ComputerError(
        "COMPUTER_BACKEND_ERROR",
        "Computer runtime requires one host-owned Session workspace",
      )
    }
    const workspaceDirectory = path.resolve(configuredWorkspace)
    const relativeWorkspace = path.relative(workspaceRoot, workspaceDirectory)
    if (!relativeWorkspace || relativeWorkspace.startsWith("..") || path.isAbsolute(relativeWorkspace)) {
      throw new ComputerError("COMPUTER_BACKEND_ERROR", "Computer runtime workspace is outside the managed root")
    }
    await fs.mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
    await fs.mkdir(workspaceDirectory, { mode: 0o700 })
    const allowedEnvironment = Object.fromEntries(
      ["SYSTEMROOT", "WINDIR"].flatMap((key) => (process.env[key] ? [[key, process.env[key] as string]] : [])),
    )
    let child: ProcessSupervisor.Handle
    try {
      child = await this.spawnRuntime({
        executable: runtime.launcherPath,
        args: runtime.manifest.launcher.args,
        cwd: runtime.directory,
        env: {
          ...allowedEnvironment,
          TEMP: workspaceDirectory,
          TMP: workspaceDirectory,
          OPENCORVUS_COMPUTER_PROTOCOL_VERSION: String(runtime.manifest.protocol_version),
          OPENCORVUS_COMPUTER_BUNDLE_ROOT: runtime.directory,
          OPENCORVUS_COMPUTER_WORKSPACE: workspaceDirectory,
        },
        stdin: "pipe",
        gracefulTerminationMs: 5_000,
        owner: "computer-runtime-bundle",
      })
    } catch (error) {
      await fs.rm(workspaceDirectory, { recursive: true, force: true })
      throw error
    }
    if (!child.stdin || !child.stdout || !child.stderr) {
      await ProcessSupervisor.disposeAndWaitForExit(child, "computer runtime bundle")
      await fs.rm(workspaceDirectory, { recursive: true, force: true })
      throw new ComputerError("COMPUTER_BACKEND_ERROR", "Computer runtime launcher did not expose standard streams")
    }
    this.runtime = runtime
    this.child = child
    this.workspaceDirectory = workspaceDirectory
    const lines = createInterface({ input: child.stdout })
    lines.on("line", (line) => this.receive(line))
    child.stderr.on("data", (chunk) => process.stderr.write(`[computer-runtime] ${String(chunk)}`))
    void child.exited.then((code) => this.failPending(`Computer runtime launcher exited with code ${code}`))
  }

  private receive(line: string) {
    let response: z.output<typeof ProtocolResponse>
    try {
      response = ProtocolResponse.parse(JSON.parse(line))
    } catch (error) {
      this.failPending("Computer runtime launcher returned invalid JSON", error)
      void this.close().catch((closeError) => {
        process.stderr.write(`[computer-runtime] cleanup failed: ${computerError(closeError).message}\n`)
      })
      return
    }
    const pending = this.pending.get(response.request_id)
    if (!pending) return
    this.pending.delete(response.request_id)
    if (response.error) {
      pending.reject(
        new ComputerError("COMPUTER_BACKEND_ERROR", response.error.message ?? "Computer runtime action failed", {
          backendCode: response.error.code,
          ...response.error.details,
        }),
      )
      return
    }
    pending.resolve(response.result)
  }

  private failPending(message: string, cause?: unknown) {
    for (const pending of this.pending.values()) {
      pending.reject(
        new ComputerError(
          failureCode(pending.effect),
          message,
          { operation: pending.operation },
          cause instanceof Error ? { cause } : undefined,
        ),
      )
    }
    this.pending.clear()
  }

  private async request<T>(
    operation: string,
    params: unknown,
    resultSchema: z.ZodType<T>,
    effect: ComputerOperationEffect,
  ): Promise<T> {
    await this.ensureStarted()
    const requestId = randomUUID()
    const child = this.child
    if (!child?.stdin) throw new ComputerError("COMPUTER_BACKEND_ERROR", "Computer runtime launcher is unavailable")
    let timeout: ReturnType<typeof setTimeout> | undefined
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(requestId, { operation, effect, resolve, reject })
      timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(
          new ComputerError(failureCode(effect), "Computer runtime request exceeded its bundle-declared timeout", {
            operation,
            requestTimeoutMs: this.runtime!.manifest.request_timeout_ms,
          }),
        )
      }, this.runtime!.manifest.request_timeout_ms)
    })
    try {
      child.stdin.write(`${JSON.stringify({ protocol_version: 1, request_id: requestId, operation, params })}\n`)
    } catch (error) {
      this.pending.delete(requestId)
      if (timeout) clearTimeout(timeout)
      throw new ComputerError(
        failureCode(effect),
        "Computer runtime request could not be written",
        { operation },
        error instanceof Error ? { cause: error } : undefined,
      )
    }
    try {
      return resultSchema.parse(await result)
    } catch (error) {
      if (error instanceof ComputerError) throw error
      throw new ComputerError(
        failureCode(effect),
        "Computer runtime returned a result outside the narrow protocol contract",
        { operation },
        error instanceof Error ? { cause: error } : undefined,
      )
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async create() {
    const result = await this.request("session_create", {}, CreateResult, "effect")
    return {
      computerId: result.computer_id,
      displayId: result.display_id,
      bundleId: this.runtime!.manifest.bundle_id,
    }
  }

  async observe(input: { computerId: string; displayId: string }) {
    const result = await this.request(
      "observe",
      { computer_id: input.computerId, display_id: input.displayId },
      ObserveResult,
      "read",
    )
    return {
      computerId: result.computer_id,
      displayId: result.display_id,
      pngBase64: result.png_base64,
    }
  }

  async act(action: ComputerBackendAction) {
    const result = await this.request(action.kind, action, ActionResult, "effect")
    return { accepted: true as const, backendActionId: result.backend_action_id }
  }

  async destroy(input: { computerId: string }) {
    await this.request("session_destroy", { computer_id: input.computerId }, DestroyResult, "effect")
    return { destroyed: true as const }
  }

  private async disposeOwnedRuntime() {
    const child = this.child
    const workspaceDirectory = this.workspaceDirectory
    this.child = undefined
    this.workspaceDirectory = undefined
    const cleanup = await Promise.allSettled([
      ...(child ? [ProcessSupervisor.disposeAndWaitForExit(child, "computer runtime bundle")] : []),
      ...(workspaceDirectory ? [fs.rm(workspaceDirectory, { recursive: true, force: true })] : []),
    ])
    const failures = cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
    if (failures.length === 1) throw computerError(failures[0])
    if (failures.length > 1) {
      throw computerError(new AggregateError(failures, "Computer runtime process and workspace cleanup failed"))
    }
  }

  async close() {
    this.closePromise ??= this.disposeOwnedRuntime()
    return this.closePromise
  }
}
