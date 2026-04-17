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
