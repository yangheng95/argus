# Visual QA Browser Preview Evidence Bridge

## Recall

### Original request

- Diagnose whether task `tsk_fb1739b02001u2LKIdslh4WB0L` reviewed screenshots
  from its message stream or from disk-backed image storage.
- Explain the normal evidence flow and whether the failure is systemic.
- Repair the shared infrastructure logic and obtain an independent Agent audit.

### Acceptance indicators

- Every projected Visual QA worker, including the `general` profile, can invoke
  one explicit task-scoped Browser Preview capture producer after a ready
  `browser_preview_target` exists.
- The producer reuses the existing Node/Playwright Browser Preview verification
  and persistence path and returns exact `engine_artifact` locators for
  screenshot-bearing `browser_preview_evidence`.
- The same tool result returns the exact captured images as ordinary
  multimodal attachments so the reviewing model actually inspects the bytes it
  later cites.
- Visual QA searches, completely reads, selects, and registers those exact
  locators before recording a positive judgment.
- AttachmentStore remains the canonical byte transport/store and does not gain
  Visual QA domain semantics.
- The core `visual_review` remains the sole durable Visual QA report. A worker
  must not publish a parallel `general/visual_qa_review` substitute.
- Nonempty VisualReview `completeness_findings` remain visible facts and are
  explicit non-completion evidence for the Orchestrator's next natural
  scheduling decision; no Host completion gate is added.
- Integrity remains system-review-only and does not become a second visual
  verdict owner.
- Focused non-UI contract tests, typecheck, docs health, and a real manually
  inspected Browser Preview capture pass.

### Hard constraints

- Do not restart, refresh, terminate, or mutate the currently running
  OpenCorvus/Overlay task.
- Preserve every unrelated dirty-worktree change. Do not stash, reset, restore,
  broadly format, broadly stage, or create another worktree.
- Do not add a fallback, compatibility path, hidden message, synthetic review,
  Host gate, workflow state machine, or screenshot cache authority.
- Use Node for Playwright-backed capture. Do not add, modify, update, or run UI
  automation tests.
- Visual QA is review-only and cannot repair product source.
- Keep `browser_preview_target` and `browser_preview_evidence` as the canonical
  Task Preview facts and AttachmentStore as byte storage.
- New commits on the current beta line use the `dsw-33987` prefix and must be
  pushed to `myhexin` without bypassing hooks.

### Durable material read

- `specs/current/architecture/02-data.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/records/2026-07/2026-07-02-visual-evidence-bundle-authority-repair.md`
- `specs/records/2026-07/2026-07-04-direct-build-outcome-and-visual-qa-contract.md`
- `specs/records/2026-07/2026-07-22-renderable-html-visual-qa-scheduling.md`
- Immutable SQLite task/session/message/part/artifact facts for
  `tsk_fb1739b02001u2LKIdslh4WB0L`.

### Incident evidence

1. Visual QA Session `ses_04e72f274ffdOTi0ytRUw47eiz` invoked six Browser MCP
   screenshot calls and nine Browser MCP observe calls. Those calls returned
   PNG AttachmentStore refs and the model received the image bytes through the
   normal tool-result replay path.
2. Its `browser_preview` call omitted an explicit URL for
   `python3 -m http.server 8080`; the tool returned
   `target.status="missing"` and persisted no target for that startup.
3. The worker continued against a manually navigated Browser MCP session,
   registered 23 passed checks, registered zero evidence rows, and recorded
   `accepted=true`.
4. `update_visual_qa_judgment` visibly reported that every check lacked
   evidence and that the positive judgment had no fresh screenshot-bearing
   evidence.
5. The persisted core VisualReview
   `art_fb1913810001X2jZOcPouofxlG` has `review.evidence=[]` and nonempty
   completeness findings.
6. The worker separately published
   `general/visual_qa_review`; a later delegated system reviewer read that text
   artifact and the HTML resource rather than the core VisualReview. It did not
   own or perform a second visual verdict.

### Whole-repository call-point search

