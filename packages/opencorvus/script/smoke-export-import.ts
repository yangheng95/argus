#!/usr/bin/env bun
/**
 * Smoke test for /export/task/<id>/archive + /export/import round-trip.
 * Runs against a live opencorvus server. The point of a smoke test is to
 * catch route-level regressions that escape the in-process bun:test suite
 * (auth middleware, header parsing, content-type negotiation, real network
 * paths, etc.).
 *
 * Flow:
 *   1. Ping /global/health
 *   2. Resolve sourceTaskID (--task-id or first hit from GET /tasks)
 *   3. GET /export/task/<id>/archive → write zip to tmp + locally inventory entries
 *   4. mktemp target dir + git init (rule 7: import refuses non-git targets)
 *   5. POST /export/import?directory=<target>&overwrite=false with raw zip body
 *   6. Sample-verify restored files byte-for-byte against archive entries
 *
 * Side effect: every successful run leaves a new task in the server's DB
 * (source: "import", metadata.imported_from = <sourceTaskID>). There is no
 * DELETE /task endpoint, so the new task ID is printed at the end for
 * manual cleanup if desired.
 */
import path from "node:path"
import fs from "node:fs/promises"
import os from "node:os"
import { $ } from "bun"
import {
  ZipReader,
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
} from "@zip.js/zip.js"

type Args = {
  serverUrl: string
  directory: string
  taskID?: string
  authToken?: string
  keepTmp: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    serverUrl: process.env.OPENCORVUS_SERVER_URL ?? "http://localhost:7878",
    directory: process.cwd(),
    authToken: process.env.OPENCORVUS_AUTH_TOKEN,
    keepTmp: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const consume = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`flag ${a} requires a value`)
      return v
    }
    switch (a) {
      case "--server-url": out.serverUrl = consume(); break
      case "--directory": out.directory = path.resolve(consume()); break
      case "--task-id": out.taskID = consume(); break
      case "--auth-token": out.authToken = consume(); break
      case "--keep-tmp": out.keepTmp = true; break
      case "--help":
      case "-h":
        printUsage()
        process.exit(0)
      default:
        throw new Error(`unknown arg: ${a}`)
    }
  }
  out.serverUrl = out.serverUrl.replace(/\/+$/, "")
  return out
}

function printUsage(): void {
  process.stdout.write(`smoke-export-import — round-trip /export/task/<id>/archive + /export/import

Usage: bun run packages/opencorvus/script/smoke-export-import.ts [flags]

  --server-url <url>    default: $OPENCORVUS_SERVER_URL or http://localhost:7878
  --directory <path>    project working directory for x-opencorvus-directory header (default: cwd)
  --task-id <id>        existing task to export; default: first from GET /tasks
  --auth-token <tok>    bearer token (or set $OPENCORVUS_AUTH_TOKEN)
  --keep-tmp            preserve tmp dirs on success (always preserved on failure)
`)
}

function buildHeaders(args: Args, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    "x-opencorvus-directory": args.directory,
    ...extra,
  }
  if (args.authToken) h.authorization = `Bearer ${args.authToken}`
  return h
}

function step(n: number, total: number, label: string): void {
  process.stdout.write(`[${n}/${total}] ${label}\n`)
}
function ok(msg: string): void {
  process.stdout.write(`  ok  ${msg}\n`)
}
function fail(msg: string, err?: unknown): never {
  process.stderr.write(`  FAIL ${msg}\n`)
  if (err !== undefined) {
    process.stderr.write(`       ${err instanceof Error ? err.message : String(err)}\n`)
  }
  process.exit(1)
}

async function pingServer(args: Args): Promise<void> {
  const url = `${args.serverUrl}/global/health`
  let res: Response
  try {
    res = await fetch(url, { headers: buildHeaders(args) })
  } catch (err) {
    fail(`cannot reach ${url} — is the server running?`, err)
  }
  if (!res.ok) fail(`GET /global/health → HTTP ${res.status}`)
  ok(`server reachable at ${args.serverUrl}`)
}

async function resolveTaskID(args: Args): Promise<string> {
  if (args.taskID) {
    ok(`using --task-id=${args.taskID}`)
    return args.taskID
  }
  const url = `${args.serverUrl}/tasks?limit=1`
  const res = await fetch(url, { headers: buildHeaders(args) })
  if (!res.ok) fail(`GET /tasks → HTTP ${res.status}`)
  const body = (await res.json()) as { tasks?: Array<{ id?: string }> }
  const first = body.tasks?.[0]
  if (!first?.id) {
    fail(`no tasks in directory ${args.directory} — pass --task-id <id> or create one in the UI first`)
  }
  ok(`auto-picked task ${first.id} (pass --task-id to override)`)
  return first.id
}

