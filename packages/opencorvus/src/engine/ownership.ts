/**
 * Execution ownership registry — OS-level markers for worktree directories
 * and child processes spawned during task execution.
 *
 * Motivation (see specs/new-arch/16-unified-teardown.md §6):
 *   Phase 1 starts the tear-down of `recovery.ts`. Today, restart recovery
 *   walks DB status columns (`engine_run.status`, `engine_goal_run.status`,
 *   `engine_executor_session.status`) and `abortRuns()` them. After the
 *   state-table tear-down (phases 4-6), restart recovery becomes **purely
 *   physical** — scan the worktrees directory, scan the child-process list,
 *   clean up what the current process can't vouch for.
 *
 *   That physical clean-up requires *ownership markers* that live on disk
 *   so crash recovery can read them. This module provides:
 *
 *     - `Ownership.Worktree.record(...)` — drop a marker next to a live
 *       worktree directory when it is created.
 *     - `Ownership.Worktree.clear(...)` — remove the marker when the
 *       worktree is disposed cleanly.
 *     - `Ownership.Worktree.orphans({ worktreesRoot })` — enumerate
 *       directories whose marker was lost, marker points at an owner
 *       process that is no longer alive, or which have no marker at all.
 *     - `Ownership.Process.record(...)` / `.clear(...)` / `.orphans()` —
 *       same shape for OS-level executor child processes.
 *
 *   Both sub-registries write to `<primary-worktree>/.opencorvus/r/o/`
 *   so recovery on next process start can find them. Marker writes and
 *   deletions are best-effort: failure to write does not abort the
 *   create path; the fallback is just "the marker is missing next time",
 *   which orphans()' path already handles as a treat-as-orphan signal.
 *
 * Scope:
 *   - This module does NOT read DB status columns — that is the whole
 *     point. It only knows about OS entities (directory exists? PID alive?).
 *   - Phase 1 ships the APIs + wiring at known creation sites + unit
 *     tests. Callers that currently lack task/session context (e.g. the
 *     generic `jsonLines` external-process helper) are intentionally NOT
 *     rewritten here; their owning call-sites will plumb context when
 *     phase 4+ uncovers them.
 *
 * Not a state machine: every call reads the file system and OS (via
 * process existence check) and emits a fact; there is no cached
 * "registered?" flag and no transition graph.
 */

import fs from "fs/promises"
import path from "path"
import { Log } from "@/util/log"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

const log = Log.create({ service: "ownership" })

const WORKTREE_DIR = "w"
const PROCESS_DIR = "p"
const MARKER_SUFFIX = ".json"

export namespace Ownership {
  /** On-disk marker written next to each tracked worktree / process. */
  export interface Marker {
    /** Owning task. Required so recovery can skip markers for tasks the
     *  operator deleted manually. */
    taskID: string
    /** Owning session. Required so overlapping task/session lifetimes
     *  can be distinguished (a restarted session has a new ID). */
    sessionID: string
    /** For worktrees: the absolute directory. For processes: the CWD. */
    cwd: string
    /** PID of the owner process. For worktrees this is the opencorvus
     *  process that created the worktree; restart recovery uses
     *  `isPidAlive(ownerPid) === false` as the "orphan" signal. For
     *  processes this IS the tracked PID. */
    ownerPid: number
    /** Optional goal context (goal-pool.ts path). */
    goalID?: string
    /** Optional run context (engine_run.id at marker-write time). */
    runID?: string
    /** Epoch ms when the marker was written. */
    createdAt: number
    /** Free-form marker subtype; used to disambiguate `Worktree` vs
     *  `Process` in a mixed directory listing and to label log output. */
    kind: "worktree" | "process"
  }

  /** A marker plus the pieces recovery wants to act on. */
  export interface OrphanEntry {
    marker: Marker
    markerPath: string
    reason: "owner-process-dead" | "target-missing" | "marker-unparseable"
    /** Set when `kind === "worktree"` and the directory is still on disk
     *  (missing marker was the sole orphan reason). */
    worktreeDir?: string
  }

  function ownershipRoot(primaryWorktreeDir: string): string {
    return ProjectRuntimePaths.ownershipRoot(primaryWorktreeDir)
  }

  function worktreeMarkerDir(
    primaryWorktreeDir: string,
    marker?: Pick<Marker, "taskID" | "sessionID" | "runID">,
  ): string {
    if (marker?.taskID && marker.sessionID) {
      return ProjectRuntimePaths.ownershipPaths(primaryWorktreeDir, marker.taskID, marker.sessionID, marker.runID)
        .worktreeMarkerDir
    }
    return path.join(ownershipRoot(primaryWorktreeDir), WORKTREE_DIR)
  }

