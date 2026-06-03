import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

export interface PngEvidence {
  path: string
  valid: boolean
  width?: number
  height?: number
  bytes?: number
  sha256?: string
  error?: string
}

export interface WebCloneSourceManifestIntegrity {
  manifestPath: string
  passed: boolean
  findings: string[]
  manifestSha256?: string
}

export const WEB_CLONE_SOURCE_PACKAGE_DIR = "web-clone-source"

export const WEB_CLONE_SOURCE_PACKAGE_FORBIDDEN_ARTIFACTS = [
  "actual-app.png",
  "rendered.png",
  "eval-result.json",
  "vision-judge.json",
  "verification-report.md",
  "tests/visual",
] as const

export const WEB_CLONE_REQUIRED_MIRROR_ARTIFACTS = [
  "reference.png",
  "capture.html",
  "singlefile.html",
  "extracted-page.json",
  "page.ir.json",
  "assets/manifest.json",
  "segments.json",
  "codegen-context.json",
  "source-skeleton/index.html",
  "source-skeleton/critical.css",
  "source-skeleton/full-source.css",
  "source-skeleton/used-selectors.json",
  "source-skeleton/skeleton-manifest.json",
  "source-skeleton/source-skeleton-audit.json",
  "source-ir/component-tree.json",
  "source-ir/content-model.json",
  "source-ir/layout-map.json",
  "source-ir/style-tokens.json",
  "source-ir/interaction-hints.json",
  "source-ir/interaction-state-snapshots.json",
  "source-ir/source-quality-audit.json",
  "interaction-states/initial.png",
  "interaction-states/scroll-25.png",
  "interaction-states/scroll-50.png",
  "interaction-states/scroll-75.png",
] as const

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export async function readPngEvidence(file: string): Promise<PngEvidence> {
  const resolved = path.resolve(file)
  let buffer: Buffer
  try {
    buffer = await fs.readFile(resolved)
  } catch (error) {
    return { path: resolved, valid: false, error: `missing PNG file (${errorMessage(error)})` }
  }
  if (buffer.length < 24) {
    return { path: resolved, valid: false, bytes: buffer.length, sha256: sha256Buffer(buffer), error: "PNG file is too small to contain IHDR metadata" }
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { path: resolved, valid: false, bytes: buffer.length, sha256: sha256Buffer(buffer), error: "file does not have a PNG signature" }
  }
  if (buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    return { path: resolved, valid: false, bytes: buffer.length, sha256: sha256Buffer(buffer), error: "PNG first chunk must be a 13-byte IHDR chunk" }
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width <= 0 || height <= 0) {
    return { path: resolved, valid: false, width, height, bytes: buffer.length, sha256: sha256Buffer(buffer), error: "PNG IHDR width/height must be positive" }
  }
  return {
    path: resolved,
    valid: true,
    width,
    height,
    bytes: buffer.length,
    sha256: sha256Buffer(buffer),
  }
}

