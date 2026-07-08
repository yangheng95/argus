import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { ControlTimeline } from "@/control/timeline"
import { deleteDecisionLogsForTasks } from "@/decision-log"
import { assertSessionPromptSubtreeFinished, cancelSessionPromptInScope } from "@/engine/cancellation-scope"
import { createTaskCancellationIncomplete } from "@/engine/cancellation-error"
import { EngineTaskTable } from "@/engine/engine.sql"
import { deleteProjectNotes } from "@/quicknote/service"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { SessionTable } from "@/session/session.sql"
import { CANCEL_CLEANUP_TIMEOUT_MS, EngineService } from "@/task-api"
import { withTimeout } from "@/util/await-with-timeout"
import { Database, eq } from "@/storage/db"
import { Instance } from "./instance"
import { Project } from "./project"
import { ProjectRuntimePaths } from "./runtime-paths"

export const ProjectDeleteResult = z
  .object({
    ok: z.boolean(),
    projectID: z.string(),
    directory: z.string(),
    deletedTaskCount: z.number().int().nonnegative(),
  })
  .meta({
    ref: "ProjectDeleteResult",
  })

export type ProjectDeleteResult = z.infer<typeof ProjectDeleteResult>

function assertProjectConfigDeleteTarget(projectDir: string, target: string): string {
  const projectRoot = path.resolve(projectDir)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(projectRoot, resolvedTarget)
  if (path.basename(resolvedTarget) !== ".opencorvus") {
    throw new Error(`Refusing to delete non-OpenCorvus project state directory: ${resolvedTarget}`)
  }
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to delete project state outside project root: ${resolvedTarget}`)
  }
  return resolvedTarget
}

async function removeProjectConfigRoot(projectDir: string): Promise<void> {
  const target = assertProjectConfigDeleteTarget(projectDir, ProjectRuntimePaths.projectConfigRoot(projectDir))
  await fs.rm(target, { recursive: true, force: false })
}

function projectTaskIDs(projectID: string): string[] {
  return Database.use((db) =>
    db
      .select({ id: EngineTaskTable.id })
      .from(EngineTaskTable)
      .where(eq(EngineTaskTable.project_id, projectID))
      .all()
      .map((row) => row.id),
  )
}

type ProjectPromptSession = {
  id: string
  directory: string
}

function projectPromptSessions(projectID: string): ProjectPromptSession[] {
  return Database.use((db) =>
    db
      .select({
        id: SessionTable.id,
        directory: SessionTable.directory,
      })
      .from(SessionTable)
      .where(eq(SessionTable.project_id, projectID))
      .orderBy(SessionTable.time_created, SessionTable.id)
      .all(),
  )
}

async function cancelRemainingProjectSessionPrompts(projectID: string): Promise<void> {
  const sessions = projectPromptSessions(projectID)
  const sessionIDs = sessions.map((session) => session.id)
  const cancelledSessions: ProjectPromptSession[] = []
  const failures: unknown[] = []

  TaskQueueService.cancelSessionPrompts({
    sessionIDs,
    reason: "project deleted",
  })

  for (const session of sessions.slice().reverse()) {
    try {
      if (
        cancelSessionPromptInScope({
          session,
          handle: "ProjectDelete.SessionPrompt.cancel",
        })
      ) {
        cancelledSessions.push(session)
      }
    } catch (error) {
      failures.push(error)
    }
  }

  try {
    await withTimeout(
      TaskQueueService.awaitSessionPromptsIdle({ sessionIDs }),
      CANCEL_CLEANUP_TIMEOUT_MS,
      "ProjectDelete.TaskQueueService.awaitSessionPromptsIdle",
    )
  } catch (cause) {
    throw createTaskCancellationIncomplete({
      handle: "ProjectDelete.TaskQueueService.awaitSessionPromptsIdle",
      cause,
    })
  }

  await assertSessionPromptSubtreeFinished({
    sessions: cancelledSessions,
    failures,
    handle: "ProjectDelete.SessionPrompt.cancel",
  })
}

function deleteProjectRows(projectID: string, taskIDs: string[]): void {
  Database.transaction((db) => {
    deleteDecisionLogsForTasks(taskIDs, db)
    ControlTimeline.deleteProjectMessages({ projectID }, db)
    deleteProjectNotes({ projectID }, db)
    Project.deleteRows([projectID], db)
    Database.effect(() => Database.incrementalVacuum())
  })
}

export async function deleteCurrentProject(): Promise<ProjectDeleteResult> {
  const projectID = Instance.project.id
  const directory = Instance.project.worktree
  const taskIDs = projectTaskIDs(projectID)

  for (const taskID of taskIDs) {
    await EngineService.deleteTask(taskID)
  }

  await cancelRemainingProjectSessionPrompts(projectID)
  await removeProjectConfigRoot(directory)
  deleteProjectRows(projectID, taskIDs)
  await Instance.dispose()

  return ProjectDeleteResult.parse({
    ok: true,
    projectID,
    directory,
    deletedTaskCount: taskIDs.length,
  })
}
