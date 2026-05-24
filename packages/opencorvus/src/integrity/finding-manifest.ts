import { createHash } from "node:crypto"

export type IntegrityManifestSource = {
  id?: string
  fingerprint?: string
  title?: string
  description?: string
  repair?: string
  evidence?: string[]
  filePaths?: string[]
  targetIDs?: string[]
  requirementIDs?: string[]
  specIDs?: string[]
  canonicalSymptom?: string
  affectedSymbols?: string[]
  verify?: string[]
}

export type IntegrityPriorManifestRef = {
  id: string
  fingerprint: string
  attemptNumber?: number
}

export function canonicalIntegritySymptom(input: IntegrityManifestSource): string {
  const explicit = normalizeDisplayText(input.canonicalSymptom)
  if (explicit) return explicit
  const title = normalizeDisplayText(input.title)
  const description = normalizeDisplayText(input.description)
  if (title && description && description !== title) return `${title}: ${description}`
  return title || description || normalizeDisplayText(input.repair) || normalizeDisplayText(input.id) || "Unspecified finding"
}

export function integrityFindingFingerprint(input: IntegrityManifestSource): string {
  const seed = {
    symptom: normalizeHashText(canonicalIntegritySymptom(input)),
    files: stableList(input.filePaths),
    targets: stableList(input.targetIDs),
    requirements: stableList(input.requirementIDs),
    specs: stableList(input.specIDs),
    symbols: stableList(input.affectedSymbols),
  }
  return `if_${createHash("sha256").update(JSON.stringify(seed)).digest("hex").slice(0, 16)}`
}

export function defaultIntegrityVerify(input: IntegrityManifestSource): string[] {
  const explicit = stableList(input.verify)
  if (explicit.length > 0) return explicit
  const files = stableList(input.filePaths)
  const evidence = stableList(input.evidence)
  const repair = normalizeDisplayText(input.repair)
  const out: string[] = []
  if (files.length > 0) {
    out.push(`Inspect ${files.join(", ")} and confirm the defect surface is changed.`)
  }
  if (repair) {
    out.push(`Verify required repair: ${repair}`)
  }
  if (evidence.length > 0) {
    out.push(`Re-check prior evidence no longer reproduces: ${evidence.slice(0, 3).join(" | ")}`)
  }
  return out.length > 0 ? out : ["Verify the finding evidence no longer reproduces."]
}

export function buildPriorManifestIndex(
  priorAttempts: Array<{
    attemptNumber?: number
    findings?: IntegrityManifestSource[]
    requiredRepairs?: IntegrityManifestSource[]
  }>,
): Map<string, IntegrityPriorManifestRef> {
  const out = new Map<string, IntegrityPriorManifestRef>()
  for (const attempt of priorAttempts) {
    const items = [...(attempt.findings ?? []), ...(attempt.requiredRepairs ?? [])]
    for (const item of items) {
      const id = normalizeDisplayText(item.id)
      if (!id) continue
      const fingerprint = normalizeDisplayText(item.fingerprint) || integrityFindingFingerprint(item)
      out.set(fingerprint, { id, fingerprint, attemptNumber: attempt.attemptNumber })
    }
  }
  return out
}

export function stableList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((item) => (typeof item === "string" ? [normalizeDisplayText(item)] : [])))]
    .filter((item) => item.length > 0)
    .sort((a, b) => a.localeCompare(b))
}

function normalizeDisplayText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
}

function normalizeHashText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._:/#-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600)
}
