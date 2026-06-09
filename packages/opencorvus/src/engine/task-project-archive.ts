import fs from "fs/promises"
import path from "path"
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js"
import { EngineService } from "@/task-api"
import { Project } from "@/project/project"
import { Filesystem } from "@/util/filesystem"
import { git } from "@/util/git"
import { requireTask } from "./store"

export type TaskProjectArchive = {
  bytes: Uint8Array
  filename: string
  fileCount: number
}

export class TaskProjectArchiveUnsupportedProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaskProjectArchiveUnsupportedProjectError"
  }
}

type ExecutionFlow = {
  manifest: Record<string, unknown>
  task: Awaited<ReturnType<typeof EngineService.getTask>>
  board: Awaited<ReturnType<typeof EngineService.getBoard>>
  runs: Awaited<ReturnType<typeof EngineService.listRuns>>
  interactions: Awaited<ReturnType<typeof EngineService.listTaskInteractions>>
  artifacts: Array<{
    runID: string
    artifacts: Awaited<ReturnType<typeof EngineService.listArtifacts>>
  }>
  protocolEvents: Awaited<ReturnType<typeof EngineService.listProtocolEvents>>
  trace: Awaited<ReturnType<typeof EngineService.getTaskTrace>>
  transcript: unknown[]
}

function safeArchiveSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned || "task"
}

function zipPath(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/")
}

function parseGitNulList(output: string): string[] {
  return output
    .split("\0")
    .filter((item) => item.length > 0)
    .toSorted()
}

function assertRelativeProjectFile(relativePath: string): void {
  if (!relativePath) throw new Error("Empty project archive path")
  if (path.isAbsolute(relativePath)) throw new Error(`Absolute project archive path: ${relativePath}`)
  const normalized = path.normalize(relativePath)
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Project archive path escapes worktree: ${relativePath}`)
  }
}

async function listGitIncludedFiles(projectDir: string): Promise<string[]> {
  const result = await git(
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.quotepath=false",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ],
    { cwd: projectDir, timeoutProfile: "default" },
  )
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || result.stdout.toString().trim() || "git ls-files failed"
    throw new Error(`Project archive file listing failed: ${detail}`)
  }
  return parseGitNulList(result.text())
}

async function addJson(zip: ZipWriter<Blob>, name: string, value: unknown): Promise<void> {
  await zip.add(name, new TextReader(`${JSON.stringify(value, null, 2)}\n`))
}

async function addProjectFile(zip: ZipWriter<Blob>, projectDir: string, relativePath: string): Promise<void> {
  assertRelativeProjectFile(relativePath)
  const absolute = path.join(projectDir, relativePath)
  const stat = await fs.lstat(absolute)
  if (stat.isSymbolicLink()) return
  if (!stat.isFile()) return
  const data = new Uint8Array(await Filesystem.readArrayBuffer(absolute))
  await zip.add(zipPath("project", ...relativePath.split(/[\\/]+/)), new Uint8ArrayReader(data))
}

async function collectExecutionFlow(input: {
  taskID: string
  project: Project.Info
  fileCount: number
  transcript: unknown[]
}): Promise<ExecutionFlow> {
  const task = await EngineService.getTask(input.taskID)
  const board = await EngineService.getBoard(input.taskID)
  const runs = await EngineService.listRuns(input.taskID)
  const [interactions, protocolEvents, trace] = await Promise.all([
    EngineService.listTaskInteractions(input.taskID),
    EngineService.listProtocolEvents(input.taskID),
    EngineService.getTaskTrace(input.taskID),
  ])
  const artifacts = await Promise.all(
    runs.map(async (run) => ({
      runID: run.id,
      artifacts: await EngineService.listArtifacts(run.id),
    })),
  )
  const executionFiles = [
    "manifest.json",
    "task.json",
    "board.json",
    "runs.json",
    "interactions.json",
    "artifacts.json",
    "protocol-events.json",
    "trace.json",
    "transcript.json",
  ]
  const manifest = {
    schema: "opencorvus.task-project-archive.v1",
    exportedAt: new Date().toISOString(),
    taskID: input.taskID,
    project: {
      id: input.project.id,
      name: input.project.name,
      worktree: input.project.worktree,
    },
    projectFileRoot: "project/",
    projectFileSelection: "git ls-files --cached --others --exclude-standard -z -- .",
    projectFileCount: input.fileCount,
    executionFlowRoot: "opencorvus-task-execution-flow/",
    executionFiles,
  }
  return {
    manifest,
    task,
    board,
    runs,
    interactions,
    artifacts,
    protocolEvents,
    trace,
    transcript: input.transcript,
  }
}

export async function buildTaskProjectArchive(input: {
  taskID: string
  transcript: unknown[]
}): Promise<TaskProjectArchive> {
  const task = requireTask(input.taskID)
  const project = Project.get(task.project_id)
  if (!project) throw new Error(`Project not found for task ${input.taskID}: ${task.project_id}`)
  if (project.worktree === "/" || !Project.isGitRepo(project.worktree)) {
    throw new TaskProjectArchiveUnsupportedProjectError(
      `Task ${input.taskID} project is not a Git worktree and cannot be archived with gitignore semantics`,
    )
  }
  const files = await listGitIncludedFiles(project.worktree)
  const zip = new ZipWriter(new BlobWriter("application/zip"))
  for (const file of files) {
    await addProjectFile(zip, project.worktree, file)
  }
  const flow = await collectExecutionFlow({
    taskID: input.taskID,
    project,
    fileCount: files.length,
    transcript: input.transcript,
  })
  const flowRoot = "opencorvus-task-execution-flow"
  await addJson(zip, zipPath(flowRoot, "manifest.json"), flow.manifest)
  await addJson(zip, zipPath(flowRoot, "task.json"), flow.task)
  await addJson(zip, zipPath(flowRoot, "board.json"), flow.board)
  await addJson(zip, zipPath(flowRoot, "runs.json"), flow.runs)
  await addJson(zip, zipPath(flowRoot, "interactions.json"), flow.interactions)
  await addJson(zip, zipPath(flowRoot, "artifacts.json"), flow.artifacts)
  await addJson(zip, zipPath(flowRoot, "protocol-events.json"), flow.protocolEvents)
  await addJson(zip, zipPath(flowRoot, "trace.json"), flow.trace)
  await addJson(zip, zipPath(flowRoot, "transcript.json"), flow.transcript)

  const blob = await zip.close()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return {
    bytes,
    filename: `${safeArchiveSegment(input.taskID)}-project.zip`,
    fileCount: files.length,
  }
}