  function processMarkerDir(
    primaryWorktreeDir: string,
    marker?: Pick<Marker, "taskID" | "sessionID" | "runID">,
  ): string {
    if (marker?.taskID && marker.sessionID) {
      return ProjectRuntimePaths.ownershipPaths(primaryWorktreeDir, marker.taskID, marker.sessionID, marker.runID)
        .processMarkerDir
    }
    return path.join(ownershipRoot(primaryWorktreeDir), PROCESS_DIR)
  }

  function worktreeMarkerScanDirs(primaryWorktreeDir: string): string[] {
    return [worktreeMarkerDir(primaryWorktreeDir), path.join(ownershipRoot(primaryWorktreeDir), "w")]
  }

  function processMarkerScanDirs(primaryWorktreeDir: string): string[] {
    return [processMarkerDir(primaryWorktreeDir), path.join(ownershipRoot(primaryWorktreeDir), "p")]
  }

  /**
   * Filesystem-safe filename for a directory path. `path.basename` alone
   * is not unique across project-root and child worktree names, so the
   * full path is hashed to hex. Collisions would silently overwrite
   * someone else's marker, which is strictly worse than a longer filename.
   */
  function sanitizeFilename(input: string): string {
    return input
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120)
  }

  function workerMarkerFilename(worktreeDir: string): string {
    // Add the last 8 chars of a simple hash for uniqueness when two
    // different absolute paths share a basename (e.g. worktrees with the
    // same branch-derived name in different project roots).
    const base = sanitizeFilename(path.basename(worktreeDir))
    let hash = 0
    for (let i = 0; i < worktreeDir.length; i++) {
      hash = (hash * 31 + worktreeDir.charCodeAt(i)) | 0
    }
    const suffix = (hash >>> 0).toString(16).padStart(8, "0").slice(-8)
    return `${base || "worktree"}-${suffix}${MARKER_SUFFIX}`
  }

  function processMarkerFilename(pid: number): string {
    return `${pid}${MARKER_SUFFIX}`
  }

  /**
   * Cross-platform liveness probe.
   *
   * Node `process.kill(pid, 0)` returns true if the caller has permission
   * to signal the PID; it throws EPERM / ESRCH if it does not. EPERM
   * (permission denied) means the process exists but owned by someone
   * else — still "alive" from our perspective. ESRCH is "no such process".
   */
  export function isPidAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (err: any) {
      if (err && err.code === "EPERM") return true
      return false
    }
  }

  async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true }).catch((err) => {
      log.warn("failed to create ownership dir", { dir, error: String(err) })
    })
  }

  async function writeMarker(filePath: string, marker: Marker): Promise<void> {
    await ensureDir(path.dirname(filePath))
    const body = JSON.stringify(marker, null, 2) + "\n"
    await fs.writeFile(filePath, body, { encoding: "utf8" }).catch((err) => {
      log.warn("failed to write ownership marker", {
        filePath,
        error: String(err),
        taskID: marker.taskID,
      })
    })
  }

  async function deleteMarker(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true }).catch((err) => {
      log.warn("failed to remove ownership marker", {
        filePath,
        error: String(err),
      })
    })
  }

  async function listMarkers(dir: string): Promise<Array<{ markerPath: string; marker: Marker | undefined }>> {
    let entries: import("fs").Dirent[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err: any) {
      if (err?.code === "ENOENT") return []
      log.warn("failed to list ownership dir", { dir, error: String(err) })
      return []
    }
    const out: Array<{ markerPath: string; marker: Marker | undefined }> = []
    for (const entry of entries) {
      const markerPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        out.push(...(await listMarkers(markerPath)))
        continue
      }
      if (!entry.name.endsWith(MARKER_SUFFIX)) continue
      try {
        const raw = await fs.readFile(markerPath, { encoding: "utf8" })
        const parsed = JSON.parse(raw) as Marker
        if (
          typeof parsed?.taskID === "string" &&
          typeof parsed?.sessionID === "string" &&
          typeof parsed?.cwd === "string" &&
          typeof parsed?.ownerPid === "number" &&
          (parsed.kind === "worktree" || parsed.kind === "process")
        ) {
          out.push({ markerPath, marker: parsed })
        } else {
          out.push({ markerPath, marker: undefined })
        }
      } catch {
        out.push({ markerPath, marker: undefined })
      }
    }
    return out
  }

  async function listMarkersInDirs(dirs: string[]): Promise<Array<{ markerPath: string; marker: Marker | undefined }>> {
    const out: Array<{ markerPath: string; marker: Marker | undefined }> = []
    const seen = new Set<string>()
    for (const dir of dirs) {
      for (const entry of await listMarkers(dir)) {
        if (seen.has(entry.markerPath)) continue
        seen.add(entry.markerPath)
        out.push(entry)
      }
    }
    return out
  }

  async function pathExists(target: string): Promise<boolean> {
    try {
      await fs.stat(target)
      return true
    } catch {
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Worktree ownership
  // -------------------------------------------------------------------------

  export namespace Worktree {
    export interface RecordInput {
      primaryWorktreeDir: string
      worktreeDir: string
      taskID: string
      sessionID: string
      goalID?: string
      runID?: string
      ownerPid?: number
      now?: number
    }

    export async function record(input: RecordInput): Promise<string> {
      const marker: Marker = {
        taskID: input.taskID,
        sessionID: input.sessionID,
        cwd: input.worktreeDir,
        ownerPid: input.ownerPid ?? process.pid,
        goalID: input.goalID,
        runID: input.runID,
        createdAt: input.now ?? Date.now(),
        kind: "worktree",
      }
      const filePath = path.join(
        worktreeMarkerDir(input.primaryWorktreeDir, marker),
        workerMarkerFilename(input.worktreeDir),
      )
      await writeMarker(filePath, marker)
      return filePath
    }

    export async function clear(input: { primaryWorktreeDir: string; worktreeDir: string }): Promise<void> {
      const filename = workerMarkerFilename(input.worktreeDir)
      const markerPaths = (await listMarkersInDirs(worktreeMarkerScanDirs(input.primaryWorktreeDir)))
        .map((entry) => entry.markerPath)
        .filter((markerPath) => path.basename(markerPath) === filename)
      if (markerPaths.length === 0) {
        await deleteMarker(path.join(worktreeMarkerDir(input.primaryWorktreeDir), filename))
        return
      }
      for (const filePath of markerPaths) await deleteMarker(filePath)
    }

    export async function list(primaryWorktreeDir: string): Promise<Array<{ markerPath: string; marker: Marker }>> {
      const raw = await listMarkersInDirs(worktreeMarkerScanDirs(primaryWorktreeDir))
      return raw.filter((r): r is { markerPath: string; marker: Marker } => !!r.marker && r.marker.kind === "worktree")
    }

    /**
     * Enumerate worktree orphans:
     *   1. Marker present, target directory gone → stale marker → target-missing
     *   2. Marker present, owner process dead → owner-process-dead
     *   3. Marker present but unparseable → marker-unparseable
     */
    export async function orphans(input: {
      primaryWorktreeDir: string
      isPidAlive?: (pid: number) => boolean
    }): Promise<OrphanEntry[]> {
      const aliveCheck = input.isPidAlive ?? isPidAlive
      const raw = await listMarkersInDirs(worktreeMarkerScanDirs(input.primaryWorktreeDir))
      const out: OrphanEntry[] = []
      for (const { markerPath, marker } of raw) {
        if (!marker) {
          out.push({
            marker: {
              taskID: "",
              sessionID: "",
              cwd: "",
              ownerPid: 0,
              createdAt: 0,
              kind: "worktree",
            },
            markerPath,
            reason: "marker-unparseable",
          })
          continue
        }
        if (marker.kind !== "worktree") continue
        const dirExists = await pathExists(marker.cwd)
        if (!dirExists) {
          out.push({ marker, markerPath, reason: "target-missing" })
          continue
        }
        if (!aliveCheck(marker.ownerPid)) {
          out.push({
            marker,
            markerPath,
            reason: "owner-process-dead",
            worktreeDir: marker.cwd,
          })
        }
      }
      return out
    }
  }

  // -------------------------------------------------------------------------
  // Process ownership
  // -------------------------------------------------------------------------

  export namespace Process {
    export interface RecordInput {
      primaryWorktreeDir: string
      pid: number
      cwd: string
      taskID: string
      sessionID: string
      goalID?: string
      runID?: string
      now?: number
    }

    export async function record(input: RecordInput): Promise<string> {
      const marker: Marker = {
        taskID: input.taskID,
        sessionID: input.sessionID,
        cwd: input.cwd,
        ownerPid: input.pid,
        goalID: input.goalID,
        runID: input.runID,
        createdAt: input.now ?? Date.now(),
        kind: "process",
      }
      const filePath = path.join(processMarkerDir(input.primaryWorktreeDir, marker), processMarkerFilename(input.pid))
      await writeMarker(filePath, marker)
      return filePath
    }

    export async function clear(input: { primaryWorktreeDir: string; pid: number }): Promise<void> {
      const filename = processMarkerFilename(input.pid)
      const markerPaths = (await listMarkersInDirs(processMarkerScanDirs(input.primaryWorktreeDir)))
        .map((entry) => entry.markerPath)
        .filter((markerPath) => path.basename(markerPath) === filename)
      if (markerPaths.length === 0) {
        await deleteMarker(path.join(processMarkerDir(input.primaryWorktreeDir), filename))
        return
      }
      for (const filePath of markerPaths) await deleteMarker(filePath)
    }

    export async function list(primaryWorktreeDir: string): Promise<Array<{ markerPath: string; marker: Marker }>> {
      const raw = await listMarkersInDirs(processMarkerScanDirs(primaryWorktreeDir))
      return raw.filter((r): r is { markerPath: string; marker: Marker } => !!r.marker && r.marker.kind === "process")
    }

    /**
     * Enumerate process orphans:
     *   1. Marker points at a PID that no longer exists → owner-process-dead
     *   2. Marker unparseable → marker-unparseable
     *
     * Markers whose PID is still alive are NOT returned, regardless of
     * whether it's the current process or a sibling — "alive" is the only
     * evidence available at the OS layer.
     */
    export async function orphans(input: {
      primaryWorktreeDir: string
      isPidAlive?: (pid: number) => boolean
    }): Promise<OrphanEntry[]> {
      const aliveCheck = input.isPidAlive ?? isPidAlive
      const raw = await listMarkersInDirs(processMarkerScanDirs(input.primaryWorktreeDir))
      const out: OrphanEntry[] = []
      for (const { markerPath, marker } of raw) {
        if (!marker) {
          out.push({
            marker: {
              taskID: "",
              sessionID: "",
              cwd: "",
              ownerPid: 0,
              createdAt: 0,
              kind: "process",
            },
            markerPath,
            reason: "marker-unparseable",
          })
          continue
        }
        if (marker.kind !== "process") continue
        if (!aliveCheck(marker.ownerPid)) {
          out.push({
            marker,
            markerPath,
            reason: "owner-process-dead",
          })
        }
      }
      return out
    }
  }

  // -------------------------------------------------------------------------
  // Combined cleanup driver — used by engine/recovery.ts's cleanup path.
  // -------------------------------------------------------------------------

  export interface CleanupInput {
    primaryWorktreeDir: string
    /** Remove the directory on disk when a worktree orphan is detected. */
    removeWorktreeDir?: (worktreeDir: string) => Promise<void>
    /** Kill the PID when a process orphan-marker refers to a live PID
     *  (should normally not happen — orphans() filters live PIDs out —
     *  but included for future policy hooks). */
    killPid?: (pid: number) => Promise<void>
    isPidAlive?: (pid: number) => boolean
  }

  export interface CleanupResult {
    worktreeOrphans: OrphanEntry[]
    processOrphans: OrphanEntry[]
    worktreeMarkersRemoved: number
    processMarkersRemoved: number
    worktreeDirsRemoved: number
  }

  export async function cleanup(input: CleanupInput): Promise<CleanupResult> {
    const worktreeOrphans = await Worktree.orphans({
      primaryWorktreeDir: input.primaryWorktreeDir,
      isPidAlive: input.isPidAlive,
    })
    const processOrphans = await Process.orphans({
      primaryWorktreeDir: input.primaryWorktreeDir,
      isPidAlive: input.isPidAlive,
    })

    let worktreeDirsRemoved = 0
    for (const entry of worktreeOrphans) {
      if (entry.reason === "owner-process-dead" && entry.worktreeDir && input.removeWorktreeDir) {
        try {
          await input.removeWorktreeDir(entry.worktreeDir)
          worktreeDirsRemoved++
        } catch (err) {
          log.warn("removeWorktreeDir failed during ownership cleanup", {
            worktreeDir: entry.worktreeDir,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      await deleteMarker(entry.markerPath)
    }
    const worktreeMarkersRemoved = worktreeOrphans.length

    for (const entry of processOrphans) {
      await deleteMarker(entry.markerPath)
    }
    const processMarkersRemoved = processOrphans.length

    return {
      worktreeOrphans,
      processOrphans,
      worktreeMarkersRemoved,
      processMarkersRemoved,
      worktreeDirsRemoved,
    }
  }
}