| Surface | Call points | Disposition |
| --- | --- | --- |
| MCP image transport | `mcp/materialize.ts::materializeMcpToolResult`, `session/loop.ts`, expert-squad MCP projection, MCP App host | Preserve as byte/message transport. Do not automatically turn every MCP image into acceptance evidence. |
| Attachment replay | `session/message.ts`, `provider/transform.ts`, `storage/attachment-store.ts` | Preserve canonical content-addressed bytes and on-demand provider replay. No Visual QA semantics belong here. |
| Preview target startup | `tool/browser-preview.ts`, `browser-preview/target.ts`, Browser Preview routes | Preserve one target authority; clarify that commands without a printed URL require explicit `url`. |
| Preview capture producer | `browser-preview/verification.ts`, `verification-core.ts`, `persist.ts`, `POST /task/:taskID/browser-preview/capture` | Reuse this single producer from a new explicit Visual QA capture tool. Extract only shared request/target resolution needed to avoid route/tool drift. |
| Visual QA tool surface | `visual-qa/static-tools.ts`, `visual-qa/agent.ts`, `agent/tool-pool-data.ts`, `agent/dispatch-adapter-contract.ts` | Add the capture tool to the shared base Visual QA evidence surface, not to one expert squad. Keep comparison tools package-projectable. |
| Visual QA evidence validation | `visual-qa/evidence.ts`, `output-tools.ts`, `acceptance-semantics.ts`, `schema.ts` | Preserve strict exact-locator validation. Update prompt/tool-result guidance so completeness findings trigger continued evidence work or an honest non-pass judgment. |
| VisualReview persistence | `orchestrator/visual-qa-stage.ts`, `visual-qa/persist.ts` | Preserve the stage-owned core artifact as the sole durable review report. Prohibit a parallel generic report substitute in the worker prompt. |
| Visual feedback verifier | `acceptance/visual-feedback-verification.ts`, metrics executor | Preserve as a strict Host observation contract. Do not turn it into a completion gate or require reference comparison for greenfield screenshot acceptance. |
| Integrity | `prompt/core/integrity-team-core.txt`, `integrity/**` | Preserve the boundary: Integrity audits implementation defects exposed by VisualReview and does not own final rendered acceptance. |
| Orchestrator completion | `prompt/core/orchestrator-core.txt`, `orchestrator/task-lifecycle-tools.ts` | Make exact core VisualReview completeness facts explicit scheduling evidence. Preserve natural lifecycle judgment and empty evidence-list visibility. |
| Tool/contract tests | Browser Preview tool/verification tests, Visual QA agent/evidence tests, Orchestrator prompt/description tests | Add positive non-UI producer/locator/projection tests. Do not run existing Browser/Playwright UI tests. |
| Documentation | this record, both specs indexes, current verification/evidence architecture if semantics change | Keep one indexed task record and update current docs only for the new explicit tool contract. |

### Independent Agent feedback

- The independent read-only Agent confirmed the defect is a shared
  producer/consumer capability gap, not a Task, model, or General-squad
  exception.
- It traced all four common MCP materialization callers and confirmed that
  `materializeMcpToolResult()` correctly owns AttachmentStore/message
  transport only. Automatically publishing every Browser MCP image there
  would be hidden behavior without reliable Task target, viewport, state, or
  reviewer intent.
- It confirmed that `POST /task/:taskID/browser-preview/capture` already owns
  the one formal `preview-capture` production path through
  `verifyBrowserPreview()` and `persistBrowserPreviewEvidenceBatch()`.
- It recommended one explicit `browser_preview_capture` tool at the Browser
  Preview tool boundary, projected through the shared Visual QA base surface.
  The tool and HTTP route must call the same capture service and the tool must
  return target ID, viewport ID, Evidence ID, exact Engine Artifact locator,
  operation/status, and exact capture resource locator.
- It confirmed that the strict Visual QA consumer is correct and must not be
  relaxed to accept AttachmentStore URLs, display refs, paths, or bare IDs.
