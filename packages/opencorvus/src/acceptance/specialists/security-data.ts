import fs from "node:fs/promises"
import path from "node:path"
import {
  createAcceptanceSpecialistReview,
  type AcceptanceReviewFinding,
  type AcceptanceSpecialistReview,
} from "../specialist-review"
import type { AcceptanceSurfaceManifest } from "../surface-detector"

export async function runSecurityDataReview(input: {
  taskID?: string
  runID?: string
  acceptanceID?: string
  projectRoot: string
  surfaceManifest: AcceptanceSurfaceManifest
  goals?: Array<{ requirement_ids?: string[] }>
}): Promise<AcceptanceSpecialistReview | undefined> {
  if (!input.surfaceManifest.surfaces.includes("security_data")) return undefined
  if (!input.taskID || !input.runID || !input.acceptanceID) return undefined

  const files = securityFiles(input.surfaceManifest)
  const texts = await Promise.all(
    files.map(async (file) => ({
      file,
      text: await fs.readFile(path.join(input.projectRoot, file), "utf8").catch(() => ""),
    })),
  )
  const findings: AcceptanceReviewFinding[] = []
  if (files.length === 0 && securityDependencies(input.surfaceManifest).length === 0) {
    findings.push({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: "Security/data surface was selected without dependency or file evidence.",
      evidence: [{
        kind: "log",
        ref: input.surfaceManifest.id,
        excerpt: "security_data selected but no security refs were present",
      }],
      affectedRequirementIDs: requirementIDs(input.goals),
    })
  }

  for (const item of texts) {
    const secret = hardcodedSecret(item.text)
    if (secret) {
      findings.push({
        proposedSeverity: "blocking",
        category: "security",
        claim: `Security-sensitive file ${item.file} contains a hardcoded secret-like value.`,
        evidence: [{ kind: "file", ref: item.file, excerpt: secret }],
        affectedRequirementIDs: requirementIDs(input.goals),
      })
    }
    if (unsafeUploadPath(item.text)) {
      findings.push({
        proposedSeverity: "blocking",
        category: "security",
        claim: `Upload/file path handling in ${item.file} uses user-controlled filenames without basename normalization.`,
        evidence: [{ kind: "file", ref: item.file, excerpt: excerpt(item.text, "originalname") }],
        affectedRequirementIDs: requirementIDs(input.goals),
      })
    }
    if (destructiveDataOperation(item.text)) {
      findings.push({
        proposedSeverity: "blocking",
        category: "data_integrity",
        claim: `Data access file ${item.file} contains an unconditional destructive operation.`,
        evidence: [{ kind: "file", ref: item.file, excerpt: excerpt(item.text, "deleteMany") }],
        affectedRequirementIDs: requirementIDs(input.goals),
      })
    }
  }

  return createAcceptanceSpecialistReview({
    taskId: input.taskID,
    runId: input.runID,
    acceptanceId: input.acceptanceID,
    reviewer: "security_data",
    executionStatus: "completed",
    summary: findings.length === 0
      ? `Security/data review passed with ${files.length} file evidence ref(s).`
      : `Security/data review found ${findings.length} issue(s).`,
    findings,
    evidenceRefs: evidenceRefs(input.surfaceManifest, files),
    reviewedSurfaces: ["security_data"],
  })
}

function securityFiles(manifest: AcceptanceSurfaceManifest) {
  return [...new Set(
    manifest.evidence
      .filter((item) => item.surface === "security_data")
      .flatMap((item) => item.refs)
      .filter((ref) => ref.kind === "file")
      .map((ref) => ref.ref)
      .filter((ref): ref is string => typeof ref === "string" && ref.length > 0),
  )].sort()
}

function securityDependencies(manifest: AcceptanceSurfaceManifest) {
  return manifest.evidence
    .filter((item) => item.surface === "security_data")
    .flatMap((item) => item.refs)
    .filter((ref) => ref.kind === "dependency")
    .map((ref) => ref.ref)
}

function hardcodedSecret(text: string) {
  const patterns = [
    /\b(?:API_KEY|SECRET|TOKEN|JWT_SECRET|PASSWORD)\b\s*[:=]\s*["'`]([^"'`]{8,})["'`]/i,
    /\bsk-[a-zA-Z0-9_-]{16,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ]
  const match = patterns
    .map((pattern) => text.match(pattern))
    .find((item): item is RegExpMatchArray => Boolean(item))
  if (!match) return undefined
  return match[0].slice(0, 300)
}

function unsafeUploadPath(text: string) {
  return /\boriginalname\b/.test(text)
    && /\bpath\.join\b|\bwriteFile\b|\bcreateWriteStream\b/.test(text)
    && !/\bpath\.basename\b|\bsanitize(?:File)?Name\b/.test(text)
}

function destructiveDataOperation(text: string) {
  return /\bdeleteMany\s*\(\s*\{\s*\}\s*\)/.test(text)
    || /\bDROP\s+TABLE\b/i.test(text)
    || /\bTRUNCATE\s+TABLE\b/i.test(text)
}

function evidenceRefs(manifest: AcceptanceSurfaceManifest, files: string[]) {
  const refs = [
    ...manifest.evidence
      .filter((item) => item.surface === "security_data")
      .flatMap((item) => item.refs.map((ref) => `${ref.kind}:${ref.ref}`)),
    ...files.map((file) => `file:${file}`),
  ]
  if (refs.length === 0) refs.push(`surface:${manifest.id}`)
  return [...new Set(refs)].sort()
}

function requirementIDs(goals?: Array<{ requirement_ids?: string[] }>) {
  return [...new Set((goals ?? []).flatMap((goal) => goal.requirement_ids ?? []))].sort()
}

function excerpt(text: string, marker: string) {
  const index = text.indexOf(marker)
  if (index < 0) return text.slice(0, 300)
  return text.slice(Math.max(0, index - 120), index + 180)
}
