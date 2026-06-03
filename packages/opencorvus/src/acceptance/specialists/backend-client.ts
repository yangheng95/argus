import fs from "node:fs/promises"
import path from "node:path"
import {
  createAcceptanceSpecialistReview,
  type AcceptanceReviewFinding,
  type AcceptanceSpecialistReview,
} from "../specialist-review"
import type { AcceptanceSurfaceManifest } from "../surface-detector"

type RouteInventory = {
  routeFiles: string[]
  clientFiles: string[]
  backendPaths: string[]
  clientPaths: string[]
}

export async function runBackendApiReview(input: {
  taskID?: string
  runID?: string
  acceptanceID?: string
  projectRoot?: string
  surfaceManifest: AcceptanceSurfaceManifest
  goals?: Array<{ requirement_ids?: string[] }>
}): Promise<AcceptanceSpecialistReview | undefined> {
  if (!input.surfaceManifest.surfaces.includes("backend_api")) return undefined
  if (!input.taskID || !input.runID || !input.acceptanceID) return undefined

  const inventory = await buildRouteInventory(
    input.projectRoot ?? input.surfaceManifest.projectRoot,
    input.surfaceManifest,
  )
  const findings: AcceptanceReviewFinding[] = []
  if (inventory.routeFiles.length === 0 && inventory.backendPaths.length === 0) {
    findings.push({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: "Backend API surface was selected without route file or route literal evidence.",
      evidence: [
        {
          kind: "log",
          ref: input.surfaceManifest.id,
          excerpt: "backend_api selected but route inventory is empty",
        },
      ],
      affectedRequirementIDs: requirementIDs(input.goals),
    })
  }

  return createAcceptanceSpecialistReview({
    taskId: input.taskID,
    runId: input.runID,
    acceptanceId: input.acceptanceID,
    reviewer: "backend_api",
    executionStatus: "completed",
    summary:
      findings.length === 0
        ? `Backend API review passed with ${inventory.routeFiles.length} route file(s).`
        : `Backend API review found ${findings.length} issue(s).`,
    findings,
    evidenceRefs: evidenceRefs(input.surfaceManifest, "backend_api", inventory),
    reviewedSurfaces: ["backend_api"],
  })
}

export async function runClientContractReview(input: {
  taskID?: string
  runID?: string
  acceptanceID?: string
  projectRoot?: string
  surfaceManifest: AcceptanceSurfaceManifest
  goals?: Array<{
    requirement_ids?: string[]
  }>
}): Promise<AcceptanceSpecialistReview | undefined> {
  if (!input.surfaceManifest.surfaces.includes("client_contract")) return undefined
  if (!input.taskID || !input.runID || !input.acceptanceID) return undefined

  const inventory = await buildRouteInventory(
    input.projectRoot ?? input.surfaceManifest.projectRoot,
    input.surfaceManifest,
  )
  const findings: AcceptanceReviewFinding[] = []
  const backendPaths = new Set(inventory.backendPaths)
  const drift = inventory.clientPaths.filter((item) => !backendPaths.has(item))
  if (backendPaths.size > 0 && drift.length > 0) {
    findings.push({
      proposedSeverity: "blocking",
      category: "contract",
      claim: `Client calls endpoint(s) with no matching backend route: ${drift.join(", ")}`,
      evidence: [
        ...inventory.clientFiles.slice(0, 3).map((file) => ({
          kind: "file" as const,
          ref: file,
          excerpt: `client_paths=${inventory.clientPaths.join(", ")}`,
        })),
        ...inventory.routeFiles.slice(0, 3).map((file) => ({
          kind: "file" as const,
          ref: file,
          excerpt: `backend_paths=${inventory.backendPaths.join(", ")}`,
        })),
      ],
      affectedRequirementIDs: requirementIDs(input.goals),
    })
  }

  return createAcceptanceSpecialistReview({
    taskId: input.taskID,
    runId: input.runID,
    acceptanceId: input.acceptanceID,
    reviewer: "client_contract",
    executionStatus: "completed",
    summary:
      findings.length === 0
        ? inventory.clientFiles.length === 0 && inventory.clientPaths.length === 0
          ? "Client contract review skipped blocking checks because no concrete client file or endpoint evidence was present."
          : `Client contract review passed with ${inventory.clientFiles.length} client file(s).`
        : `Client contract review found ${findings.length} issue(s).`,
    findings,
    evidenceRefs: evidenceRefs(input.surfaceManifest, "client_contract", inventory),
    reviewedSurfaces: ["client_contract"],
  })
}

async function buildRouteInventory(projectRoot: string, manifest: AcceptanceSurfaceManifest): Promise<RouteInventory> {
  const routeFiles = refsFor(manifest, "backend_api", ["route", "file"])
  const clientFiles = refsFor(manifest, "client_contract", ["file"])
  const routeTexts = await readRefs(projectRoot, routeFiles)
  const clientTexts = await readRefs(projectRoot, clientFiles)
  return {
    routeFiles,
    clientFiles,
    backendPaths: [...new Set(routeTexts.flatMap((item) => endpointLiterals(item.text)))].sort(),
    clientPaths: [...new Set(clientTexts.flatMap((item) => endpointLiterals(item.text)))].sort(),
  }
}

function refsFor(
  manifest: AcceptanceSurfaceManifest,
  surface: "backend_api" | "client_contract",
  kinds: Array<"file" | "route">,
) {
  return [
    ...new Set(
      manifest.evidence
        .filter((item) => item.surface === surface)
        .flatMap((item) => item.refs)
        .filter((ref) => kinds.includes(ref.kind as "file" | "route"))
        .map((ref) => ref.ref)
        .filter((ref): ref is string => typeof ref === "string" && ref.length > 0),
    ),
  ].sort()
}

function requirementIDs(goals?: Array<{ requirement_ids?: string[] }>) {
  return [...new Set((goals ?? []).flatMap((goal) => goal.requirement_ids ?? []))].sort()
}

async function readRefs(root: string, refs: string[]) {
  return await Promise.all(
    refs.map(async (ref) => ({
      ref,
      text: await fs.readFile(path.join(root, ref), "utf8").catch(() => ""),
    })),
  )
}

function endpointLiterals(text: string) {
  const matches = text.matchAll(/["'`]((?:\/api)?\/[a-zA-Z0-9_./:-]+)["'`]/g)
  return [...matches].map((match) => normalizeEndpoint(match[1] ?? "")).filter((item) => item.length > 1)
}

function normalizeEndpoint(input: string) {
  return input
    .replace(/\/:[a-zA-Z0-9_]+/g, "/:param")
    .replace(/\/\$\{[^}]+\}/g, "/:param")
    .replace(/\/+$/g, "")
}

function evidenceRefs(
  manifest: AcceptanceSurfaceManifest,
  surface: "backend_api" | "client_contract",
  inventory: RouteInventory,
) {
  const refs = [
    ...manifest.evidence
      .filter((item) => item.surface === surface)
      .flatMap((item) => item.refs.map((ref) => `${ref.kind}:${ref.ref}`)),
    ...inventory.backendPaths.map((item) => `route:${item}`),
    ...inventory.clientPaths.map((item) => `client:${item}`),
  ]
  if (refs.length === 0) refs.push(`surface:${manifest.id}`)
  return [...new Set(refs)].sort()
}