export async function inspectWebCloneSourceManifest(sourcePackageDir: string): Promise<WebCloneSourceManifestIntegrity> {
  const manifestPath = path.join(sourcePackageDir, "web-clone-source-manifest.json")
  const findings: string[] = []
  const sourceStat = await fs.lstat(sourcePackageDir).catch(() => undefined)
  if (!sourceStat?.isDirectory()) findings.push("web-clone-source must be a real directory.")
  if (sourceStat?.isSymbolicLink()) findings.push("web-clone-source must not be a symlink or junction.")
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>
  } catch (error) {
    return {
      manifestPath,
      passed: false,
      findings: [`Missing or invalid web-clone-source-manifest.json (${errorMessage(error)}).`],
    }
  }

  const manifestSha256 = await sha256File(manifestPath)
  if (manifest.version !== 1) findings.push("web-clone-source-manifest.json version must be 1.")
  if (manifest.purpose !== "web-clone-visible-source-package") {
    findings.push("web-clone-source-manifest.json purpose must be web-clone-visible-source-package.")
  }
  const provenance = asRecord(manifest.provenance)
  if (provenance.source !== "mirror") findings.push("web-clone-source-manifest.json provenance.source must be mirror.")
  if (typeof provenance.mirrorDir !== "string" || provenance.mirrorDir.length === 0) {
    findings.push("web-clone-source-manifest.json provenance.mirrorDir is required.")
  }

  const referenceEvidence = await readPngEvidence(path.join(sourcePackageDir, "reference.png"))
  if (!referenceEvidence.valid) {
    findings.push(`reference.png is not a valid PNG (${referenceEvidence.error ?? "invalid PNG"}).`)
  }
  const manifestReference = asRecord(provenance.reference)
  if (referenceEvidence.valid) {
    if (manifestReference.sha256 !== referenceEvidence.sha256) {
      findings.push("Manifest reference sha256 does not match web-clone-source/reference.png.")
    }
    if (manifestReference.width !== referenceEvidence.width || manifestReference.height !== referenceEvidence.height) {
      findings.push("Manifest reference dimensions do not match web-clone-source/reference.png.")
    }
  }

  const files = Array.isArray(manifest.files) ? manifest.files : []
  if (files.length === 0) findings.push("web-clone-source-manifest.json must include hashed files[].")
  const fileRows = files.map(asRecord)
  if (!fileRows.some((row) => row.path === "reference.png")) {
    findings.push("web-clone-source-manifest.json files[] must include reference.png.")
  }
  for (const row of fileRows) {
    const relative = typeof row.path === "string" ? row.path : undefined
    const expectedSha = typeof row.sha256 === "string" ? row.sha256 : undefined
    if (!relative || !expectedSha) {
      findings.push("Each web-clone-source-manifest.json files[] entry must include path and sha256.")
      continue
    }
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      findings.push(`Manifest file entry escapes source package: ${relative}.`)
      continue
    }
    const actualSha = await sha256File(path.join(sourcePackageDir, relative))
    if (!actualSha) {
      findings.push(`Manifest file entry is missing on disk: ${relative}.`)
    } else if (actualSha !== expectedSha) {
      findings.push(`Manifest file entry hash mismatch: ${relative}.`)
    }
  }

  return {
    manifestPath,
    passed: findings.length === 0,
    findings,
    manifestSha256,
  }
}

export async function sha256File(file: string): Promise<string | undefined> {
  try {
    return sha256Buffer(await fs.readFile(file))
  } catch {
    return undefined
  }
}

export async function listExistingWebCloneSourcePackageContamination(sourcePackageDir: string): Promise<string[]> {
  const findings: string[] = []
  for (const relative of WEB_CLONE_SOURCE_PACKAGE_FORBIDDEN_ARTIFACTS) {
    const target = path.join(sourcePackageDir, relative)
    if (await exists(target)) findings.push(relative)
  }
  for (const file of await listFiles(sourcePackageDir)) {
    const relative = normalizePath(path.relative(sourcePackageDir, file))
    if (/(^|\/)(actual-app|eval|rendered|screenshots?|vision|verification|coverage|dist|build)(?:[./_-]|$)/i.test(relative) ||
      relative.endsWith("/web-clone-source-skeleton-consumption-audit.json") ||
      relative === "web-clone-source-skeleton-consumption-audit.json") {
      findings.push(relative)
    }
  }
  return findings
}

export async function listMissingMirrorArtifacts(mirrorDir: string): Promise<string[]> {
  const missing: string[] = []
  for (const relative of WEB_CLONE_REQUIRED_MIRROR_ARTIFACTS) {
    if (!await hasNonEmptyFile(path.join(mirrorDir, relative))) missing.push(relative)
  }
  return missing
}

export async function readPassedAudit(file: string): Promise<boolean | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"))
    return typeof parsed?.passed === "boolean" ? parsed.passed : undefined
  } catch {
    return undefined
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

async function hasNonEmptyFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: Array<import("node:fs").Dirent>
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
  }
  await walk(root)
  return files
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
