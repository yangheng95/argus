# Delivery Attachment Store Single-Source Repair

Date: 2026-05-11

## Problem

Persistent OOM under long-running delivery tasks (visual review heavy). DB forensics on the live `opencorvus.db`:

- `part` table: 17,172 rows / 86 MB total.
- 92 rows carry `data:image/...;base64,...` inline data URLs in `part.data`. Total: **54 MB (63% of table)**.
- Deduplicated by base64 fingerprint: **only 3 distinct images**. A single image is copied 90 times across 46 sessions; same image in one session up to 40 times.
- `compare_visual_artifacts` tool produces 601 KB single-part rows (both reference + rendered images inlined into ToolPart output JSON).
- `.opencorvus/attachments/` (`AttachmentStore` root) does NOT exist in the target project. `.opencorvus/delivery-screenshots/` (the parallel sink) does — 272 KB on disk.

DB never recorded an OOM error (`task.error` / `engine_artifact` / `protocol_event` all clean for OOM/heap/SIGKILL/137/ENOMEM). Process-level OOM (Windows 0xC0000409 / SIGKILL) does not write back to DB; absence of error rows is not proof of absence.

The actual OOM mechanism is **single-turn in-flight memory amplification**:

1. `compare_visual_artifacts` writes a 600 KB inline-base64 ToolPart on every invocation, repeated 40× in one session.
2. `Session.updatePart` (`session/index.ts:801`) writes the full `data` column on every tool state transition (pending → running → completed) with `onConflictDoUpdate({ set: { data } })` — 3× I/O per tool per part.
3. `bridgeEvent` (`message-bridge.ts:406`) routes `Message.Event.PartUpdated` through `ProtocolStore.dispatchEphemeral`, which keeps the full part payload alive for SSE fan-out (already confirmed: not persisted to `protocol_event` table; max persisted event payload = 5,606 bytes).
4. `AttachmentStore.inlineFileParts` (`attachment-store.ts:300-333`) re-reads the file and re-base64-encodes on every prompt assembly — no memoization.
5. `convertToModelMessages` + `estimateModelMessagePayload` (`session/loop.ts:722-771, 928`) JSON.stringify the full model-message array (sanitized for the estimate, but the actual provider call still passes the unsanitized array). Every base64 string is deep-copied during sanitize.

Per turn, a single 600 KB image multiplies into hundreds of MB of transient heap.

## Root Cause (rule 1)

Two image storage layers coexist with no contract between them (rule 8 violation):

- **`AttachmentStore`** (`storage/attachment-store.ts`) — content-addressed `<projectDir>/.opencorvus/attachments/<sha>.<ext>`, served via HTTP `/attachment/<id>/<sha>.<ext>` (`server/routes/attachment.ts`).
- **`delivery-screenshots/`** (`delivery/tools.ts:588, 662-665`) — flat write to `<projectDir>/.opencorvus/delivery-screenshots/<stamp>-<label>/<file>.png`. Output flows through `imagePathToDataUrl` (`delivery/tool-result.ts:44`) which re-reads + base64-encodes the PNG into the tool result's `attachments[].url`.

Both `screenshot` and `verify_page_integrity` (delivery tools) and `compare_visual_artifacts` use the second path. **`AttachmentStore` is never touched by the delivery agent.**

Additionally, `AttachmentStore.write` is write-only — no reference counting, no sweep, no GC. Switching delivery tools to the store without GC just moves the unbounded growth from DB to FS.

## Non-Goals