type ArchiveInventory = {
  manifest: { format: string; version: number; source?: { taskID?: string } }
  task: { id: string; title?: string; request: string }
  projectFiles: Map<string, Uint8Array>
}

async function downloadArchive(args: Args, taskID: string, dest: string): Promise<ArchiveInventory> {
  const url = `${args.serverUrl}/export/task/${encodeURIComponent(taskID)}/archive`
  const res = await fetch(url, { headers: buildHeaders(args) })
  if (!res.ok) {
    let detail = ""
    try { detail = await res.text() } catch { /* binary body */ }
    fail(`GET /export/task/${taskID}/archive → HTTP ${res.status}${detail ? `: ${detail}` : ""}`)
  }
  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("application/zip")) {
    fail(`unexpected content-type: "${contentType}"`)
  }
  const disposition = res.headers.get("content-disposition") ?? ""
  if (!disposition.includes("filename=")) fail(`missing content-disposition filename: "${disposition}"`)

  const bytes = new Uint8Array(await res.arrayBuffer())
  await fs.writeFile(dest, bytes)

  const blob = new Blob([bytes], { type: "application/zip" })
  const reader = new ZipReader(new BlobReader(blob))
  let entries: Awaited<ReturnType<typeof reader.getEntries>>
  try {
    entries = await reader.getEntries()
  } catch (err) {
    await reader.close().catch(() => undefined)
    fail("downloaded body is not a valid zip", err)
  }

  let manifestText: string | undefined
  let taskJsonText: string | undefined
  const projectFiles = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (entry.directory) continue
    if (entry.filename === "manifest.json") {
      manifestText = await entry.getData!(new TextWriter())
    } else if (entry.filename === "task.json") {
      taskJsonText = await entry.getData!(new TextWriter())
    } else if (entry.filename.startsWith("project/")) {
      projectFiles.set(entry.filename, await entry.getData!(new Uint8ArrayWriter()))
    }
  }
  await reader.close()

  if (!manifestText) fail("archive missing manifest.json")
  if (!taskJsonText) fail("archive missing task.json")

  const manifest = JSON.parse(manifestText) as ArchiveInventory["manifest"]
  if (manifest.format !== "opencorvus-task-archive") fail(`bad manifest.format: ${manifest.format}`)
  if (manifest.version !== 1) fail(`unexpected manifest.version: ${manifest.version}`)
  if (manifest.source?.taskID !== taskID) {
    fail(`manifest.source.taskID mismatch: got "${manifest.source?.taskID}", expected "${taskID}"`)
  }

  const taskJson = JSON.parse(taskJsonText) as { task?: ArchiveInventory["task"] }
  if (!taskJson.task?.id) fail("task.json missing task.id")
  if (taskJson.task.id !== taskID) fail(`task.json task.id mismatch: ${taskJson.task.id} vs ${taskID}`)
  if (!taskJson.task.request) fail("task.json missing task.request")

  if (projectFiles.size === 0) {
    fail("archive contains zero project/ entries — source directory empty or fully .gitignored")
  }

  ok(`zip ok (${bytes.length} bytes, manifest v${manifest.version}, ${projectFiles.size} project files)`)
  return { manifest, task: taskJson.task, projectFiles }
}

async function prepTargetDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-import-"))
  // Newer git defaults are noisy on init; quiet the output but surface real failures.
  const result = await $`git init -q -b main`.cwd(dir).quiet().nothrow()
  if (result.exitCode !== 0) {
    fail(`git init failed at ${dir}: ${result.stderr.toString("utf8").trim()}`)
  }
  ok(`target dir ${dir} initialized as git repo`)
  return dir
}

type ImportResponse = {
  taskID: string
  importedFromTaskID?: string
  restoredFiles: number
  skippedFiles: string[]
  directory: string
}

