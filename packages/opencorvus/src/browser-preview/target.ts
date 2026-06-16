import path from "node:path"
import z from "zod"
import { isBrowserPreviewTargetVisible } from "./liveness"
import {
  latestBrowserPreviewEvidenceIDs,
  findRecentBrowserPreviewTargets,
  type PersistedBrowserPreviewTarget,
} from "./persist"
import { BROWSER_PREVIEW_VIEWPORTS, BrowserPreviewViewport, BrowserPreviewViewportID } from "./viewport"

export const BrowserPreviewCandidate = z.object({
  id: z.string(),
  url: z.string(),
  source: z.literal("task-artifact"),
  selected: z.boolean(),
  timeUpdated: z.number(),
})

export type BrowserPreviewCandidate = z.infer<typeof BrowserPreviewCandidate>

export const BrowserPreviewTarget = z.object({
  id: z.string().optional(),
  taskID: z.string().optional(),
  latestEvidenceIDs: z
    .object({
      desktop: z.string().optional(),
      tablet: z.string().optional(),
      mobile: z.string().optional(),
    })
    .optional(),
  kind: z.enum(["task-url", "missing", "failed"]),
  status: z.enum(["ready", "missing", "failed"]),
  projectRoot: z.string(),
  url: z.string().optional(),
  viewports: BrowserPreviewViewport.array(),
  diagnostics: z.string().array(),
  candidates: BrowserPreviewCandidate.array(),
  source: z.enum(["task-artifact", "none"]),
})

export type BrowserPreviewTarget = z.infer<typeof BrowserPreviewTarget>

export async function resolveBrowserPreviewTarget(input: {
  projectRoot: string
  taskID: string
  isVisible?: (url: string) => Promise<boolean>
}): Promise<BrowserPreviewTarget> {
  const projectRoot = path.resolve(input.projectRoot)
  const taskID = input.taskID.trim()
  const persistedTargets = findRecentBrowserPreviewTargets(taskID)
  if (persistedTargets.length === 0) return missingBrowserPreviewTarget({ projectRoot, taskID })
  const assessed = await assessBrowserPreviewTargets(persistedTargets, input.isVisible)
  const reachableTargets = assessed.filter((item) => item.visible).map((item) => item.target)
  const persisted = reachableTargets[0]
  const unreachableDiagnostics = assessed
    .filter((item) => !item.visible)
    .map((item) => `Saved browser preview target is unreachable: ${item.target.url}`)
  if (!persisted) {
    const latest = persistedTargets[0]
    return failedBrowserPreviewTarget({
      projectRoot,
      taskID,
      id: latest.id,
      url: latest.url,
      source: latest.source,
      diagnostics:
        unreachableDiagnostics.length > 0
          ? unreachableDiagnostics
          : ["Saved browser preview targets are not reachable."],
      candidates: browserPreviewCandidates(persistedTargets, latest.id),
    })
  }
  return taskBrowserPreviewTarget({
    projectRoot,
    taskID,
    id: persisted.id,
    url: persisted.url,
    candidates: browserPreviewCandidates(persistedTargets, persisted.id),
    diagnostics: [`Using task browser preview target ${persisted.id}.`, ...unreachableDiagnostics],
    latestEvidenceIDs: latestBrowserPreviewEvidenceIDs({ taskID, targetID: persisted.id }),
  })
}

export function taskBrowserPreviewTarget(input: {
  projectRoot: string
  taskID: string
  id: string
  url: string
  latestEvidenceIDs?: Partial<Record<BrowserPreviewViewportID, string>>
  diagnostics: string[]
  candidates?: BrowserPreviewCandidate[]
}): BrowserPreviewTarget {
  return {
    id: input.id,
    taskID: input.taskID,
    latestEvidenceIDs: input.latestEvidenceIDs,
    kind: "task-url",
    status: "ready",
    projectRoot: path.resolve(input.projectRoot),
    url: input.url,
    viewports: [...BROWSER_PREVIEW_VIEWPORTS],
    diagnostics: input.diagnostics,
    candidates: input.candidates ?? [],
    source: "task-artifact",
  }
}

export function missingBrowserPreviewTarget(input: {
  projectRoot: string
  taskID: string
  diagnostics?: string[]
}): BrowserPreviewTarget {
  return {
    kind: "missing",
    status: "missing",
    projectRoot: path.resolve(input.projectRoot),
    taskID: input.taskID,
    viewports: [...BROWSER_PREVIEW_VIEWPORTS],
    diagnostics: input.diagnostics ?? ["No browser preview target saved for this task."],
    candidates: [],
    source: "none",
  }
}

export function failedBrowserPreviewTarget(input: {
  projectRoot: string
  taskID: string
  id?: string
  url?: string
  source?: "task-artifact"
  candidates?: BrowserPreviewCandidate[]
  diagnostics: string[]
}): BrowserPreviewTarget {
  return {
    id: input.id,
    kind: "failed",
    status: "failed",
    projectRoot: path.resolve(input.projectRoot),
    taskID: input.taskID,
    url: input.url,
    viewports: [...BROWSER_PREVIEW_VIEWPORTS],
    diagnostics: input.diagnostics,
    candidates: input.candidates ?? [],
    source: input.source ?? "none",
  }
}

export function normalizeBrowserPreviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const raw = value.trim()
  if (!raw) return undefined
  const text = normalizeSchemeLessLoopbackUrl(raw) ?? raw
  if (!text) return undefined
  try {
    const url = new URL(text)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function normalizeSchemeLessLoopbackUrl(text: string): string | undefined {
  const match = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{1,5})(\/[^\s]*)?$/i.exec(text)
  if (!match) return undefined
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  return `http://${match[1]}:${port}${match[3] ?? "/"}`
}

async function assessBrowserPreviewTargets(
  targets: PersistedBrowserPreviewTarget[],
  isVisible: ((url: string) => Promise<boolean>) | undefined,
): Promise<Array<{ target: PersistedBrowserPreviewTarget; visible: boolean }>> {
  const probe = isVisible ?? ((url: string) => isBrowserPreviewTargetVisible({ url }))
  const result: Array<{ target: PersistedBrowserPreviewTarget; visible: boolean }> = []
  const concurrency = 4
  for (let index = 0; index < targets.length; index += concurrency) {
    const batch = targets.slice(index, index + concurrency)
    const visible = await Promise.all(batch.map((target) => probe(target.url)))
    for (let offset = 0; offset < batch.length; offset++) {
      result.push({ target: batch[offset], visible: visible[offset] === true })
    }
  }
  return result
}

function browserPreviewCandidates(
  targets: PersistedBrowserPreviewTarget[],
  selectedID: string,
): BrowserPreviewCandidate[] {
  return targets.map((target) => ({
    id: target.id,
    url: target.url,
    source: target.source,
    selected: target.id === selectedID,
    timeUpdated: target.timeUpdated,
  }))
}
