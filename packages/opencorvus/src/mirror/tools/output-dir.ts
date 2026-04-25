/**
 * Shared output-directory resolver for all `webpage_*` tools.
 *
 * All six mirror tools (extract / compile / analyze / render / evaluate /
 * text_diff) produce intermediate artifacts (reference.png, extracted-page.json,
 * page-ir.xml, scaffold.json, design-tokens.ts, App.tsx, shared-context.md,
 * rendered.png, diff.png, images/).
 *
 * Storage is task-scoped via the `TaskArtifact` abstraction:
 *   <project_worktree>/.opencorvus/task-artifacts/<taskID>/mirror/
 * Each goal worktree gets a `<worktree>/mirror` symlink to that single
 * directory, so agent prompts keep using the relative `mirror/...` paths
 * they always have, while every goal of the same task reads the same
 * artifact set (no per-worktree re-extraction — rule 22).
 *
 * Callers that supply an explicit override path bypass this entirely —
 * the override IS the single source for that call (benchmark driver,
 * tests, ad-hoc CLI). When neither override nor sessionID is supplied
 * we throw — there is no implicit guess at where to write (rule 1).
 */
import path from "node:path"

import { Instance } from "@/project/instance"
import { TaskArtifact } from "@/task-artifact"
import { taskIDForSession } from "@/server/routes/task-event"

const MIRROR_KIND = "mirror"
const MIRROR_LINK_NAME = "mirror"

export interface ResolveMirrorOpts {
  /** Caller-supplied override; absolute paths are used as-is, relative
   *  paths are resolved against the current worktree (Instance.directory). */
  override?: string
  /** Active tool-call session — its task root determines the canonical
   *  storage location and a worktree symlink is materialised on first use. */
  sessionID?: string
}

/**
 * Resolve the effective output directory for a mirror tool.
 *
 * Resolution order (single source per call, no fallback):
 *   1. `opts.override` — used as-is (absolute) or worktree-resolved (relative)
 *   2. `opts.sessionID` → `TaskArtifact.dirFor(taskID, "mirror")` and a
 *      `<worktree>/mirror` symlink is ensured for in-worktree relative reads
 *   3. neither → throw (the call site has lost its session anchor — bug)
 */
export async function resolveMirrorOutputDir(opts: ResolveMirrorOpts): Promise<string> {
  if (opts.override) {
    return path.isAbsolute(opts.override)
      ? opts.override
      : path.resolve(Instance.directory, opts.override)
  }

  if (!opts.sessionID) {
    throw new Error(
      "resolveMirrorOutputDir: needs either `override` or `sessionID`; both undefined",
    )
  }

  const taskID = taskIDForSession(opts.sessionID)
  if (!taskID) {
    throw new Error(
      `resolveMirrorOutputDir: session ${opts.sessionID} has no owning task`,
    )
  }

  const target = await TaskArtifact.dirFor(taskID, MIRROR_KIND)
  await TaskArtifact.linkInto(taskID, MIRROR_KIND, Instance.directory, MIRROR_LINK_NAME)
  return target
}

/** The path segment used when no override is supplied. Exposed for tool
 *  description / prompt text that needs to name the convention. */
export const DEFAULT_MIRROR_SUBDIR = MIRROR_LINK_NAME
