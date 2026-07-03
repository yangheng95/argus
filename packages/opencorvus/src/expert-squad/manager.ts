import { BlobWriter, Uint8ArrayReader, Writer, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { randomUUID } from "crypto"
import { cp, lstat, mkdir, readdir, rename, rm } from "fs/promises"
import path from "path"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Filesystem } from "@/util/filesystem"
import { builtInPromptProfiles } from "./builtin"
import { ExpertSquadRegistry } from "./registry"

export namespace ExpertSquadPackageManager {
  export interface ImportDirectoryInput {
    projectDirectory: string
    sourceDirectory: string
    replace: boolean
  }

  export interface ImportArchiveInput {
    projectDirectory: string
    archiveBase64: string
    filename?: string
    replace: boolean
  }

  export interface ExportInput {
    projectDirectory: string
    id: string
  }

  export interface ImportResult {
    id: string
    targetRoot: string
    replaced: boolean
  }

  export interface ExportResult {
    id: string
    filename: string
    bytes: Uint8Array
    fileCount: number
  }

  type NormalizedArchiveFile = {
    path: string
    bytes: Uint8Array
  }

  export const archiveImportLimits = {
    base64Characters: 24 * 1024 * 1024,
    archiveBytes: 18 * 1024 * 1024,
    entries: 512,
    fileBytes: 4 * 1024 * 1024,
    totalUnpackedBytes: 16 * 1024 * 1024,
  } as const

  const packageInstallLocks = new Map<string, Promise<void>>()

  function canonicalBase(projectDirectory: string) {
    return path.join(ProjectRuntimePaths.projectConfigRoot(Filesystem.resolve(projectDirectory)), ExpertSquadRegistry.DIRECTORY)
  }

  function scratchBase(projectDirectory: string) {
    return path.join(ProjectRuntimePaths.projectConfigRoot(Filesystem.resolve(projectDirectory)), "expert-squad-staging")
  }

  function targetRoot(projectDirectory: string, id: string) {
    return path.join(canonicalBase(projectDirectory), id)
  }

