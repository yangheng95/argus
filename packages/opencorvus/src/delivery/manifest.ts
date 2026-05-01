import { createHash } from "node:crypto"
import { and, Database, desc, eq } from "@/storage/db"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Identifier } from "@/id/id"

export type DeliveryCheckStatus = "passed" | "failed" | "skipped"

export type DeliveryRequiredCheck = {
  id: string
  name: string
  label?: string
  family?: string
  command: string
  cwd?: string
  commandDigest: string
}

export type DeliveryCheckResult = DeliveryRequiredCheck & {
  status: DeliveryCheckStatus
  exitCode?: number
  outputExcerpt: string
  startedAt: number
  completedAt: number
  failureReason?: string
  failureSignature?: FailureSignature
}

export type FailureSignature = {
  checkId: string
  commandDigest: string
  normalizedError: string
  affectedFiles: string[]
}

export type DeliveryGateVerdict = {
  status: "passed" | "failed"
  summary: string
  failedCheckIds: string[]
}

export type DeliveryEvidenceManifest = {
  id: string
  taskId?: string
  runId?: string
  deliveryId?: string
  iteration: number
  headRef?: string
  requiredChecks: DeliveryRequiredCheck[]
  checkResults: DeliveryCheckResult[]
  changedFiles: string[]
  finalGate: DeliveryGateVerdict
  timeCreated: number
}

export function digestCommand(input: {
  command: string
  cwd?: string
  script?: string
}) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
}

export function failureSignatureForCheck(input: {
  check: DeliveryRequiredCheck
  output: string
  affectedFiles: string[]
}): FailureSignature {
  return {
    checkId: input.check.id,
    commandDigest: input.check.commandDigest,
    normalizedError: normalizeFailureOutput(input.output),
    affectedFiles: input.affectedFiles,
  }
}

function normalizeFailureOutput(output: string) {
  const withoutAnsi = output.replace(/\x1b\[[0-9;]*m/g, "")
  return withoutAnsi
    .replace(/[A-Z]:\\[^\s)]+/g, "<path>")
    .replace(/\/[^\s)]+/g, "<path>")
    .replace(/\b\d{2,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
}

export function validateDeliveryEvidenceManifest(
  manifest: DeliveryEvidenceManifest,
): DeliveryGateVerdict {
  const resultById = new Map(manifest.checkResults.map((item) => [item.id, item]))
  const failedCheckIds: string[] = []

  for (const required of manifest.requiredChecks) {
    const result = resultById.get(required.id)
    if (!result) {
      failedCheckIds.push(required.id)
      continue
    }
    if (result.commandDigest !== required.commandDigest) {
      failedCheckIds.push(required.id)
      continue
    }
    if (result.status !== "passed") {
      failedCheckIds.push(required.id)
    }
  }

  return {
    status: failedCheckIds.length === 0 ? "passed" : "failed",
    failedCheckIds,
    summary: failedCheckIds.length === 0
      ? `Delivery evidence gate passed ${manifest.requiredChecks.length} required check(s).`
      : `Delivery evidence gate failed ${failedCheckIds.length} required check(s).`,
  }
}

export function persistDeliveryEvidenceManifest(input: {
  manifest: DeliveryEvidenceManifest
}) {
  if (!input.manifest.taskId || !input.manifest.runId || !input.manifest.deliveryId) {
    return
  }
  Database.use((db) =>
    db.insert(EngineArtifactTable).values({
      id: input.manifest.id,
      task_id: input.manifest.taskId!,
      run_id: input.manifest.runId!,
      delivery_id: input.manifest.deliveryId!,
      kind: "delivery_evidence_manifest",
      label: "delivery-evidence-manifest",
      payload: input.manifest,
      time_created: input.manifest.timeCreated,
      time_updated: input.manifest.timeCreated,
    }).run(),
  )
}

export function findLatestDeliveryEvidenceManifest(input: {
  deliveryID: string
}): DeliveryEvidenceManifest | undefined {
  const row = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.delivery_id, input.deliveryID),
        eq(EngineArtifactTable.kind, "delivery_evidence_manifest"),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  return row?.payload as DeliveryEvidenceManifest | undefined
}

export function createManifestId() {
  return Identifier.ascending("artifact")
}
