import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ProcessSupervisor } from "@/shell/process-supervisor"
import { ComputerError } from "./errors"
import { verifyProvisionedComputerRuntimeBundle } from "./runtime-bundle"
import { computerRuntimeWorkspace } from "./runtime-scope"

export const ComputerViewerDescriptor = z
  .object({
    schema_version: z.literal(1),
    computer_id: z.string().min(1),
    display_id: z.string().min(1),
    args: z.array(z.string()).max(64),
  })
  .strict()

export type ComputerViewerDescriptor = z.infer<typeof ComputerViewerDescriptor>

export async function resolveComputerViewer(input: {
  manifestPath?: string
  runtimeScope: string
  computerId: string
  displayId: string
}) {
  const runtime = await verifyProvisionedComputerRuntimeBundle({ manifestPath: input.manifestPath })
  const workspaceDirectory = computerRuntimeWorkspace(input.runtimeScope)
  const descriptorPath = path.join(workspaceDirectory, runtime.manifest.viewer.descriptor)
  let descriptor: ComputerViewerDescriptor
  try {
    descriptor = ComputerViewerDescriptor.parse(JSON.parse(await fs.readFile(descriptorPath, "utf8")))
  } catch (error) {
    throw new ComputerError(
      "COMPUTER_BACKEND_ERROR",
      "Computer viewer descriptor is unreadable or invalid",
      { computerId: input.computerId, displayId: input.displayId },
      error instanceof Error ? { cause: error } : undefined,
    )
  }
  if (descriptor.computer_id !== input.computerId || descriptor.display_id !== input.displayId) {
    throw new ComputerError("COMPUTER_BACKEND_ERROR", "Computer viewer descriptor identity does not match", {
      expected: { computerId: input.computerId, displayId: input.displayId },
      actual: { computerId: descriptor.computer_id, displayId: descriptor.display_id },
    })
  }
  return { runtime, workspaceDirectory, descriptor }
}

export async function openComputerViewer(input: {
  manifestPath?: string
  runtimeScope: string
  computerId: string
  displayId: string
}) {
  const resolved = await resolveComputerViewer(input)
  const allowedEnvironment = Object.fromEntries(
    ["SYSTEMROOT", "WINDIR"].flatMap((key) => (process.env[key] ? [[key, process.env[key] as string]] : [])),
  )
  const handle = await ProcessSupervisor.spawnHostCommand({
    executable: resolved.runtime.viewerPath,
    args: resolved.descriptor.args,
    cwd: resolved.runtime.directory,
    env: {
      ...allowedEnvironment,
      TEMP: resolved.workspaceDirectory,
      TMP: resolved.workspaceDirectory,
    },
    stdin: "ignore",
    owner: "computer-native-viewer",
  })
  return {
    opened: true as const,
    pid: handle.pid,
    computerId: input.computerId,
    displayId: input.displayId,
    runtimeBundleId: resolved.runtime.manifest.bundle_id,
  }
}
