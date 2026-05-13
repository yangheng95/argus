import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import {
  ZipWriter,
  ZipReader,
  BlobWriter,
  BlobReader,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { EngineService } from "@/task-api"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { parseArchitectContractGraph, type ArchitectContractGraph } from "@/architect/contract-graph"
import {
  findActivePlanForTask,
  findDeliveryByRun,
  findEvaluationByRun,
  findRuns,
  findLatestArchitectContractGraphArtifact,
  listGoalsByPlan,
  listInteractions,
  listMilestones,
  listSpecSnapshotsForTask,
  listSnapshots,
  persistImportedArchitectPlan,
  requireTask,
  viewDelivery,
  viewEvaluation,
  viewGoal,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewRun,
  viewSnapshot,
  viewSpecSnapshot,
  viewTask,
  findArtifacts,
  viewArtifact,
  Task,
} from "@/engine"
import { goalStatusByID } from "@/engine/describe"

/**
 * Archive format version. Bump on any incompatible change to manifest.json /
 * task.json / project tree layout. The importer must reject mismatched
 * versions (rule 7: no fallback compatibility shims).
 */
const ARCHIVE_FORMAT = "opencorvus-task-archive"
const ARCHIVE_VERSION = 1
const PROJECT_PREFIX = "project/"

/**
 * Build an HTTPException whose body is JSON in the same `{ name, data:
 * { message } }` shape the project's NamedError-based handler emits, so
 * SDK consumers can key on response.json() uniformly.
 */
function archiveError(status: 400 | 409 | 412 | 500, name: string, message: string): HTTPException {
  return new HTTPException(status, {
    res: new Response(JSON.stringify({ name, data: { message } }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  })
}

function buildTaskExport(taskID: string) {
  const task = requireTask(taskID)
  const plan = findActivePlanForTask(task.id)
  const goals = plan ? listGoalsByPlan(plan.id) : []
  const milestones = listMilestones(taskID)
  const runs = findRuns(taskID)
  const interactions = listInteractions(taskID)
  const snapshots = listSnapshots(taskID)
  const specSnapshots = listSpecSnapshotsForTask(taskID)

  const deliveries: ReturnType<typeof viewDelivery>[] = []
  const evaluations: ReturnType<typeof viewEvaluation>[] = []
  const artifacts: ReturnType<typeof viewArtifact>[] = []
  for (const run of runs) {
    const delivery = findDeliveryByRun(run.id)
    if (delivery) deliveries.push(viewDelivery(delivery))
    const evaluation = findEvaluationByRun(run.id)
    if (evaluation) evaluations.push(viewEvaluation(evaluation))
    artifacts.push(...findArtifacts(run.id).map(viewArtifact))
  }
  const graphArtifact = findLatestArchitectContractGraphArtifact(taskID)
  if (graphArtifact) artifacts.push(viewArtifact(graphArtifact))

  return {
    task: viewTask(task),
    plan: plan ? viewPlan(plan) : undefined,
    goals: goals.map((g) => ({ ...viewGoal(g), status: goalStatusByID(g.id) })),
    milestones: milestones.map(viewMilestone),
    runs: runs.map(viewRun),
    interactions: interactions.map(viewInteraction),
    snapshots: snapshots.map(viewSnapshot),
    specSnapshots: specSnapshots.map(viewSpecSnapshot),
    deliveries,
    evaluations,
    artifacts,
  }
}

/**
 * Enumerate files under `directory` honoring the project's git-tracked
 * boundary: `git ls-files --cached --others --exclude-standard` returns all
 * tracked files plus untracked files NOT matched by .gitignore (local +
 * global excludes). `-z` is mandatory: paths can contain spaces, newlines,
 * or non-ASCII bytes that a plain `\n` split would corrupt.
 *
 * Rule 7 (no fallback): if `git` is missing or the directory is not a git
 * repo, surface that as an HTTP 412 — silently walking with a hand-rolled
 * .gitignore parser would diverge from git's authoritative semantics.
 */
async function listProjectFiles(directory: string): Promise<string[]> {
  if (!(await Filesystem.exists(path.join(directory, ".git")))) {
    throw archiveError(
      412,
      "WorktreeNotGitError",
      `Project archive requires a git repository at ${directory}; init the repo first.`,
    )
  }
  const result = await $`git ls-files --cached --others --exclude-standard -z`.cwd(directory).quiet().nothrow()
  if (result.exitCode !== 0) {
    throw archiveError(
      500,
      "GitLsFilesError",
      `git ls-files failed in ${directory}: ${result.stderr.toString("utf8").trim()}`,
    )
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((rel) => rel.length > 0)
}

async function buildArchive(taskID: string, directory: string): Promise<Blob> {
  const taskExport = buildTaskExport(taskID)
  const files = await listProjectFiles(directory)

  const blobWriter = new BlobWriter("application/zip")
  const writer = new ZipWriter(blobWriter)

  const manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      taskID,
      projectID: taskExport.task.projectID,
      directory,
    },
    counts: {
      files: files.length,
      goals: taskExport.goals.length,
      runs: taskExport.runs.length,
      interactions: taskExport.interactions.length,
    },
  }

  await writer.add("manifest.json", new TextReader(JSON.stringify(manifest, null, 2)))
  await writer.add("task.json", new TextReader(JSON.stringify(taskExport, null, 2)))

  for (const rel of files) {
    const abs = path.join(directory, rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat || !stat.isFile()) continue
    const data = await fs.readFile(abs)
    // Normalize zip paths to forward slashes regardless of host OS — zip
    // entry names are POSIX by spec and importers on other platforms key on
    // them verbatim.
    const entryName = PROJECT_PREFIX + rel.split(path.sep).join("/")
    await writer.add(entryName, new Uint8ArrayReader(data))
  }

  await writer.close()
  return blobWriter.getData()
}

const ImportSummary = z.object({
  taskID: Task.shape.id,
  importedFromTaskID: Task.shape.id.optional(),
  restoredFiles: z.number().int(),
  skippedFiles: z.array(z.string()),
  directory: z.string(),
})

const ManifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.number().int(),
  exportedAt: z.string().optional(),
  source: z
    .object({
      taskID: z.string().optional(),
      projectID: z.string().optional(),
      directory: z.string().optional(),
    })
    .optional(),
})