async function uploadImport(args: Args, zipPath: string, targetDir: string, sourceTaskID: string): Promise<ImportResponse> {
  const bytes = await fs.readFile(zipPath)
  // The import route reads target via the x-opencorvus-directory header, so we
  // swap the directory header to the temp target rather than passing the user
  // --directory through.
  const headers = buildHeaders(args, { "content-type": "application/zip" })
  headers["x-opencorvus-directory"] = targetDir
  const url = `${args.serverUrl}/export/import?directory=${encodeURIComponent(targetDir)}&overwrite=false`
  const res = await fetch(url, { method: "POST", headers, body: bytes })
  if (res.status !== 201) {
    let detail = ""
    try { detail = await res.text() } catch { /* ignore */ }
    fail(`POST /export/import → HTTP ${res.status}${detail ? `: ${detail}` : ""}`)
  }
  const body = (await res.json()) as Partial<ImportResponse>
  if (!body.taskID) fail("import response missing taskID")
  if (body.taskID === sourceTaskID) fail(`new task ID equals source: ${body.taskID}`)
  if (body.importedFromTaskID !== sourceTaskID) {
    fail(`importedFromTaskID mismatch: got "${body.importedFromTaskID}", expected "${sourceTaskID}"`)
  }
  if (typeof body.restoredFiles !== "number" || body.restoredFiles < 1) {
    fail(`restoredFiles must be >= 1, got ${body.restoredFiles}`)
  }
  if (body.directory !== targetDir) {
    fail(`response directory mismatch: got "${body.directory}", expected "${targetDir}"`)
  }
  ok(`new task ${body.taskID} created, restored ${body.restoredFiles}, skipped ${body.skippedFiles?.length ?? 0}`)
  return {
    taskID: body.taskID,
    importedFromTaskID: body.importedFromTaskID,
    restoredFiles: body.restoredFiles,
    skippedFiles: body.skippedFiles ?? [],
    directory: body.directory,
  }
}

async function sampleVerify(targetDir: string, inventory: ArchiveInventory, skipped: string[]): Promise<void> {
  const skipSet = new Set(skipped)
  // The server's bootstrap may seed e.g. `.gitignore` into the target before
  // the import handler runs, so the source `.gitignore` typically appears in
  // `skippedFiles` on a fresh target. Sample anything that wasn't skipped.
  const candidates: string[] = []
  for (const key of inventory.projectFiles.keys()) {
    const rel = key.slice("project/".length)
    if (skipSet.has(rel)) continue
    candidates.push(key)
    if (candidates.length === 3) break
  }
  if (candidates.length === 0) {
    fail("no restored files to sample-verify (every entry was skipped)")
  }
  for (const key of candidates) {
    const rel = key.slice("project/".length)
    const abs = path.resolve(targetDir, ...rel.split("/"))
    const onDisk = await fs.readFile(abs).catch(() => null)
    if (!onDisk) fail(`restored file missing on disk: ${abs}`)
    const expected = inventory.projectFiles.get(key)!
    if (onDisk.byteLength !== expected.byteLength) {
      fail(`size mismatch for ${rel}: disk=${onDisk.byteLength} archive=${expected.byteLength}`)
    }
    for (let i = 0; i < expected.byteLength; i++) {
      if (onDisk[i] !== expected[i]) fail(`byte mismatch for ${rel} at offset ${i}`)
    }
  }
  ok(`sample-verified ${candidates.length} restored file(s) byte-for-byte`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  process.stdout.write(`smoke-export-import → ${args.serverUrl} (directory=${args.directory})\n`)

  const TOTAL = 6
  let zipDir = ""
  let zipPath = ""
  let targetDir = ""
  let succeeded = false
  try {
    step(1, TOTAL, "ping server")
    await pingServer(args)

    step(2, TOTAL, "resolve source task")
    const sourceTaskID = await resolveTaskID(args)

    step(3, TOTAL, "export archive")
    zipDir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-export-"))
    zipPath = path.join(zipDir, `task-${sourceTaskID}.zip`)
    const inventory = await downloadArchive(args, sourceTaskID, zipPath)

    step(4, TOTAL, "prepare target directory")
    targetDir = await prepTargetDir()

    step(5, TOTAL, "import archive")
    const imported = await uploadImport(args, zipPath, targetDir, sourceTaskID)

    step(6, TOTAL, "verify restored files")
    await sampleVerify(targetDir, inventory, imported.skippedFiles)

    process.stdout.write(`\nsmoke passed.\n`)
    process.stdout.write(`  source task  : ${sourceTaskID}\n`)
    process.stdout.write(`  new task     : ${imported.taskID}  (no DELETE endpoint — remove manually if needed)\n`)
    process.stdout.write(`  target dir   : ${targetDir}\n`)
    succeeded = true
  } finally {
    if (succeeded && !args.keepTmp) {
      if (zipDir) await fs.rm(zipDir, { recursive: true, force: true }).catch(() => undefined)
      if (targetDir) await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
    } else if (!succeeded) {
      if (zipDir) process.stderr.write(`tmp zip preserved: ${zipDir}\n`)
      if (targetDir) process.stderr.write(`tmp target preserved: ${targetDir}\n`)
    } else {
      process.stdout.write(`(--keep-tmp) zip dir: ${zipDir} ; target: ${targetDir}\n`)
    }
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