  async function withPackageInstallLock<T>(lockKey: string, run: () => Promise<T>): Promise<T> {
    const previous = packageInstallLocks.get(lockKey) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)
    packageInstallLocks.set(lockKey, tail)
    await previous.catch(() => undefined)
    try {
      return await run()
    } finally {
      release()
      if (packageInstallLocks.get(lockKey) === tail) packageInstallLocks.delete(lockKey)
    }
  }

  function stagingRoot(projectDirectory: string, label: string) {
    return path.join(scratchBase(projectDirectory), `.staging-${label}-${randomUUID()}`)
  }

  function backupRoot(projectDirectory: string, label: string) {
    return path.join(scratchBase(projectDirectory), `.replace-${label}-${randomUUID()}`)
  }

  function assertInside(parent: string, child: string, context: string) {
    if (!Filesystem.contains(parent, child)) throw new Error(`${context}: path escapes expert squad package directory`)
  }

  function assertNoBuiltInCollision(id: string) {
    if (Object.hasOwn(builtInPromptProfiles, id)) {
      throw new Error(`Expert squad package id ${JSON.stringify(id)} collides with a built-in expert squad id`)
    }
  }

  function assertSourceNotRuntimeInternal(projectDirectory: string, sourceDirectory: string) {
    const projectRoot = Filesystem.resolve(projectDirectory)
    const source = Filesystem.resolve(sourceDirectory)
    if (!Filesystem.contains(projectRoot, source)) return
    const relativePath = path.relative(projectRoot, source).replace(/\\/g, "/")
    if (ProjectRuntimePaths.isInternalRuntimeRelativePath(relativePath)) {
      throw new Error(`Expert squad source directory is inside OpenCorvus runtime storage: ${relativePath}`)
    }
  }

  function normalizeArchivePath(value: string) {
    const slashNormalized = value.replace(/\\/g, "/")
    if (slashNormalized.startsWith("/") || /^[a-zA-Z]:/.test(slashNormalized)) {
      throw new Error(`Refusing absolute expert squad archive path: ${value}`)
    }
    if (slashNormalized.includes(":")) throw new Error(`Refusing unsafe expert squad archive path: ${value}`)
    const normalized = slashNormalized.replace(/^\.\//, "")
    const segments = normalized.split("/").filter(Boolean)
    if (segments.length === 0) throw new Error(`Invalid empty expert squad archive path: ${value}`)
    if (segments.some((segment) => segment === "." || segment === "..")) {
      throw new Error(`Refusing unsafe expert squad archive path: ${value}`)
    }
    return segments.join("/")
  }

  function stripSingleRoot(files: NormalizedArchiveFile[]): NormalizedArchiveFile[] {
    if (files.some((file) => file.path === ExpertSquadRegistry.MANIFEST)) return files
    const roots = new Set(files.map((file) => file.path.split("/")[0]!))
    if (roots.size !== 1) {
      throw new Error(`Expert squad archive must contain ${ExpertSquadRegistry.MANIFEST} at root or inside one wrapper directory`)
    }
    const root = Array.from(roots)[0]!
    const stripped = files.map((file) => ({
      ...file,
      path: file.path.slice(root.length + 1),
    }))
    if (!stripped.some((file) => file.path === ExpertSquadRegistry.MANIFEST)) {
      throw new Error(`Expert squad archive wrapper "${root}" does not contain ${ExpertSquadRegistry.MANIFEST}`)
    }
    return stripped
  }

  function assertArchiveByteLimit(label: string, value: number, limit: number) {
    if (value > limit) throw new Error(`${label} exceeds expert squad archive limit: ${value} bytes > ${limit} bytes`)
  }

  class LimitedUint8ArrayWriter extends Writer<Uint8Array> {
    private chunks: Uint8Array[] = []
    private byteCount = 0

    constructor(private limits: { label: string; limit: number }[]) {
      super()
    }

    override async init(size?: number) {
      await super.init?.(size)
      if (typeof size !== "number") return
      for (const limit of this.limits) assertArchiveByteLimit(limit.label, size, limit.limit)
    }

    override async writeUint8Array(array: Uint8Array) {
      const nextByteCount = this.byteCount + array.byteLength
      for (const limit of this.limits) assertArchiveByteLimit(limit.label, nextByteCount, limit.limit)
      this.chunks.push(Uint8Array.from(array))
      this.byteCount = nextByteCount
    }

    override async getData() {
      const result = new Uint8Array(this.byteCount)
      let offset = 0
      for (const chunk of this.chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }
      return result
    }
  }

  async function readArchiveFiles(input: ImportArchiveInput): Promise<NormalizedArchiveFile[]> {
    if (input.archiveBase64.length > archiveImportLimits.base64Characters) {
      throw new Error(
        `Expert squad archive base64 payload exceeds limit: ${input.archiveBase64.length} characters > ${archiveImportLimits.base64Characters} characters`,
      )
    }
    const archive = Uint8Array.from(Buffer.from(input.archiveBase64, "base64"))
    assertArchiveByteLimit("Expert squad archive", archive.byteLength, archiveImportLimits.archiveBytes)
    const reader = new ZipReader(new Uint8ArrayReader(archive))
    try {
      const entries = await reader.getEntries()
      if (entries.length > archiveImportLimits.entries) {
        throw new Error(`Expert squad archive entry count exceeds limit: ${entries.length} > ${archiveImportLimits.entries}`)
      }
      const files: NormalizedArchiveFile[] = []
      const seen = new Set<string>()
      let declaredUnpackedBytes = 0
      let actualUnpackedBytes = 0
      for (const entry of entries) {
        if (entry.directory) continue
        const relativePath = normalizeArchivePath(entry.filename)
        const collisionKey = relativePath.toLowerCase()
        if (seen.has(collisionKey)) throw new Error(`Duplicate expert squad archive path after normalization: ${relativePath}`)
        seen.add(collisionKey)
        assertArchiveByteLimit(`Expert squad archive file ${relativePath}`, entry.uncompressedSize, archiveImportLimits.fileBytes)
        declaredUnpackedBytes += entry.uncompressedSize
        assertArchiveByteLimit(
          "Expert squad archive declared unpacked content",
          declaredUnpackedBytes,
          archiveImportLimits.totalUnpackedBytes,
        )
        const data = await entry.getData?.(
          new LimitedUint8ArrayWriter([
            { label: `Expert squad archive file ${relativePath}`, limit: archiveImportLimits.fileBytes },
            {
              label: "Expert squad archive unpacked content",
              limit: archiveImportLimits.totalUnpackedBytes - actualUnpackedBytes,
            },
          ]),
        )
        if (!data) continue
        assertArchiveByteLimit(`Expert squad archive file ${relativePath}`, data.byteLength, archiveImportLimits.fileBytes)
        actualUnpackedBytes += data.byteLength
        assertArchiveByteLimit(
          "Expert squad archive unpacked content",
          actualUnpackedBytes,
          archiveImportLimits.totalUnpackedBytes,
        )
        files.push({
          path: relativePath,
          bytes: data,
        })
      }
      if (files.length === 0) throw new Error(`No files found in ${input.filename ?? "expert squad archive"}`)
      return validateArchiveFiles(stripSingleRoot(files))
    } finally {
      await reader.close()
    }
  }

  function validateArchiveFiles(files: NormalizedArchiveFile[]) {
    const fileKeys = new Set<string>()
    const dirKeys = new Set<string>()
    for (const file of files) {
      if (!file.path) throw new Error("Expert squad archive wrapper contains a file at the package root name")
      const segments = file.path.split("/")
      const fileKey = file.path.toLowerCase()
      if (fileKeys.has(fileKey)) throw new Error(`Duplicate expert squad archive path after normalization: ${file.path}`)
      if (dirKeys.has(fileKey)) throw new Error(`Expert squad archive file/directory collision: ${file.path}`)
      for (let index = 1; index < segments.length; index++) {
        const dirKey = segments.slice(0, index).join("/").toLowerCase()
        if (fileKeys.has(dirKey)) throw new Error(`Expert squad archive file/directory collision: ${file.path}`)
        dirKeys.add(dirKey)
      }
      fileKeys.add(fileKey)
    }
    return files
  }

  async function writeArchiveFiles(sourceRoot: string, files: NormalizedArchiveFile[]) {
    for (const file of files) {
      const target = path.join(sourceRoot, ...file.path.split("/"))
      assertInside(sourceRoot, target, file.path)
      await Filesystem.write(target, file.bytes)
    }
  }

  async function installSourceDirectory(input: {
    projectDirectory: string
    sourceDirectory: string
    replace: boolean
  }): Promise<ImportResult> {
    assertSourceNotRuntimeInternal(input.projectDirectory, input.sourceDirectory)
    const source = Filesystem.resolve(input.sourceDirectory)
    const loaded = await ExpertSquadRegistry.loadSourcePackage(source)
    assertNoBuiltInCollision(loaded.id)
    const target = targetRoot(input.projectDirectory, loaded.id)
    return withPackageInstallLock(Filesystem.normalizePath(target), async () => {
      const base = canonicalBase(input.projectDirectory)
      const scratch = scratchBase(input.projectDirectory)
      const staging = stagingRoot(input.projectDirectory, loaded.id)
      const backup = backupRoot(input.projectDirectory, loaded.id)
      const targetState = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (targetState?.isSymbolicLink()) throw new Error(`Expert squad target is a symbolic link: ${target}`)
      if (targetState && !targetState.isDirectory()) {
        throw new Error(`Expert squad target exists and is not a directory: ${target}`)
      }
      const existing = !!targetState

      if (existing && !input.replace) throw new Error(`Expert squad package already exists: ${loaded.id}`)

      await mkdir(base, { recursive: true })
      await mkdir(scratch, { recursive: true })
      assertInside(scratch, staging, "expert squad staging root")
      assertInside(scratch, backup, "expert squad replacement backup")
      assertInside(base, target, "expert squad target root")
      await rm(staging, { recursive: true, force: true })
      await rm(backup, { recursive: true, force: true })

      let targetMoved = false
      let targetInstalled = false
      try {
        await cp(source, staging, {
          recursive: true,
          force: false,
          errorOnExist: true,
          verbatimSymlinks: true,
        })
        const staged = await ExpertSquadRegistry.loadSourcePackage(staging)
        if (staged.id !== loaded.id) {
          throw new Error(`Expert squad package id changed during import: expected ${loaded.id}, got ${staged.id}`)
        }

        if (existing) {
          await rename(target, backup)
          targetMoved = true
        }
        await rename(staging, target)
        targetInstalled = true
        await ExpertSquadRegistry.loadPackage(target)
        await rm(backup, { recursive: true, force: true })
        return {
          id: loaded.id,
          targetRoot: target,
          replaced: existing,
        }
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined)
        if (targetMoved) {
          try {
            await rm(target, { recursive: true, force: true })
            await rename(backup, target)
          } catch (restoreError) {
            throw new Error(
              `Expert squad package replace failed and restoring the previous package also failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
              { cause: error },
            )
          }
        }
        if (!targetMoved && targetInstalled) await rm(target, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  export async function importDirectory(input: ImportDirectoryInput): Promise<ImportResult> {
    return installSourceDirectory(input)
  }

  export async function importArchive(input: ImportArchiveInput): Promise<ImportResult> {
    const scratch = scratchBase(input.projectDirectory)
    const sourceRoot = stagingRoot(input.projectDirectory, "archive")
    await mkdir(scratch, { recursive: true })
    await rm(sourceRoot, { recursive: true, force: true })
    try {
      await writeArchiveFiles(sourceRoot, await readArchiveFiles(input))
      return await installSourceDirectory({
        projectDirectory: input.projectDirectory,
        sourceDirectory: sourceRoot,
        replace: input.replace,
      })
    } finally {
      await rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  function zipPath(...parts: string[]) {
    return parts.join("/").replace(/\\/g, "/")
  }

  async function collectPackageFiles(root: string) {
    const files: string[] = []
    async function walk(current: string) {
      const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new Error(`Expert squad package export rejects symbolic link: ${entry.name}`)
        if (ExpertSquadRegistry.isRuntimeInternalEntry(entry.name, entry.isDirectory())) {
          throw new Error(`Expert squad package export rejects runtime entry: ${entry.name}`)
        }
        const child = path.join(current, entry.name)
        if (entry.isDirectory()) {
          await walk(child)
          continue
        }
        if (!entry.isFile()) continue
        const relativePath = path.relative(root, child)
        if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
          throw new Error(`Expert squad package export path escapes package root: ${child}`)
        }
        files.push(relativePath)
      }
    }
    await walk(root)
    return files
  }

  export async function exportArchive(input: ExportInput): Promise<ExportResult> {
    const id = ExpertSquadRegistry.parseID(input.id, "export id")
    const base = canonicalBase(input.projectDirectory)
    const root = targetRoot(input.projectDirectory, id)
    assertInside(base, root, "expert squad export root")
    const loaded = await ExpertSquadRegistry.loadPackage(root)
    const zip = new ZipWriter(new BlobWriter("application/zip"))
    const files = await collectPackageFiles(root)
    for (const file of files) {
      const absolute = path.join(root, file)
      const info = await lstat(absolute)
      if (!info.isFile()) continue
      const bytes = new Uint8Array(await Filesystem.readArrayBuffer(absolute))
      await zip.add(zipPath(loaded.id, ...file.split(path.sep)), new Uint8ArrayReader(bytes))
    }
    const blob = await zip.close()
    return {
      id: loaded.id,
      filename: `${loaded.id}-expert-squad.zip`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      fileCount: files.length,
    }
  }
}