- It rejected a Host completion lock, an Integrity screenshot verdict, a
  hidden target/capture state machine, URL guessing in the capture tool, and a
  parallel `visual_qa_review` Artifact.
- It recommended positive non-UI contracts for capture persistence, exact
  locator/resource readability, Visual QA registration with empty
  completeness findings, General plus non-General projection, and exact
  completion-decision evidence identity.
- The Agent made no file changes, ran no UI automation tests, and did not
  delegate further.

## Causal chain

The shared Visual QA contract requires exact screenshot-bearing Browser Preview
Artifact locators, but the shared `general` Visual QA surface can only start a
preview service and use Browser MCP message attachments. The canonical
`preview-capture` producer exists behind the Task HTTP route but has no
reviewer-callable tool. The worker therefore sees real pixels yet cannot
materialize the evidence identity demanded by its output tools. It records a
contradictory positive judgment, publishes a parallel prose artifact, and the
Orchestrator later sees an easier-to-read pass story beside the incomplete core
VisualReview.

The terminal symptom is not a screenshot-cache bug. It is a producer/consumer
capability disconnect plus a parallel report authority and insufficiently
salient completeness facts.

## Implementation plan

1. Extract the Browser Preview capture request schema and exact persisted-target
   resolution needed by both the HTTP route and tools.
2. Add a shared `browser_preview_capture` tool that invokes the existing
   `verifyBrowserPreview` producer, returns exact evidence locators, and
   attaches the exact persisted capture bytes for direct model inspection.
3. Project the tool through every Visual QA base runtime while leaving optional
   reference-comparison tools package-owned.
4. Update Visual QA prompt semantics: establish a ready target, explicitly
   capture, search/read/select/register exact evidence, continue after
   completeness findings, and never publish a generic report substitute.
5. Update Orchestrator prompt/tool guidance to search and read the latest core
   VisualReview and treat its completeness findings as evidence for redispatch
   or responsible repair rather than prose acceptance.
6. Add focused positive non-UI contracts for exact capture locators,
   multimodal attachment identity, shared Visual QA projection, and
   Orchestrator-visible completeness semantics.
7. Run focused non-UI tests, typecheck, generated/API/docs checks, then start a
   real page and manually inspect fresh screenshots without saving an
   automation test.
8. Incorporate the independent Agent review, run a final local review, commit
   only task-owned files with `dsw-33987`, fetch/merge current `myhexin` state
   if required, and push through hooks.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| One capture producer | Tool and HTTP route both invoke the existing Browser Preview verification service. |
| Exact evidence identity | Tool result includes exact Engine Artifact locators whose rows are `browser_preview_evidence` and whose capture resource bytes are readable. |
| Model sees cited bytes | Tool result image attachment SHA equals the persisted Browser Preview capture resource SHA. |
| All Visual QA profiles | General and package-projected Visual QA tool surfaces both include `browser_preview_capture`. |
| Honest review facts | A registered screenshot locator supports a positive review with no completeness finding; unsupported positive facts remain visibly incomplete. |
| No shadow report | Prompt and stage contract identify the core `visual_review` as the only durable report. |
| Natural scheduling | Orchestrator guidance consumes core completeness facts without a Host-side veto. |
| Runtime acceptance | A real Task-scoped preview target produces a fresh screenshot that is manually inspected. |
| Repository health | Focused non-UI tests, typecheck, API/docs checks, `git diff --check`, hooks, and independent review pass. |

## Runtime verification results

- The final focused positive non-UI suite produced twelve passing cases across
  shared persisted-target resolution, General/package Visual QA projection,
  exact locator plus capture-resource readability, identical capture/
  attachment SHA, explicit interaction-state provenance, persisted core
  VisualReview closure, same-path Database replacement ownership, and portable
  MySQL transfer identity.
- Package typecheck and API route inventory passed.
- Historical-doc links and document health passed after the indexed record
  entered the Git index.
