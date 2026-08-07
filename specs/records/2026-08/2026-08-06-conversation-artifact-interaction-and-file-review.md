# Conversation Artifact interaction and file-review design

Status: Implementation verified; git-cc push pending
Date: 2026-08-06
Owner: Codex

## Recall

### User request

- Replace the current Conversation Artifact display, which only announces that outputs exist, with a genuinely inspectable and interactive form.
- Show changed files in the Conversation in the compact Codex style and let an operator act on an exact file.
- Investigate the implementation first, including whether Agents should declare their primary outputs before the interface renders them.

### Acceptance criteria

1. A Task or Mission completion Turn keeps the immutable Completion Decision as the sole declaration of intentionally delivered Artifacts.
2. Every displayed Artifact row is keyboard-operable and opens an inline inspector backed by its exact `ArtifactReadLocator`; the interface does not copy the Artifact into a message-owned `interactive_artifact`.
3. Engine Artifact JavaScript Object Notation (JSON) is searchable and collapsible. Task Artifact snapshots expose their exact tree/resource inventory, and selecting a resource reads or downloads that exact immutable resource.
4. Provider, digest, ownership, media-type, and read failures remain visible; no unsupported content is presented as a successful empty preview.
5. The terminal Conversation file-change card keeps one canonical change-group projection, shows compact per-file statistics, and makes each row open Review with that exact group and path selected.
6. Hydration and live terminal refresh use the same server projection and the same Artifact/file identities.
7. Positive non-User Interface (UI) contracts cover exact Task ownership, Engine Artifact reads, snapshot inventory reads, resource reads, and exact file-focus intent. UI behavior is accepted only through a real running page, interaction, screenshot inspection, correction, and retest.
8. Typecheck, production build, route/document generation, localization, document health, final diff review, commit, and git-cc push succeed.

### Hard constraints

- No fallback renderer, extension/title guessing, workspace rescan, duplicate Artifact store, synthetic message, hidden message, UI-only Artifact payload, state machine, workflow gate, database migration, or compatibility reader.
- `task_completion_decision.payload.deliverable_artifact_locators` remains the only primary-deliverable declaration. A pre-production Agent declaration is planning intent, not delivery authority, and must not become a second stored truth.
- `readTaskArtifact` remains the only Task Artifact content reader. The new Hypertext Transfer Protocol (HTTP) surface is a scoped transport projection of that reader, not another read implementation.
- `SessionSummary.diff`, Task acceptance change groups, and live message parts remain the existing file-change authorities. The Conversation card is only a projection and Review remains the only full diff owner.
- Do not add, modify, or run UI automated tests. Delete any prohibited UI or negative tests encountered in touched paths rather than updating them.
- Do not reset, stash, create a worktree, disturb a running OpenCorvus client, or include unrelated concurrent changes.