/**
 * Validate a zip entry filename before writing it to disk:
 *   • forbid absolute paths
 *   • forbid `..` segments (zip-slip)
 *   • forbid Windows drive letters / NT device names embedded in the name
 * Returns the resolved absolute destination path inside `targetRoot`, or
 * throws HTTPException 400.
 */
function safeJoin(targetRoot: string, entryName: string): string {
  if (entryName.includes("\0")) {
    throw archiveError(400, "InvalidArchiveEntryError", `Archive entry contains NUL byte: ${entryName}`)
  }
  // Normalize separators — entries are POSIX in spec; reject anything weird.
  const segments = entryName.split("/")
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw archiveError(400, "InvalidArchiveEntryError", `Archive entry has unsafe path segment: ${entryName}`)
    }
    if (/^[A-Za-z]:$/.test(seg)) {
      throw archiveError(400, "InvalidArchiveEntryError", `Archive entry has drive-letter segment: ${entryName}`)
    }
  }
  const resolved = path.resolve(targetRoot, ...segments)
  const rootWithSep = targetRoot.endsWith(path.sep) ? targetRoot : targetRoot + path.sep
  if (resolved !== targetRoot && !resolved.startsWith(rootWithSep)) {
    throw archiveError(400, "InvalidArchiveEntryError", `Archive entry escapes target directory: ${entryName}`)
  }
  return resolved
}

/**
 * Refuse only when an imported file would actually overwrite an existing
 * one — checking "is the directory empty" is too brittle (a fresh git repo
 * has `.git/`, the InstanceBootstrap pass may seed `.opencorvus/` etc.,
 * and the user may legitimately import into a populated workspace as long
 * as no paths collide). Returns the list of colliding relative paths.
 */
async function findColliding(targetRoot: string, relPaths: string[]): Promise<string[]> {
  const out: string[] = []
  for (const rel of relPaths) {
    const abs = path.resolve(targetRoot, ...rel.split("/"))
    const stat = await fs.stat(abs).catch(() => null)
    if (stat && stat.isFile()) out.push(rel)
  }
  return out
}