- A real isolated Task invoked the shared Node/Playwright capture service
  against `http://127.0.0.1:8080/` at the persisted `desktop` 1440 by 900
  viewport. It returned `status=passed`, exact Artifact
  `art_fb1b785fe0014TuKyMCLMBZ3BM`, and one capture resource plus attachment
  with the identical SHA-256
  `5a2b48c07f38ab620923c2345de9c2b3dcc37c806a1b70aa43079d03536be914`.
  The exact persisted PNG was opened and manually inspected: the finance
  dashboard rendered with its full sidebar, four summary cards, trend panel,
  and account-balance panel at the contracted desktop viewport.

## Validation isolation incident

The runtime acceptance used an isolated `OPENCORVUS_HOME` database but opened
the pre-existing incident project directory. Project initialization ran
AttachmentStore sweep against that directory using only the temporary
database's reachability set. It deleted 14 existing message-attachment PNG
blobs (954,648 bytes) referenced by the original database. No source file,
original database row, Task Artifact snapshot, or `docs/screenshots` file was
deleted. The deleted blobs were ordinary Browser Model Context Protocol (MCP)
screenshot/observe message attachments; immutable metadata still identifies
their exact URLs, but no duplicate bytes, open file descriptors, local
snapshot, or Spotlight copy was available for byte-exact restoration.

The test-created Task runtime and attachment were moved out of the project
directory into `/tmp/opencorvus-visual-capture-TUpmDY`; the original server and
Task were not restarted or terminated. This incident is separate from the new
capture producer path: it exposes a pre-existing cross-database
AttachmentStore sweep ownership defect. It must remain visible in handoff and
independent audit rather than being described as restored.

The root ownership defect is now repaired by an AttachmentStore authority
record that binds one physical project store to exactly one project, resolved
worktree, and Database-internal durable instance ID. The ID survives ordinary
reopen and lossless schema refresh but changes after same-path reset, file
replacement, fresh rebuild, or MySQL import. The local authority table is
excluded from portable transfer schema/snapshots, so an import target generates
its own instance ID after restoring business data. Both write and sweep enforce
that identity. A
pre-marker non-empty store can only be claimed when the current Database
references every on-disk blob; a foreign or partial Database receives a typed
authority error before orphan classification. This prevents the deletion path
from recurring, but it cannot reconstruct the 14 bytes already deleted during
this investigation.

The independent audit also identified dynamic Browser interaction states as a
separate evidence gap. Visual QA now has an explicit interaction-state capture
producer: it resolves a completed canonical Browser MCP screenshot/observe
tool part in the current Session, verifies the attachment project, raw PNG
bytes, dimensions, SHA-256, and canonical Browser source URL against the
persisted target origin/path boundary, then atomically publishes a Task-scoped
`preview-capture` evidence row with an explicit `stateID`, source URL, and
source tool-part provenance. The positive contract persists and reads one
complete core `visual_review` using that exact evidence locator and obtains no
completeness findings.

## Final independent audit revision

The final read-only audit initially blocked submission because the first
authority draft hashed only `Database.Path()` and therefore did not distinguish
a same-path reset, while the first interaction producer did not bind the
Browser source URL to its declared target. It also found that the contract
stopped at a collector snapshot instead of reading a persisted core
`visual_review`. The implementation and positive contracts were revised as
described above. Submission remains blocked until the same independent Agent
rechecks these exact changes and approves them.

The second audit found two remaining transport-detail gaps: MySQL transfer
still copied the new local identity row, and the independent interaction
manifest did not carry the target URL even though the Evidence payload did.
The transfer inventory now excludes the local authority table and its
round-trip contract proves that business rows survive while the destination
identity changes. The manifest now records both top-level source and target
URLs, and the evidence test reads the persisted manifest bytes to verify both.

The same independent Agent completed a third read-only audit after these
changes and approved the repair with no remaining blocker. It confirmed that
every MySQL transfer phase derives from the one filtered portable-table
inventory and that the interaction test reads the final persisted manifest
resource rather than only inspecting an in-memory request.
