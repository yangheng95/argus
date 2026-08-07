// SHA-256 means Secure Hash Algorithm 256-bit.

import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { tool } from "@opencorvus-ai/plugin"

const ASSET_ID = /^A[0-9]{3,}$/
const EXTENSION = /^(?:avif|gif|ico|jpe?g|otf|png|svg|ttf|webp|woff2?)$/
const PROVENANCE_FILE = "provenance.json"

function normalizeProjectRelative(value: string) {
  return value.split(path.sep).join("/")
}

function assertContained(projectDirectory: string, target: string) {
  const relative = path.relative(projectDirectory, target)
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return
  throw new Error("Mirror PRD asset target must stay inside the active project directory")
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

const MaterializationInputSchema = tool.schema
  .object({
    source_url: tool.schema.string().url(),
    asset_id: tool.schema.string().regex(ASSET_ID),
    extension: tool.schema.string().regex(EXTENSION),
    page: tool.schema.string().min(1),
    region: tool.schema.string().min(1),
    asset_type: tool.schema.enum(["platform logo", "favicon", "icon", "image", "svg", "background", "font"]),
    reuse_status: tool.schema.enum(["approved", "replace", "restricted", "unresolved"]),
    rights_evidence: tool.schema.string().min(1),
    max_bytes: tool.schema.number().int().min(1).max(25_000_000),
  })
  .strict()

const MaterializationRecordSchema = tool.schema
  .object({
    schema_version: tool.schema.literal(1),
    input: MaterializationInputSchema,
    local_path: tool.schema.string().min(1),
    byte_length: tool.schema.number().int().positive(),
    sha256: tool.schema.string().regex(/^[a-f0-9]{64}$/),
    media_type: tool.schema.string().min(1),
  })
  .strict()

type MaterializationInput = tool.schema.infer<typeof MaterializationInputSchema>
type MaterializationRecord = tool.schema.infer<typeof MaterializationRecordSchema>

async function readRegular(pathname: string, label: string): Promise<Uint8Array> {
  const before = await fs.lstat(pathname)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(`${label} must be one regular non-linked file`)
  }
  const bytes = new Uint8Array(await fs.readFile(pathname))
  const after = await fs.lstat(pathname)
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.nlink !== 1 ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    bytes.byteLength !== after.size
  ) {
    throw new Error(`${label} changed while it was read`)
  }
  return bytes
}

