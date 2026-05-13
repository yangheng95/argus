import z from "zod"

/**
 * Pure zod schemas for snapshot data shapes — extracted from `snapshot/index.ts`
 * so that consumers who only need the schemas (e.g. `engine/store.ts`,
 * `engine/model.ts`) don't pull in the full Snapshot module's runtime
 * dependencies (`@/scheduler`, `@/project/instance`).
 *
 * The original eager chain via `@/snapshot` namespace was:
 *   import { Snapshot } from "@/snapshot"
 *     → snapshot/index.ts: import { Scheduler } from "../scheduler"
 *     → scheduler/index.ts: top-level `Instance.state(...)`
 *
 * That chain caused TDZ failures the moment any engine submodule was pulled
 * in by a consumer earlier than Instance had finished its own init. By placing
 * the schemas in a leaf file with only `zod` as a dep, schema-only consumers
 * stay structurally decoupled from the snapshot runtime.
 *
 * `snapshot/index.ts` re-exports these inside its `Snapshot` namespace so
 * existing `Snapshot.FileDiff` / `Snapshot.Patch` callsites work unchanged.
 */

export const FileDiff = z
  .object({
    file: z.string(),
    before: z.string(),
    after: z.string(),
    additions: z.number(),
    deletions: z.number(),
    status: z.enum(["added", "deleted", "modified"]).optional(),
  })
  .meta({
    ref: "FileDiff",
  })
export type FileDiff = z.infer<typeof FileDiff>

export const Patch = z.object({
  hash: z.string(),
  files: z.string().array(),
})
export type Patch = z.infer<typeof Patch>

export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
export const PATCH_EVIDENCE_PREVIEW_HEAD = 20
export const PATCH_EVIDENCE_PREVIEW_TAIL = 20
export const EMPTY_TREE_WHOLE_WORKTREE_FILE_COUNT = 1_000

export type PatchEvidenceSummary = {
  hash: string
  fileCount: number
  filesPreviewHead: string[]
  filesPreviewTail: string[]
  truncated: boolean
  omittedCount: number
}

export function patchEvidenceSummary(patch: Pick<Patch, "hash" | "files">): PatchEvidenceSummary {
  const fileCount = patch.files.length
  const maxFiles = PATCH_EVIDENCE_PREVIEW_HEAD + PATCH_EVIDENCE_PREVIEW_TAIL
  if (fileCount <= maxFiles) {
    return {
      hash: patch.hash,
      fileCount,
      filesPreviewHead: patch.files,
      filesPreviewTail: [],
      truncated: false,
      omittedCount: 0,
    }
  }

  return {
    hash: patch.hash,
    fileCount,
    filesPreviewHead: patch.files.slice(0, PATCH_EVIDENCE_PREVIEW_HEAD),
    filesPreviewTail: patch.files.slice(-PATCH_EVIDENCE_PREVIEW_TAIL),
    truncated: true,
    omittedCount: fileCount - maxFiles,
  }
}

export function formatPatchEvidence(patch: Pick<Patch, "hash" | "files">) {
  const summary = patchEvidenceSummary(patch)
  const files = [
    ...summary.filesPreviewHead,
    ...(summary.truncated ? [`... (${summary.omittedCount} files omitted)`] : []),
    ...summary.filesPreviewTail,
  ]
  const fileText = files.length ? files.join(", ") : "(no files)"
  const prefix = summary.truncated
    ? `Patch evidence truncated: ${summary.fileCount} files total, ${summary.omittedCount} omitted`
    : `Patch evidence: ${summary.fileCount} files`
  return `${prefix}; hash=${summary.hash}; files=${fileText}`
}