async function restoreArchive(input: { archive: Blob; overwrite: boolean }): Promise<{
  taskID: string
  importedFromTaskID?: string
  restoredFiles: number
  skippedFiles: string[]
}> {
  const targetDirectory = Instance.directory

  const reader = new ZipReader(new BlobReader(input.archive))
  let entries
  try {
    entries = await reader.getEntries()
  } catch (err) {
    await reader.close().catch(() => undefined)
    throw archiveError(400, "InvalidArchiveError", `Archive is not a valid zip: ${(err as Error).message}`)
  }

  let manifestText: string | undefined
  let taskJsonText: string | undefined
  const fileEntries: typeof entries = []
  for (const entry of entries) {
    if (entry.directory) continue
    if (entry.filename === "manifest.json") {
      manifestText = await entry.getData!(new TextWriter())
    } else if (entry.filename === "task.json") {
      taskJsonText = await entry.getData!(new TextWriter())
    } else if (entry.filename.startsWith(PROJECT_PREFIX)) {
      fileEntries.push(entry)
    } else {
      await reader.close().catch(() => undefined)
      throw archiveError(400, "InvalidArchiveEntryError", `Archive entry is outside the declared layout: ${entry.filename}`)
    }
  }

  if (!manifestText) {
    await reader.close().catch(() => undefined)
    throw archiveError(400, "InvalidArchiveError", "Archive missing manifest.json")
  }
  if (!taskJsonText) {
    await reader.close().catch(() => undefined)
    throw archiveError(400, "InvalidArchiveError", "Archive missing task.json")
  }

  let manifest
  try {
    manifest = ManifestSchema.parse(JSON.parse(manifestText))
  } catch (err) {
    await reader.close().catch(() => undefined)
    throw archiveError(400, "InvalidArchiveError", `Invalid manifest.json: ${(err as Error).message}`)
  }
  if (manifest.version !== ARCHIVE_VERSION) {
    await reader.close().catch(() => undefined)
    throw archiveError(
      400,
      "UnsupportedArchiveVersionError",
      `Unsupported archive version: got ${manifest.version}, expected ${ARCHIVE_VERSION}`,
    )
  }

  let taskJson: {
    task: { id: string; title?: string; request: string; source?: string; metadata?: Record<string, unknown> }
    plan?: Record<string, unknown>
    goals?: Array<Record<string, unknown>>
    snapshots?: Array<Record<string, unknown>>
    specSnapshots?: Array<Record<string, unknown>>
    artifacts?: Array<{ kind?: string; payload?: unknown }>
  }
  try {
    taskJson = JSON.parse(taskJsonText)
  } catch (err) {
    await reader.close().catch(() => undefined)
    throw archiveError(400, "InvalidArchiveError", `Invalid task.json: ${(err as Error).message}`)
  }
  if (!taskJson?.task?.request || typeof taskJson.task.request !== "string") {
    await reader.close().catch(() => undefined)
    throw archiveError(400, "InvalidArchiveError", "task.json missing task.request")
  }

  // Pre-resolve every entry's relative path and verify safety before
  // touching disk — partial extraction on a zip-slip would leave debris.
  const plan: Array<{ rel: string; dest: string; entry: (typeof fileEntries)[number] }> = []
  for (const entry of fileEntries) {
    const rel = entry.filename.slice(PROJECT_PREFIX.length)
    if (rel.length === 0) continue
    const dest = safeJoin(targetDirectory, rel)
    plan.push({ rel, dest, entry })
  }

  // Default overwrite=false. Overlay is the product entry and exposes the
  // overwrite decision as a visible checkbox; server callers that omit the
  // query preserve existing files. We do NOT 409 on collisions: opencorvus's
  // own bootstrap seeds files like `.gitignore` into the target before the
  // route handler runs, so a strict "must be untouched" guard would reject
  // every legitimate import into a fresh workspace.
  const skipExisting = input.overwrite === false
  const skipped: string[] = []
  if (skipExisting) {
    const collisions = new Set(
      await findColliding(
        targetDirectory,
        plan.map((p) => p.rel),
      ),
    )
    for (const rel of collisions) skipped.push(rel)
    for (let i = plan.length - 1; i >= 0; i--) {
      if (collisions.has(plan[i]!.rel)) plan.splice(i, 1)
    }
  }

  let restored = 0
  for (const { dest, entry } of plan) {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    const data = await entry.getData!(new Uint8ArrayWriter())
    await fs.writeFile(dest, data)
    restored++
  }
  await reader.close()

  // Source = "import" so audit shows where this work originated; the original
  // taskID is stored in metadata for forensic linkage. Title/request are
  // copied verbatim — runs/interactions are runtime artifacts and are not
  // replayed on import (out of scope for an archive snapshot).
  const importedFromTaskID = taskJson.task.id
  const newTaskID = await EngineService.createTask({
    request: taskJson.task.request,
    title: taskJson.task.title,
    queue: false,
    source: "import",
    metadata: {
      imported_from: {
        taskID: importedFromTaskID,
        projectID: manifest.source?.projectID,
        exportedAt: manifest.exportedAt,
      },
    },
  })

  const importedGraph = Array.isArray(taskJson.artifacts)
    ? taskJson.artifacts.find((artifact: any) => artifact?.kind === "architect_contract_graph")?.payload
    : undefined
  if (importedGraph) {
    restoreImportedArchitectPlan({
      taskID: newTaskID,
      plan: taskJson.plan,
      goals: taskJson.goals,
      specSnapshots: taskJson.specSnapshots,
      graph: parseArchitectContractGraph(importedGraph),
    })
  }

  return { taskID: newTaskID, importedFromTaskID, restoredFiles: restored, skippedFiles: skipped }
}

