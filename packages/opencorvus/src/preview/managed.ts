import path from "node:path"
import { discoverPackageRoot } from "@/delivery/checks/discovery"
import {
  ensureProjectReadyForRuntime,
  type ProjectRuntimeReadiness,
} from "@/delivery/checks/runtime-readiness"
import {
  ensureManagedPreviewSession,
  getManagedPreviewSession,
  type ManagedPreviewSession,
} from "./session"

export class ManagedPreviewStartError extends Error {
  readonly projectRoot: string
  readonly evidence: string[]
  readonly session?: ManagedPreviewSession
  readonly readiness?: ProjectRuntimeReadiness

  constructor(input: {
    message: string
    projectRoot: string
    evidence: string[]
    session?: ManagedPreviewSession
    readiness?: ProjectRuntimeReadiness
  }) {
    super(input.message)
    this.name = "ManagedPreviewStartError"
    this.projectRoot = input.projectRoot
    this.evidence = input.evidence
    this.session = input.session
    this.readiness = input.readiness
  }
}

export async function resolveManagedPreviewProjectRoot(input: {
  workspaceDir: string
  changedFiles?: string[]
}): Promise<string> {
  const workspaceDir = path.resolve(input.workspaceDir)
  const discovered = await discoverPackageRoot(input.changedFiles)
  return path.resolve(discovered || workspaceDir)
}

export async function startManagedPreview(input: {
  taskID?: string
  workspaceDir: string
  changedFiles?: string[]
  metadata?: Record<string, unknown>
  projectRoot?: string
  readiness?: ProjectRuntimeReadiness
}): Promise<{
  projectRoot: string
  readiness: ProjectRuntimeReadiness
  session: ManagedPreviewSession
}> {
  const projectRoot = input.projectRoot
    ? path.resolve(input.projectRoot)
    : await resolveManagedPreviewProjectRoot({
        workspaceDir: input.workspaceDir,
        changedFiles: input.changedFiles,
      })
  const readiness = input.readiness ?? await ensureProjectReadyForRuntime({ projectRoot })
  const readinessEvidence = [
    `resolved_project_root=${projectRoot}`,
    `runtime_readiness=${readiness.status}`,
    ...readiness.failedReadinessIds.map((id) => `runtime_readiness_failed=${id}`),
  ]

  if (readiness.status !== "passed") {
    throw new ManagedPreviewStartError({
      message: `preview_runtime_readiness_failed: project_root=${projectRoot} failed_ids=${readiness.failedReadinessIds.join(",") || "none"}`,
      projectRoot,
      readiness,
      evidence: [...readinessEvidence, ...readiness.evidence],
    })
  }

  try {
    const session = await ensureManagedPreviewSession({
      taskID: input.taskID,
      workspaceDir: projectRoot,
      metadata: input.metadata,
    })
    return { projectRoot, readiness, session }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const session = getManagedPreviewSession({
      taskID: input.taskID,
      workspaceDir: projectRoot,
    })
    throw new ManagedPreviewStartError({
      message: reason,
      projectRoot,
      readiness,
      session,
      evidence: [
        ...readinessEvidence,
        ...(session?.command ? [`managed_preview_command=${session.command}`] : []),
        ...(session?.evidence ?? []),
        `preview_failure_reason=${reason}`,
      ],
    })
  }
}
