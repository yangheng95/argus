/**
 * Shared output-directory resolver for all `webpage_*` tools.
 *
 * All six mirror tools (extract / compile / analyze / render / evaluate /
 * text_diff) produce intermediate artifacts (reference.png, extracted-page.json,
 * page-ir.xml, scaffold.json, shared-context.md, rendered.png, diff.png,
 * images/). Analyze tools write generated React source under the worktree
 * source layout, not under this artifact directory.
 *
 * The default lives at `<worktree>/mirror/` — a single top-level folder that
 * is both git-visible (so `git add -A` picks it up for the delivery commit)
 * and consolidated (no artifacts scattered at the worktree root). The prior
 * `.opencorvus/mirror/` default collided with the orchestrator's scratch
 * policy, which gitignores and untracks the entire `.opencorvus/` tree — so
 * mirror artifacts silently dropped out of every commit.
 *
 * Callers that want a different location (e.g. the overlay-web-benchmark
 * driver, tests) still override via the tool's `outputDir` parameter.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { Instance } from "../../project/instance"

const MIRROR_SUBDIR = "mirror"

/**
 * Resolve the effective output directory for a mirror tool.
 *
 * - No override → `<worktree>/mirror/` (created if missing).
 * - Override → resolved against the worktree (relative) or used as-is (absolute).
 *
 * `mkdir -p` is always invoked so tools can immediately write artifacts
 * without each having to repeat the existence check.
 */
export async function resolveMirrorOutputDir(override?: string): Promise<string> {
  const base = override
    ? path.resolve(Instance.directory, override)
    : path.join(Instance.directory, MIRROR_SUBDIR)
  await fs.mkdir(base, { recursive: true })
  return base
}

/** The path segment used when no override is supplied. Exposed for docstrings
 *  / tool-description text that needs to name the convention. */
export const DEFAULT_MIRROR_SUBDIR = MIRROR_SUBDIR
