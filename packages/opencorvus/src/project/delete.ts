import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { ControlMessageTable } from "@/control/control.sql"
import { DecisionLogTable } from "@/decision-log/schema"
import { EngineTaskTable } from "@/engine/engine.sql"
import { QuickNoteTable } from "@/quicknote/quicknote.sql"
import { EngineService } from "@/task-api"
import { Database, eq, inArray } from "@/storage/db"
import { Instance } from "./instance"
import { ProjectTable } from "./project.sql"
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

function deleteProjectRows(projectID: string, taskIDs: string[]): void {
  Database.transaction((db) => {
    if (taskIDs.length > 0) {
      db.delete(DecisionLogTable).where(inArray(DecisionLogTable.task_id, taskIDs)).run()
    }
    db.delete(ControlMessageTable).where(eq(ControlMessageTable.project_id, projectID)).run()
    db.delete(QuickNoteTable).where(eq(QuickNoteTable.project_id, projectID)).run()
    db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run()
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