### On-disk material read

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-07/2026-07-19-inline-interactive-artifact-protocol.md`
- `specs/records/2026-07/2026-07-19-agent-message-file-change-evidence-design.md`
- `specs/records/2026-07/2026-07-27-conversation-artifact-file-summary.md`
- `specs/records/2026-07/2026-07-28-conversation-terminal-artifact-overview-repair.md`
- `specs/records/2026-08/2026-08-02-conversation-turn-artifact-projection-repair.md`
- `specs/records/2026-08/2026-08-04-review-live-diff-resolution.md`
- `specs/records/2026-08/2026-08-05-task-artifact-resource-set-abi-repair.md`
- Current Artifact Catalog, Task Artifact store, completion decision, conversation hydration, card-tree, turn summary, interactive-artifact, file-change, Review, diff-selection, route, and localization sources.

### Full-repository search result

- `ConversationTurnArtifactSummary` renders catalog metadata in inert `div` rows. No Overlay service or route reads a Task Artifact locator for that component.
- `readTaskArtifact` already validates Task ownership, immutable digests, canonical Engine Artifact payload blocks, snapshot manifests, UTF-8 text windows, and binary resources. Agent tools and package hosts use it, but the Conversation has no scoped transport to it.
- The separate message-owned `interactive_artifact` protocol has twenty mature renderers and real Session/message ownership. Re-publishing a Task Artifact into it would duplicate payload and authority, so it is not the repair.
- Completion already atomically records every intentional deliverable locator and exact Orchestrator message identity. Asking each worker to maintain an earlier primary-output list would add weaker intent beside stronger delivery fact.
- `ConversationArtifactSummary` already computes exact rows and aggregate statistics, but each row is a non-interactive `div`. Its Review action emits only a broad focus event. `FileChangesView` already owns exact `DiffTarget` selection and can accept a group/path focus intent without adding a store.
- Current `PatchPart` still carries only `hash` and string file paths. That older contract cannot truthfully supply per-message statistics or lazy body resolution, so this task will not label those incomplete rows as a Codex message-level diff. The terminal canonical summary is the safe delivery boundary for the requested file list.

### Independent Agent feedback

The user requested an independent audit after the first implementation. Three read-only Agents reviewed backend authority and transport, Overlay lifecycle and interaction, and delivery evidence without delegating further or modifying files. Their confirmed findings, independently rechecked by the primary Agent, are:

- The conditional object-URL primitive breaks when one snapshot inspector switches between text and binary resources.
- Artifact pagination has no cancellation path, so collapsed or superseded reads continue consuming network and backend work.
- Binary bytes are copied into base64 and JSON without a resource-size boundary, causing avoidable memory amplification.
- The Conversation route exposes the general reader's `materialized_file` write mode even though this surface is read-only.
- Exact Review focus uses one transient global event; missing/not-yet-resolved rows throw outside a visible error surface and the intent is not replayed.
- The recorded positive contract covers only one Engine Artifact read although acceptance requires exact ownership, snapshot, text-resource, binary-resource, pagination, and file-focus contracts.
- The recorded implementation status overstates delivery while git-cc has not accepted the branch.

The audit also raised two points that are not accepted as root defects: canonical Task media types forbid parameters, so parameterized media dispatch is outside this contract; Task-scoped Artifact read is an existing catalog authority rather than a new confidentiality boundary, so Completion Decision remains the Conversation selection authority and is not converted into a host workflow gate.

### Repair acceptance

1. Object URLs follow the current optional binary content reactively, revoke the previous URL on every change/unmount, and survive text → binary → text → binary selection.
2. Closing an inspector or selecting a different resource aborts the superseded whole pagination chain.
3. Conversation HTTP input is inline-only. Binary delivery does not base64-wrap bytes in JSON and does not expose a Host materialization path.
4. Exact Review focus is durable until the canonical row becomes available, selects exactly once, and reports a visible typed failure only when current resolved evidence proves the target unavailable.
5. The Overlay consumes the backend-validated snapshot manifest contract without introducing a second handwritten schema; the on-disk design wording matches the actual trust boundary.
6. Positive non-UI tests cover Engine Artifact, snapshot manifest, UTF-8 paginated text resource, binary resource transport, exact Task ownership, and durable file-focus resolution. No UI or negative tests are added or run.
7. Real-page manual verification explicitly covers text → binary → text switching, rapid resource switching/collapse, and exact Review focus from a freshly closed Review surface.
8. Only after all checks, second review, commit, and git-cc push succeed may this record return to `Implemented and verified`.

## Root cause

The backend already knows which outputs were intentionally delivered and can read each one exactly. The Conversation projection discards the actionable locator at the final rendering boundary and reduces the entry to label, type, and resource count. The resulting card is truthful but inert.

File changes suffer a smaller version of the same boundary loss. The terminal card owns exact normalized rows, but a row click cannot carry its exact group and path into the existing Review selection owner. Only the coarse Review button is wired.

## Single-source design

### Deliverable declaration

Do not add `declare_primary_artifacts` or a preflight declaration field. Agents may narrate intended outputs in their ordinary plan, but only the Orchestrator's terminal Completion Decision declares delivered outputs. The UI will name these entries “Deliverables” and preserve their recorded order.

### Exact Artifact inspector transport

Add one Task-scoped, inline-only read operation that accepts `ArtifactInlineReadInputSchema`, derives the existing `artifactCatalogAuthority`, and calls `readTaskArtifact`. The response body is the exact canonical byte window; standard `Content-Type`, `Content-Range`, `Content-Disposition`, and Entity Tag (`ETag`) headers carry the verified immutable metadata. Text stays paginated by byte offset, while a canonical binary attachment is returned once as raw bytes without JavaScript Object Notation (JSON) or base64 amplification.

The route does not search, reinterpret, materialize a workspace file, or cache a second body. Exact ownership and digest failures remain typed request failures.

### Inline Artifact interaction

- Artifact rows become disclosure buttons with visible selected/open state.
- An Engine Artifact exact JSON payload is projected into the existing searchable/collapsible tree primitive. The raw canonical JSON remains copyable; the tree is derived presentation only.
- A snapshot manifest is parsed through the shared Task Artifact manifest schema and shown as a searchable resource inventory grouped by its declared tree. Selecting a row constructs the exact resource locator from the verified manifest and reads that resource through the same endpoint.
- Resource presentation follows the declared media type. JSON uses the tree; Markdown uses the safe document renderer; supported source media types use the existing read-only code surface; image, audio, video, and Portable Document Format (PDF) bytes use their mature browser/native presentation; other binary media exposes exact metadata and an explicit download action. There is no extension- or title-based inference and no silent renderer fallback.
- Only one Artifact row is expanded in a summary at a time. This is local disclosure presentation, not persisted workflow state.

### Codex-style changed files

Render each terminal file row with the shared button/file-row primitives. Its activation records one durable `{ taskID, groupID, filePath }` focus intent and asks the uniquely registered Review presenter to open the existing panel. `FileChangesView` consumes the intent when its canonical groups settle, clears filters that would hide the target, selects the exact `DiffTarget`, scrolls the row into view, and reports a visible failure only after settled evidence proves that target unavailable. The header Review action opens the same presenter without creating an exact-file intent.

## Implementation and verification order

1. Commit this design and attempt the required git-cc baseline push.
2. Add the strict read response schema, route, service, and positive backend contracts for Engine Artifact, snapshot, text resource, and binary resource reads.
3. Add the inline inspector, exact resource navigation, localization, and styles using existing primitives.
4. Extend Review focus intent and convert terminal file rows to exact buttons.
5. Run focused non-UI contracts, package typechecks, Overlay production build, route/document checks, localization, and document-health checks.
6. Start an isolated real complete Overlay page with real Task data, open an Engine Artifact, inspect a snapshot resource, activate an exact changed file, capture screenshots, inspect them manually, correct the implementation, and repeat.
7. Perform a second source/diff review, update this record with evidence, commit with the `dsw-33987` prefix, and push the current branch to `myhexin` without bypassing hooks.

## Delivered implementation

- Added `POST /task/:taskID/artifact-read` as the inline-only Task-scoped Hypertext Transfer Protocol (HTTP) projection of the canonical `readTaskArtifact` reader. It returns exact raw byte bodies with canonical media type, byte range, disposition, and digest headers; it exposes neither base64 JSON nor Host materialization.
- Added one cancellable Conversation Artifact loader that follows canonical UTF-8 byte windows, verifies stable media type/digest/length facts, and accepts binary bytes only when the canonical read is complete. Collapsing or superseding an inspector aborts the active pagination chain.
- Replaced inert terminal Artifact rows with keyboard-operable disclosures. Engine JSON uses the existing searchable tree renderer; Task Artifact snapshots expose searchable resources; exact resources use the existing document, code, media, and PDF renderers according to their declared media type; unsupported binary content exposes metadata and download.
- Made binary object URLs reactive across repeated text-to-binary transitions and guaranteed previous URL revocation on replacement or unmount.
- Preserved canonical change-group identity in every terminal file row. Activating a row stores a durable exact task/group/path request, opens Review through its single presenter, clears filters that could hide the target, selects the existing `DiffTarget`, and scrolls that target into view.
- Kept `task_completion_decision.payload.deliverable_artifact_locators` as the single declaration of primary delivered outputs. No pre-production declaration, message-owned Artifact copy, compatibility reader, or fallback renderer was added.

## Verification evidence

### Positive non-UI contracts and static verification

- `bun script/run-with-inactivity.ts --inactivity-ms 120000 -- bun test --timeout=0 test/server/conversation-artifact-read.test.ts`: passed, 3 tests and 26 assertions. The contracts address exact Engine Artifacts owned by two different Tasks, read a snapshot manifest, reconstruct a multibyte UTF-8 resource from five-byte windows, and verify a binary resource's raw bytes, byte range, media type, disposition, digest, and exposed cross-origin headers.
- `bun test test/review-focus-contract.test.ts` in `packages/overlay`: passed, 2 tests and 2 assertions. The contracts resolve one exact group/path to its canonical diff target and propagate caller cancellation into the active Artifact request.
- `bun run typecheck` in `packages/plugin`: passed.
- `bun run typecheck` in `packages/opencorvus`: passed.
- `bun run typecheck` in `packages/overlay`: passed.
- `bun run check:i18n` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed. `TreeArtifact` and `FilePreviewArtifact` remain separate lazy chunks; the earlier static-import chunk warning is absent.
- `bun run api:routes-check`: passed, 6 rules across 33 route files.
- `bun run docs:check`: passed, 312 operations across 24 groups.
- The repository's former historical-document test path no longer exists after the separately committed test-suite reset. It was not recreated as a compatibility test; the current authoritative document and generated API checks above passed.

### Real page and manual visual review

An isolated real OpenCorvus server, database, Task, Mission, and Vite Overlay were used; no UI automated test, fixture, baseline, or pass/fail screenshot assertion was created.

- The Task Conversation rendered two declared deliverables and two changed files.
- Opening the Engine Artifact performed the exact read and showed `application/json`, 858 bytes, its digest, searchable content, and a collapsible 31-node tree.
- Opening the Task Artifact snapshot performed the exact manifest read and exposed two resources. Searching for `implementation` reduced the inventory to the matching resource.
- Opening `docs/implementation.md` performed the exact resource read and rendered its Markdown heading and list with `text/markdown`, 107 bytes, and its digest visible.
- Switching text → image → text → image displayed the current content each time. Rapid text/image/text selection followed by collapse left the text view intact and the snapshot closed; superseded reads did not surface stale content.
- The binary resource used the real application icon (`image/png`, 10,181 bytes), so the media renderer was visually inspectable rather than being accepted against an empty placeholder.
- Activating `src/artifact-panel.tsx` opened Review on `mission / src/artifact-panel.tsx` and its `false → true` diff. Activating `src/artifact-reader.ts` switched Review to that exact added file and its own diff.
- Screenshots were inspected manually at each state. The compact row hierarchy, inline inspector, snapshot resource inventory, rendered Markdown, and exact Review selection matched the intended desktop layout. The isolated server and Vite process were then stopped and the browser tabs finalized.

### Second review

- Confirmed the inspector does not copy Task Artifact payloads into message-owned `interactive_artifact` storage.
- Confirmed no Artifact inference uses filenames, titles, or extensions; presentation is selected only from canonical source and declared media type.
- Confirmed same-path changes from different groups remain separate rows so each row resolves one exact Review diff.
- Confirmed exact file focus no longer depends on a transient window event: one durable intent is consumed once by the canonical Review rows after their evidence settles.
- Confirmed the temporary visual-verification seeding script, isolated server, Vite process, and browser tabs were removed or stopped after manual inspection.
- Confirmed generated Software Development Kit (SDK), OpenAPI, and reference documentation changes correspond to the single new route.

### Delivery state

- Implementation commit `1290d85b91` and remote-convergence merge commit `9ddf300e81` both use the required `dsw-33987` prefix.
- The latest `myhexin/v0.0.33beta` changes were fetched and merged without conflict before the final push attempts.
- The full pre-push hook passed Software Development Kit (SDK) imports, Artificial Intelligence (AI) runtime ownership, all-package typechecks, route inventory, generated documentation, Overlay internationalization, and secret scanning.
- Two post-merge push attempts, including an explicit Hypertext Transfer Protocol version 1.1 (HTTP/1.1) attempt, were rejected after the successful hooks because the git-cc endpoint emitted `protocol error: bad line length character: {"co` and closed the connection. A subsequent `git ls-remote` confirmed that the remote remained at `09814d2fe2`; therefore remote delivery is not claimed and this record remains `git-cc push pending`.
