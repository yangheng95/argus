import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ComputerError } from "./errors"

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const relativeFile = z.string().min(1)

const artifact = z
  .object({
    path: relativeFile,
    sha256,
  })
  .strict()

export const ComputerRuntimeBundleManifest = z
  .object({
    schema_version: z.literal(1),
    protocol_version: z.literal(1),
    request_timeout_ms: z.number().int().min(1_000).max(25_000),
    bundle_id: z.string().trim().min(1),
    bundle_version: z.string().trim().min(1),
    platform: z
      .object({
        os: z.literal("win32"),
        arch: z.literal("x64"),
      })
      .strict(),
    upstream: z
      .object({
        repository: z.literal("https://github.com/trycua/cua"),
        commit: z.literal("bb8efbfe6caadbccba54221096d959607ed9f574"),
        computer_server_version: z.literal("0.3.42"),
      })
      .strict(),
    launcher: artifact.extend({ args: z.array(z.string()).default([]) }).strict(),
    adapter: artifact.extend({ protocol: z.literal("jsonl-v1") }).strict(),
    python: artifact.extend({ version: z.string().trim().min(1) }).strict(),
    wheel_lock: artifact,
    hypervisor: artifact.extend({ kind: z.literal("qemu"), version: z.string().trim().min(1) }).strict(),
    firmware: artifact,
    guest_image: artifact.extend({ identity: z.string().trim().min(1) }).strict(),
    viewer: artifact
      .extend({
        protocol: z.literal("workspace-descriptor-v1"),
        descriptor: z.literal("viewer.json"),
      })
      .strict(),
    network: z
      .object({
        control: z.literal("host-only"),
        business: z.literal("guest-managed"),
      })
      .strict(),
    sbom: artifact,
    licenses: artifact,
    provenance: artifact,
    attestation: artifact,
    files: z
      .array(
        artifact
          .extend({
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(12),
  })
  .strict()

export type ComputerRuntimeBundleManifest = z.infer<typeof ComputerRuntimeBundleManifest>

export type VerifiedComputerRuntimeBundle = {
  manifestPath: string
  directory: string
  manifest: ComputerRuntimeBundleManifest
  launcherPath: string
  viewerPath: string
  contentID: string
}

function invalid(message: string, details: Record<string, unknown> = {}, cause?: unknown): ComputerError {
  return new ComputerError("COMPUTER_RUNTIME_INVALID", message, details, cause instanceof Error ? { cause } : undefined)
}

function resolveContainedFile(directory: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw invalid("Computer runtime bundle paths must be relative", { relativePath })
  const target = path.resolve(directory, relativePath)
  const relative = path.relative(directory, target)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw invalid("Computer runtime bundle path escapes its bundle directory", { relativePath })
  }
  return target
}

function bundleContentID(manifest: ComputerRuntimeBundleManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
}

async function hashFile(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256")
  let bytes = 0
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    hash.update(buffer)
  }
  return { sha256: hash.digest("hex"), bytes }
}

async function inventoryFiles(directory: string, manifestPath: string): Promise<string[]> {
  const result: string[] = []
  const visit = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      if (entry.isSymbolicLink())
        throw invalid("Computer runtime bundles cannot contain symbolic links", { path: absolute })
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!entry.isFile())
        throw invalid("Computer runtime bundles may contain only files and directories", { path: absolute })
      const stat = await fs.stat(absolute)
      if (stat.nlink !== 1) {
        throw invalid("Computer runtime bundle files must have exactly one filesystem link", {
          path: absolute,
          links: stat.nlink,
        })
      }
      if (path.resolve(absolute) !== path.resolve(manifestPath)) {
        result.push(path.relative(directory, absolute).replaceAll("\\", "/"))
      }
    }
  }
  await visit(directory)
  return result.sort()
}