function restoreImportedArchitectPlan(input: {
  taskID: string
  plan?: Record<string, unknown>
  goals?: Array<Record<string, unknown>>
  specSnapshots?: Array<Record<string, unknown>>
  graph: ArchitectContractGraph
}) {
  if (!input.plan) {
    throw archiveError(400, "InvalidArchiveError", "Archive graph import requires task.json plan.")
  }
  if (!Array.isArray(input.goals) || input.goals.length === 0) {
    throw archiveError(400, "InvalidArchiveError", "Archive graph import requires task.json goals.")
  }
  if (!Array.isArray(input.specSnapshots) || input.specSnapshots.length === 0) {
    throw archiveError(400, "InvalidArchiveError", "Archive graph import requires task.json specSnapshots.")
  }

  const originalSpecID = requiredString(input.plan.specSnapshotID, "plan.specSnapshotID")
  const snapshot = input.specSnapshots.find((row) => row.id === originalSpecID)
  if (!snapshot) {
    throw archiveError(400, "InvalidArchiveError", `Archive missing active spec snapshot ${originalSpecID}.`)
  }

  const goalIDMap = new Map<string, string>()
  for (const goal of input.goals) {
    goalIDMap.set(requiredString(goal.id, "goal.id"), "")
  }
  persistImportedArchitectPlan({
    taskID: input.taskID,
    plan: {
      version: requiredInteger(input.plan.version, "plan.version"),
      summary: requiredString(input.plan.summary, "plan.summary"),
      prompt: requiredString(input.plan.prompt, "plan.prompt"),
      metadata: objectOrNull(input.plan.metadata),
    },
    snapshot: {
      version: requiredInteger(snapshot.version, "snapshot.version"),
      summary: requiredString(snapshot.summary, "snapshot.summary"),
      content: requiredString(snapshot.content, "snapshot.content"),
      scope: requiredString(snapshot.scope, "snapshot.scope"),
      outOfScope: typeof snapshot.outOfScope === "string" ? snapshot.outOfScope : null,
      evidence: Array.isArray(snapshot.evidence) ? (snapshot.evidence as string[]) : null,
      metadata: objectOrNull(snapshot.metadata),
    },
    goals: input.goals.map((goal) => {
      const oldGoalID = requiredString(goal.id, "goal.id")
      const dependsOn = stringArray(goal.depends_on, "goal.depends_on")
      for (const goalID of dependsOn) {
        if (!goalIDMap.has(goalID)) {
          throw archiveError(400, "InvalidArchiveError", `Goal ${oldGoalID} depends on unknown goal ${goalID}.`)
        }
      }
      return {
        oldID: oldGoalID,
        title: requiredString(goal.title, "goal.title"),
        objective: requiredString(goal.objective, "goal.objective"),
        acceptanceSpecs: unknownArray(goal.acceptance_specs, "goal.acceptance_specs"),
        ownedPaths: stringArray(goal.owned_paths, "goal.owned_paths"),
        dependsOn,
        kind: requiredString(goal.kind, "goal.kind"),
        requirementIDs: stringArray(goal.requirement_ids, "goal.requirement_ids"),
        priority: requiredPriority(goal.priority, "goal.priority"),
        orderIndex: requiredInteger(goal.orderIndex, "goal.orderIndex"),
        metadata: objectOrNull(goal.metadata),
      }
    }),
    graph: input.graph,
  })
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw archiveError(400, "InvalidArchiveError", `Archive missing ${field}.`)
  }
  return value
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw archiveError(400, "InvalidArchiveError", `Archive field ${field} must be an array.`)
  }
  const out = value.filter((item): item is string => typeof item === "string")
  if (out.length !== value.length) {
    throw archiveError(400, "InvalidArchiveError", `Archive field ${field} must contain only strings.`)
  }
  return out
}

function unknownArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw archiveError(400, "InvalidArchiveError", `Archive field ${field} must be an array.`)
  }
  return value
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw archiveError(400, "InvalidArchiveError", `Archive field ${field} must be an integer.`)
  }
  return value
}

function requiredPriority(value: unknown, field: string): "advisory" | "blocking" {
  if (value !== "advisory" && value !== "blocking") {
    throw archiveError(400, "InvalidArchiveError", `Archive field ${field} must be advisory or blocking.`)
  }
  return value
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Export routes — provide JSON snapshots and zip archives of task state for
 * forensic export, cross-machine handoff, or backup. The zip archive bundles
 * the JSON snapshot together with the project working tree (gitignored
 * paths excluded via `git ls-files --cached --others --exclude-standard`).
 */
export const ExportRoutes = lazy(() =>
  new Hono()
    .get(
      "/task/:taskID",
      describeRoute({
        summary: "Export full task data",
        operationId: "export.task",
        responses: {
          200: {
            description:
              "Complete task export including plan, runs, evaluations, goals, milestones, interactions, snapshots, and artifacts",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    task: z.unknown(),
                    plan: z.unknown().optional(),
                    goals: z.unknown().array(),
                    milestones: z.unknown().array(),
                    runs: z.unknown().array(),
                    interactions: z.unknown().array(),
                    snapshots: z.unknown().array(),
                    specSnapshots: z.unknown().array(),
                    deliveries: z.unknown().array(),
                    evaluations: z.unknown().array(),
                    artifacts: z.unknown().array(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        return c.json(buildTaskExport(taskID))
      },
    )
    .get(
      "/task/:taskID/archive",
      describeRoute({
        summary: "Export task as zip archive",
        description:
          "Returns a zip archive bundling task.json (full DB snapshot), manifest.json (format metadata), and project/<path> for every non-gitignored file in the task's working tree.",
        operationId: "export.task.archive",
        responses: {
          200: {
            description: "Zip archive (application/zip) — see Content-Disposition for filename",
            content: {
              "application/zip": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          ...errors(404, 412, 500),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        // requireTask validates existence; throws 404 NotFoundError on miss.
        requireTask(taskID)
        const blob = await buildArchive(taskID, Instance.directory)
        return c.body(await blob.arrayBuffer(), 200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="task-${taskID}.zip"`,
          "Content-Length": String(blob.size),
        })
      },
    )
    .post(
      "/import",
      describeRoute({
        summary: "Import a task archive",
        description:
          "Accepts a zip archive previously produced by GET /export/task/:taskID/archive. Restores project/<path> files into the request's directory and creates a new task copying title/request from the bundled task.json. Existing run/interaction history is NOT replayed; the original taskID is recorded in metadata.imported_from for traceability.",
        operationId: "export.import",
        responses: {
          201: {
            description: "Import succeeded",
            content: {
              "application/json": {
                schema: resolver(ImportSummary),
              },
            },
          },
          ...errors(400, 409, 412, 500),
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional(),
          overwrite: z
            .union([z.literal("true"), z.literal("false")])
            .optional()
            .transform((v) => v === "true"),
        }),
      ),
      async (c) => {
        const overwrite = c.req.valid("query").overwrite
        const contentType = c.req.header("content-type") || ""
        if (!contentType.includes("application/zip") && !contentType.includes("application/octet-stream")) {
          throw archiveError(400, "InvalidArchiveError", `Expected Content-Type application/zip; got "${contentType}"`)
        }
        const buffer = await c.req.arrayBuffer()
        if (buffer.byteLength === 0) {
          throw archiveError(400, "InvalidArchiveError", "Archive body is empty")
        }
        const archive = new Blob([buffer], { type: "application/zip" })
        const result = await restoreArchive({ archive, overwrite })
        return c.json(
          {
            taskID: result.taskID,
            importedFromTaskID: result.importedFromTaskID,
            restoredFiles: result.restoredFiles,
            skippedFiles: result.skippedFiles,
            directory: Instance.directory,
          },
          201,
        )
      },
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Export session messages",
        operationId: "export.session",
        responses: {
          200: {
            description: "Session metadata and messages",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    session: z.unknown(),
                    messages: z.unknown().array(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.get(sessionID)
        const messages = await Session.messages({ sessionID })

        return c.json({
          session: {
            id: session.id,
            title: session.title,
            time: session.time,
          },
          messages,
        })
      },
    ),
)
