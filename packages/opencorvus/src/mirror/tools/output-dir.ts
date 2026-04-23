/**
 * Shared output-directory resolver for all `webpage_*` tools.
 *
 * All six mirror tools (extract / compile / analyze / render / evaluate /
 * text_diff) produce intermediate artifacts (reference.png, extracted-page.json,
 * page-ir.xml, scaffold.json, design-tokens.ts, App.tsx, shared-context.md,
 * rendered.png, diff.png, images/). Previously each tool defaulted its
 * `outputDir` to the worktree root, so a webpage-clone task left ~10 top-level
 * files + an `images/` folder mixed in with the executor's real source tree.
 *
 * This helper centralises the default at `.opencorvus/mirror/` — a single
 * hidden convention-aligned folder alongside `.opencorvus/intent/` and the
 * snapshot git dir — and creates it lazily. Callers that want a different
 * location (e.g. the overlay-web-benchmark driver, tests) still override via
 * the tool's `outputDir` parameter.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { Instance } from "../../project/instance"

const MIRROR_SUBDIR = path.join(".opencorvus", "mirror")

/**
 * Resolve the effective output directory for a mirror tool.
 *
 * - No override → `<worktree>/.opencorvus/mirror/` (created if missing).
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