export async function verifyComputerRuntimeBundle(input: {
  manifestPath?: string
  platform?: NodeJS.Platform
  arch?: string
}): Promise<VerifiedComputerRuntimeBundle> {
  const configuredPath = input.manifestPath?.trim()
  if (!configuredPath) {
    throw new ComputerError(
      "COMPUTER_RUNTIME_REQUIRED",
      "Computer Use requires one explicitly configured self-contained runtime bundle manifest",
    )
  }
  const manifestPath = path.resolve(configuredPath)
  const directory = path.dirname(manifestPath)
  let manifest: ComputerRuntimeBundleManifest
  try {
    manifest = ComputerRuntimeBundleManifest.parse(JSON.parse(await fs.readFile(manifestPath, "utf8")))
  } catch (error) {
    throw invalid("Computer runtime bundle manifest is unreadable or invalid", { manifestPath }, error)
  }
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  if (manifest.platform.os !== platform || manifest.platform.arch !== arch) {
    throw invalid("Computer runtime bundle platform does not match this host", {
      expected: manifest.platform,
      actual: { os: platform, arch },
    })
  }

  const listedPaths = manifest.files.map((item) => item.path.replaceAll("\\", "/"))
  if (new Set(listedPaths).size !== listedPaths.length) {
    throw invalid("Computer runtime bundle file inventory contains duplicate paths")
  }
  const actualPaths = await inventoryFiles(directory, manifestPath)
  const expectedPaths = [...listedPaths].sort()
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw invalid("Computer runtime bundle file inventory is not exhaustive", { expectedPaths, actualPaths })
  }

  const inventory = new Map(manifest.files.map((item) => [item.path.replaceAll("\\", "/"), item]))
  const required = [
    manifest.launcher,
    manifest.adapter,
    manifest.python,
    manifest.wheel_lock,
    manifest.hypervisor,
    manifest.firmware,
    manifest.guest_image,
    manifest.viewer,
    manifest.sbom,
    manifest.licenses,
    manifest.provenance,
    manifest.attestation,
  ]
  for (const item of required) {
    const normalized = item.path.replaceAll("\\", "/")
    const declared = inventory.get(normalized)
    if (!declared || declared.sha256 !== item.sha256) {
      throw invalid("Computer runtime required artifact is missing from the exact file inventory", { path: normalized })
    }
  }
  for (const item of manifest.files) {
    const filePath = resolveContainedFile(directory, item.path)
    let actual: { sha256: string; bytes: number }
    try {
      actual = await hashFile(filePath)
    } catch (error) {
      throw invalid("Computer runtime bundle file cannot be read", { path: item.path }, error)
    }
    if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) {
      throw invalid("Computer runtime bundle file integrity check failed", {
        path: item.path,
        expected: { sha256: item.sha256, bytes: item.bytes },
        actual,
      })
    }
  }
  return {
    manifestPath,
    directory,
    manifest,
    launcherPath: resolveContainedFile(directory, manifest.launcher.path),
    viewerPath: resolveContainedFile(directory, manifest.viewer.path),
    contentID: bundleContentID(manifest),
  }
}

export async function verifyProvisionedComputerRuntimeBundle(input: {
  manifestPath?: string
  platform?: NodeJS.Platform
  arch?: string
}): Promise<VerifiedComputerRuntimeBundle> {
  const verified = await verifyComputerRuntimeBundle(input)
  if (
    path.basename(verified.manifestPath) !== "computer-runtime.json" ||
    path.basename(verified.directory) !== verified.contentID
  ) {
    throw invalid("Computer runtime execution requires a content-addressed provisioned bundle", {
      contentID: verified.contentID,
      manifestPath: verified.manifestPath,
    })
  }
  return verified
}

export async function provisionComputerRuntimeBundle(input: {
  manifestPath: string
  destinationRoot: string
  platform?: NodeJS.Platform
  arch?: string
}): Promise<VerifiedComputerRuntimeBundle> {
  const source = await verifyComputerRuntimeBundle(input)
  const destinationRoot = path.resolve(input.destinationRoot)
  await fs.mkdir(destinationRoot, { recursive: true })
  const destination = path.join(destinationRoot, source.contentID)
  const destinationManifest = path.join(destination, "computer-runtime.json")
  try {
    const installed = await verifyComputerRuntimeBundle({
      manifestPath: destinationManifest,
      platform: input.platform,
      arch: input.arch,
    })
    if (installed.contentID !== source.contentID) {
      throw invalid("Provisioned Computer runtime content identity does not match its directory", {
        expected: source.contentID,
        actual: installed.contentID,
      })
    }
    return installed
  } catch (error) {
    if (!(error instanceof ComputerError) || error.code !== "COMPUTER_RUNTIME_INVALID") throw error
  }

  const staging = await fs.mkdtemp(path.join(destinationRoot, ".computer-runtime-provision-"))
  const stagingManifest = path.join(staging, "computer-runtime.json")
  try {
    for (const item of source.manifest.files) {
      const sourcePath = resolveContainedFile(source.directory, item.path)
      const targetPath = resolveContainedFile(staging, item.path)
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.copyFile(sourcePath, targetPath)
    }
    await fs.writeFile(stagingManifest, JSON.stringify(source.manifest, null, 2))
    const staged = await verifyComputerRuntimeBundle({
      manifestPath: stagingManifest,
      platform: input.platform,
      arch: input.arch,
    })
    if (staged.contentID !== source.contentID) {
      throw invalid("Staged Computer runtime content identity changed during provisioning", {
        expected: source.contentID,
        actual: staged.contentID,
      })
    }
    await fs.rename(staging, destination)
    return await verifyComputerRuntimeBundle({
      manifestPath: destinationManifest,
      platform: input.platform,
      arch: input.arch,
    })
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true })
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const installed = await verifyComputerRuntimeBundle({
        manifestPath: destinationManifest,
        platform: input.platform,
        arch: input.arch,
      })
      if (installed.contentID === source.contentID) return installed
    }
    throw error
  }
}