async function verifyExistingMaterialization(input: {
  projectDirectory: string
  assetDirectory: string
  expectedInput: MaterializationInput
}): Promise<MaterializationRecord> {
  const provenancePath = path.join(input.assetDirectory, PROVENANCE_FILE)
  const provenanceBytes = await readRegular(provenancePath, "Mirror PRD asset provenance")
  let record: MaterializationRecord
  try {
    record = MaterializationRecordSchema.parse(JSON.parse(new TextDecoder().decode(provenanceBytes)))
  } catch (error) {
    throw new Error(
      `Mirror PRD asset provenance is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (JSON.stringify(record.input) !== JSON.stringify(input.expectedInput)) {
    throw new Error(`Mirror PRD asset ${input.expectedInput.asset_id} already exists with different provenance`)
  }
  const target = path.resolve(input.projectDirectory, record.local_path)
  assertContained(input.projectDirectory, target)
  if (path.dirname(target) !== input.assetDirectory) {
    throw new Error("Mirror PRD asset provenance points outside its canonical asset directory")
  }
  const bytes = await readRegular(target, "Mirror PRD materialized asset")
  if (bytes.byteLength !== record.byte_length || digest(bytes) !== record.sha256) {
    throw new Error("Mirror PRD materialized asset bytes do not match their provenance")
  }
  return record
}

export default tool({
  description:
    "Materialize one explicitly evidenced Mirror PRD asset as an atomic provenance-bound directory and return the same receipt on an exact retry.",
  args: {
    source_url: tool.schema.string().url().describe("Exact HTTP(S) asset URL observed in source evidence."),
    asset_id: tool.schema
      .string()
      .regex(ASSET_ID)
      .describe("Stable monotonic asset identity such as A001; retries must preserve the same identity."),
    extension: tool.schema
      .string()
      .regex(EXTENSION)
      .describe("Evidence-backed lowercase file extension without a leading dot."),
    page: tool.schema.string().min(1).describe("Page identity that owns the asset evidence."),
    region: tool.schema.string().min(1).describe("Named page region where the asset was observed."),
    asset_type: tool.schema
      .enum(["platform logo", "favicon", "icon", "image", "svg", "background", "font"])
      .describe("Observed asset classification."),
    reuse_status: tool.schema
      .enum(["approved", "replace", "restricted", "unresolved"])
      .describe("Rights-aware reuse decision supplied by the task evidence."),
    rights_evidence: tool.schema
      .string()
      .min(1)
      .describe("Concrete ownership, license, or unresolved-rights evidence."),
    max_bytes: tool.schema
      .number()
      .int()
      .min(1)
      .max(25_000_000)
      .default(10_000_000)
      .describe("Explicit response-size ceiling for this asset."),
  },
  async execute(args, context) {
    const url = new URL(args.source_url)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Mirror PRD materialize-asset accepts only HTTP(S) source URLs")
    }
    const expectedInput = MaterializationInputSchema.parse({ ...args, source_url: url.href })
    const projectDirectory = path.resolve(context.directory)
    const assetRoot = path.resolve(projectDirectory, ".mirror", "prd", "assets")
    const assetDirectory = path.join(assetRoot, args.asset_id)
    assertContained(projectDirectory, assetDirectory)
    try {
      const existing = await fs.lstat(assetDirectory)
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new Error(`Mirror PRD asset ${args.asset_id} target must be one real directory`)
      }
      return JSON.stringify(
        await verifyExistingMaterialization({ projectDirectory, assetDirectory, expectedInput }),
        null,
        2,
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }

    const response = await context.host.fetch(url, { signal: context.abort })
    if (!response.ok) {
      throw new Error(`Mirror PRD asset request failed with HTTP ${response.status} for ${url.href}`)
    }
    const declaredLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > args.max_bytes) {
      throw new Error(`Mirror PRD asset exceeds max_bytes: ${declaredLength} > ${args.max_bytes}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0) throw new Error("Mirror PRD asset response is empty")
    if (bytes.byteLength > args.max_bytes) {
      throw new Error(`Mirror PRD asset exceeds max_bytes: ${bytes.byteLength} > ${args.max_bytes}`)
    }

    await fs.mkdir(assetRoot, { recursive: true })
    const stage = await fs.mkdtemp(path.join(assetRoot, `.stage-${args.asset_id}-`))
    const targetName = `asset.${args.extension}`
    const target = path.join(stage, targetName)
    const record = MaterializationRecordSchema.parse({
      schema_version: 1,
      input: expectedInput,
      local_path: normalizeProjectRelative(
        path.relative(projectDirectory, path.join(assetDirectory, targetName)),
      ),
      byte_length: bytes.byteLength,
      sha256: digest(bytes),
      media_type: response.headers.get("content-type") ?? "unknown",
    })
    try {
      await Promise.all([
        fs.writeFile(target, bytes, { flag: "wx" }),
        fs.writeFile(path.join(stage, PROVENANCE_FILE), `${JSON.stringify(record, null, 2)}\n`, {
          flag: "wx",
        }),
      ])
      try {
        await fs.rename(stage, assetDirectory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        return JSON.stringify(
          await verifyExistingMaterialization({ projectDirectory, assetDirectory, expectedInput }),
          null,
          2,
        )
      }
      return JSON.stringify(record, null, 2)
    } finally {
      await fs.rm(stage, { recursive: true, force: true })
    }
  },
})