- Do not rewrite the visual comparison contract. `compare_visual_artifacts` still returns image evidence the LLM can see; it just stops inlining base64 into JSON.
- Do not change provider-side multimodal encoding (Anthropic's `{type:"image", source:{type:"base64",...}}` still receives base64 — that conversion stays in `provider/transform.ts` where the AI SDK requires it).
- Do not migrate non-delivery image producers (`mirror/*`, `gui/screenshot.ts`, `design-analyst/url-screenshot-tool.ts`) in this pass — they already import `AttachmentStore` and have separate forensics needed. P2/P3.
- Do not preserve any `data:image/...;base64,` URL in `part.data` for backwards compatibility. rule 16: no compat patches. Migrate forward + reject inline at the write boundary.

## Design

### Step 1 — `AttachmentStore` GC (P0, precondition for migration)

New API in `storage/attachment-store.ts`:

```ts
export namespace AttachmentStore {
  /** Enumerate all `<sha>.<ext>` files under `<projectDir>/.opencorvus/attachments/`. */
  export async function listOnDisk(projectID: string): Promise<{ sha: string; name: string; size: number }[]>

  /** sha set referenced by any persisted `part.data` in the engine DB. */
  export function collectReferencedShas(): Set<string>

  /** Delete on-disk files whose sha is not in `collectReferencedShas()`. Returns deleted count and bytes. */
  export async function sweep(projectID: string): Promise<{ deleted: number; bytesFreed: number }>
}
```

- `collectReferencedShas`: single SQL pass `SELECT data FROM part`, regex extract `/attachment/[^/]+/([0-9a-f]{64})\.\w+/` matches. Used for both server startup sweep and ad-hoc CLI.
- Sweep runs **once at engine boot** after DB open and migrations (`server/server.ts` boot path), and on demand from a new bun script `script/attachment-sweep.ts`. No periodic timer — sweep on boot is enough given task lifecycles.
- Sweep deletes only orphans whose mtime is older than 60s (avoids racing concurrent writes during a sweep started just as a new task begins).

### Step 2 — Delivery tools migrate to `AttachmentStore` (P0)

`delivery/tool-result.ts`:

- **Delete** `imagePathToDataUrl` and `mimeFromExt` (the latter folds into `AttachmentStore.write`'s MIME handling already present at `attachment-store.ts:13-40`).
- **Replace** `buildMultimodalToolResult` so each `images[i].path` is read once, written to `AttachmentStore.write(projectID, bytes, mime, filename)`, and the returned `Reference.url` (`/attachment/<id>/<sha>.<ext>`) becomes the `attachments[i].url`. The MIME stays on the part, no base64 anywhere in the output.

`delivery/tools.ts`:

- **Replace** `path.join(projectDir, ".opencorvus", "delivery-screenshots", ...)` with a temp scratch directory **inside the worktree** (or `os.tmpdir()` namespaced by run ID) that holds the screenshot only long enough for `captureRuntimePage` to write it and `buildMultimodalToolResult` to hash it into `AttachmentStore`. **Delete the scratch directory** after the tool completes (success path) or after the next sweep (failure path). The persistent storage is `AttachmentStore`'s `.opencorvus/attachments/<sha>.<ext>` directory — single source.
- Update both `screenshot` and `verify_page_integrity` to consume the new scratch convention. Their tool-result JSON keeps emitting `path` for backward citation, but `path` now points at `/attachment/<sha>.<ext>` (the HTTP route) **not** a worktree relative path.

`delivery/agent.ts:177-184` comment block — refresh wording to mention `AttachmentStore` rather than the deleted `delivery-screenshots/` path.

### Step 3 — `Session.updatePart` write boundary guard (P0)

`session/index.ts:777-810`:

- Before the `db.insert(PartTable)` call, scan the serialized `data` once for `/data:[^;,"]+;base64,/`. On hit, throw `InlineBase64InPartError` with the offending part ID + the producer call-site (use `Error.captureStackTrace` so the throw points to the upstream).
- Reason: all 9 inline-base64 production sites flow through this single function. Any future regression that reintroduces inline data URLs fails at the boundary instead of bloating the DB silently.
- This is a host-side data-integrity gate (rule 6.1 second branch — schema-shaped, not LLM-decision), not a state machine.

Test (`packages/opencorvus/test/session/inline-base64-rejected.test.ts`):

- Inserts a `Message.ToolPart` whose `state.attachments[].url` is `data:image/png;base64,iVBOR...`. Assert `Session.updatePart` throws with `name === "InlineBase64InPartError"`.
- Inserts the same part with `url` rewritten to `/attachment/proj/<sha>.png`. Assert `updatePart` succeeds.

### Step 4 — DB reset, not migration (rule 18)

The standing project policy is to reset the engine DB on schema /
contract breaks instead of carrying forward-compatible migration code.
After landing the guard from Step 3, the deploy procedure is:

1. Stop overlay + engine sidecar.
2. Delete `opencorvus.db{,-wal,-shm}` under the engine's data dir.
3. Restart. Bootstrap recreates the schema; the first `Project.fromDirectory`
   call hooks `AttachmentStore.sweep` against the empty `part` table and
   any stale on-disk attachments get reaped.

See the "DB reset, not migrate" section below for the verified path.

### Step 5 — `AttachmentStore.inlineFileParts` memo (P1, follow-up)

Out of scope for this PR but tracked: per-session `Map<sha, InlineFilePart>` so successive turns within one task reuse the buffer. Will land separately to keep this change reviewable.

## Affected Call Sites (rule 35 enumeration)

| File:Line | Producer | Status under this plan |
|---|---|---|
| `delivery/tool-result.ts:44` (`imagePathToDataUrl`) | delivery PNG → data URL | **Delete function.** |
| `delivery/tool-result.ts:65` (`buildMultimodalToolResult`) | delivery multimodal builder | **Rewrite** to call `AttachmentStore.write`. |
| `delivery/tools.ts:588` (`screenshot.execute`) | writes to `delivery-screenshots/` | **Replace dir** with scratch + AttachmentStore. |
| `delivery/tools.ts:662-665` (`verify_page_integrity.execute`) | writes to `delivery-screenshots/verify-…/` | Same. |
| `delivery/tools.ts:571` (tool description "writes it to the project's .opencorvus/delivery-screenshots/ directory") | doc string | Update to reference `AttachmentStore`. |
| `delivery/agent.ts:178` (comment "image bytes into the delivery session") | doc string | Update wording. |
| `session/index.ts:777-810` (`Session.updatePart`) | single write boundary for all part producers | **Add guard.** |
| `storage/attachment-store.ts` (namespace) | content-addressed FS store | **Add GC.** |
| `session/loop.ts:1882-1900` (MCP image/resource → data URL) | MCP image content path | **Untouched** in P0; will trip the new guard if exercised. Triggers a follow-up to migrate MCP path (P1). |
| `attachment-store.ts:300-333` (`inlineFileParts`) | per-turn read+base64 | **Untouched** in P0; memo lands in P1. |
| `provider/transform.ts` (data URL → native binary) | provider-side encoding | **Untouched.** This conversion is mandated by AI SDK; happens once per call, not the OOM driver. |
| `mirror/visual/*`, `gui/screenshot.ts`, `design-analyst/url-screenshot-tool.ts`, `mirror/url/extract.ts` | other inline producers | **Untouched** in P0. Will trip the guard if exercised in delivery context; P2/P3 migrations. |

## Tests (rule 36)

- `test/session/inline-base64-rejected.test.ts` — guard rejects inline, accepts ref.
- `test/storage/attachment-store-sweep.test.ts` — write 3 attachments, reference 1 in a part row, sweep deletes 2 orphans; sweep skips files newer than 60s.
- `test/delivery/tool-result-attachment-ref.test.ts` — `buildMultimodalToolResult` produces refs, not data URLs; same image used twice in one tool result deduplicates to the same sha (verified by FS check).

## DB reset, not migrate (rule 18)

This project's standing policy is to reset the engine DB rather than write
forward-compatible migrations for in-flight rows (rule 18). After landing
this change, the deploy procedure is:

1. Stop the overlay + engine sidecar.
2. Delete `<XDG_STATE_HOME>/opencorvus/opencorvus.db{,-wal,-shm}` (Windows:
   `%LOCALAPPDATA%\opencorvus\.opencorvus\opencorvus.db{,-wal,-shm}`).
3. Optionally `rm -rf <projectDir>/.opencorvus/{attachments,delivery-screenshots}/`
   for any project where stale on-disk attachments would confuse the
   first post-reset sweep — the engine recreates `attachments/` lazily,
   and `delivery-screenshots/` is no longer written to.
4. Restart. The schema bootstrap creates a fresh DB; `AttachmentStore.sweep`
   on first project load sees an empty `part` table and reaps any
   leftover bytes on disk.

There is no migration tool. A `script/migrate-base64-parts.ts` was
initially staged but removed under rule 16 (no compat patches) once the
team confirmed reset is the canonical path.

## Out of Scope (for tracking)

- P1: `AttachmentStore.inlineFileParts` per-task memoization.
- P1: `session/loop.ts:1882-1900` MCP image/resource → AttachmentStore.
- P2: `mirror/visual/{render,evaluate}.ts`, `mirror/url/extract.ts`, `mirror/shared/image-constrain.ts` → AttachmentStore.
- P2: overlay `tree-writer.ts` renders `/attachment/<sha>` URLs (currently may render data URLs from historical parts; post-migration, no data URLs persist).
- P3: `gui/screenshot.ts`, `design-analyst/url-screenshot-tool.ts` audit.
- P3: provider-side binary handoff (`provider/transform.ts`) — current implementation is acceptable; revisit only if profiling shows the JSON.stringify path is the residual hot spot post-migration.

## Verification

Post-deploy DB check (run after the reset + first task that exercises
delivery's `compare_visual_artifacts`):

```sql
SELECT COUNT(*) FROM part WHERE data LIKE '%data:image/%base64,%';
-- expected: 0 (the write-boundary guard rejects any inline base64,
-- so a non-zero count means an unmigrated producer path leaked
-- through — fix root cause, do not soften the guard).
```

```sql
SELECT COUNT(*), SUM(LENGTH(data)) FROM part
WHERE data LIKE '%"/attachment/%';
-- expected: > 0 after compare_visual_artifacts fires; rows are small
-- (refs only) rather than 600 KB each.
```
