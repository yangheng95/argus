# Agent Message File-Change Evidence Design

Status: proposed; implementation has not started

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request                     | Design the mechanism needed for a message-card component that shows the files actively modified by each Agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Acceptance criteria              | Each displayed change is causally owned by one persisted Agent session and assistant message; live updates and reload hydration produce the same rows; Edit, Write, Apply Patch, Shell, formatters, and other in-session writers use one capture path; add/modify/delete, text/binary, error/abort, repeated edits, and concurrent isolated Agent runs are covered; the message card does not infer ownership from the current workspace dirty set or tool names.                                                                                                                                                                                                                                                                                         |
| Hard constraints                 | Preserve one message/card truth source; no fallback, compatibility parser, second event stream, watcher-as-attribution, hidden message, polling loop, workflow gate, state machine, or duplicated file-change store. Writable Agents need isolated directories for exact attribution. Reuse the current Snapshot, Session writer, protocol mirror, conversation hydration, card-tree, file-row, disclosure, and diff primitives. Frontend implementation requires a real Node-launched Playwright desktop page, screenshot inspection, correction, and retest. Do not restart or refresh the user's running OpenCorvus/Overlay. Preserve the unrelated untracked `C:/` directory.                                                                         |
| Disk records read                | `AGENTS.md`; `specs/current/architecture/02-data.md`, `03-control.md`, `07-panel.md`, `09-verification-evidence.md`, `12-overlay-card-system.md`, `14-agent-runtime-mode.md`; `specs/records/2026-07/2026-07-06-current-project-goal-diff-and-graph-repair.md`; current Session, Snapshot, watcher, tool, protocol, conversation, card-tree, diff, and File Changes sources and focused tests.                                                                                                                                                                                                                                                                                                                                                            |
| Whole-repository search evidence | `rg` enumerated `FileWatcher.Event.Updated`, `File.Event.Edited`, `Session.Event.Diff`, `Message.Event.PartUpdated`, `Snapshot.track/patch/diffFull`, `SessionSummary`, `PatchPart`, every `type === "patch"` consumer, mutation-tool metadata, conversation hydration, tree-writer event policy, `FileChangesView`, `ChangesPanel`, and `file-change-summary` call sites. The existing watcher event contains only `file` and add/change/unlink; Tool context already contains `sessionID`, `messageID`, `agent`, and `callID`; every language-model step already records start/finish snapshots; persisted `patch` parts already flow through `message.part.updated`, protocol storage, Server-Sent Events (SSE), transcript hydration, and card parts. |
| External source evidence         | Node documents that `fs.watch` varies by platform, may be unreliable on network/virtualized filesystems, and may omit a filename; therefore a watcher is not durable ownership evidence. Git documents `--name-status`, `--numstat`, and `-z` as machine-oriented diff formats; the existing Snapshot implementation already wraps equivalent Git tree comparisons. Sources: [Node file-system watcher caveats](https://nodejs.org/api/fs.html#fswatchfilename-options-listener), [Git diff](https://git-scm.com/docs/git-diff), and [Git diff format](https://git-scm.com/docs/diff-format.html).                                                                                                                                                        |
| Independent Agent feedback       | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Git baseline                     | `v0.0.9beta` matched `myhexin/v0.0.9beta` before this design record; the pre-change push and repository hooks passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Finding

The system does not need another file watcher. It already has the correct
causal boundary but currently persists too little data at that boundary.

`file.watcher.updated` answers only “a path changed in this project instance.”
It has no Session Identifier (ID), Agent ID, message ID, tool-call ID, before
image, after image, or durable replay identity. Adding the currently active
Agent to this event would be incorrect whenever two sessions share a directory,
an editor saves concurrently, a formatter writes multiple files, or the event
arrives after the responsible tool has settled.

The existing language-model step boundary is stronger:

1. `session/processor.ts` records `Snapshot.track()` at `start-step`.
2. The executing tool chain already belongs to one persisted `sessionID`,
   `messageID`, exact projected `agentID`, and optional `callID`.
3. `finish-step` records another Snapshot tree and currently creates a
   persisted `patch` part.
4. `Session.updatePart` publishes `message.part.updated`; the existing protocol
   mirror persists and streams it with Agent/session/message identity.
5. Conversation hydration reloads the same persisted part, and `tree-writer`
   projects it into the same message card.

The root problem is therefore the current `PatchPart` payload
`{ hash, files: string[] }`. It is sufficient for bounded model evidence and
revert paths, but not for a rich message-card file component: status, line
statistics, before/after bodies, and binary identity are missing. The Overlay's
current Agent file collector consequently depends on heterogeneous mutation
tool metadata and deliberately ignores the canonical string-only patch list.
That loses Shell and other indirect writers and creates two partial sources.

## Single-Source Contract

Replace the current PatchPart payload directly; do not retain the old shape or
add a parallel `agent_file_change` event/table.

```ts
type PatchPart = PartBase & {
  type: "patch"
  beforeSnapshot: string
  afterSnapshot: string
  changes: Array<{
    file: string
    status: "added" | "deleted" | "modified"
    additions: number
    deletions: number
    isText: boolean
  }>
}
```

The part row supplies `id`, `sessionID`, `messageID`, and `orderKey`; the
message/session projection supplies the exact persisted Agent ID and goal
ownership. `beforeSnapshot` plus `changes[].file` is also the rewind input, so
the old `hash/files` pair is derived and deleted rather than kept as a second
source.

One assistant message owns one PatchPart. The first step-start snapshot is the
message baseline. Each later finish-step captures the newest tree, computes the
net `Snapshot.diffSummary(messageBase, latestTree)`, and updates that same part.
Repeated edits of one file therefore remain one row with the earliest before
tree and latest after tree; line statistics are not incorrectly summed over
intermediate edits. The processor's existing error/abort finalizer performs the
same last capture before the message becomes terminal.

Snapshot comparison remains the only diff producer. `Snapshot.diffSummary`
owns status/stat/text classification without loading file bodies;
`Snapshot.diffFile(beforeSnapshot, afterSnapshot, file)` lazily resolves one
expanded row from the same immutable trees. Binary rows are marked explicitly
with `isText: false` instead of being encoded as two empty strings. Paths are
worktree-relative and parsed from NUL-delimited Git output so tabs, newlines,
quoting, and Unicode cannot corrupt the contract.

Full before/after bodies must not be embedded in PatchPart. A session-scoped
read route under the existing Session route family receives the exact
`sessionID`, `messageID`, `partID`, and file path, verifies that the persisted
PatchPart owns that path, and returns `Snapshot.diffFile` from the part's two
snapshot refs. This is a read projection of the same evidence, not another diff
store. It also keeps database rows, protocol events, SSE, and conversation
hydration bounded when an Agent touches a large file.

## Runtime Data Flow

```text
Agent session/message starts
  -> Snapshot.track(message baseline)
  -> any in-session tool/process writes inside that session directory
  -> Snapshot.track(latest tree)
  -> Snapshot.diffSummary(baseline, latest tree)
  -> Session.updatePart(one PatchPart for the assistant message)
  -> existing message.part.updated protocol event
  -> existing SSE/replay/hydration path
  -> cardTreeStore CardNode.parts
  -> message-card AgentFileChanges projection
  -> on row expansion only: Snapshot.diffFile(snapshot pair, owned file)
```

`FileWatcher.Event.Updated` remains useful for File Explorer, language server,
and other workspace invalidation. It must not feed Agent attribution, create a
PatchPart, or choose a card.

Tool-result metadata may continue to explain an individual tool in its own
tool UI, but it must stop being an input to the Agent file-change component.
Otherwise Edit/Write metadata and Snapshot evidence remain competing sources.

## Concurrency And Ownership

Snapshot comparison proves what changed between two trees in one directory; it
cannot identify which of two concurrent writers sharing that directory caused
the bytes. Exact “modified by this Agent” semantics therefore require every
concurrently writable Agent session to own an isolated Git worktree or other
exclusive session directory.

OpenCorvus goal Build runs already use session-owned managed worktrees. The
implementation must preserve that topology and test it directly. A
`current_project` session can be described as Agent-owned only while it is the
single writer of that directory. If a product flow intentionally allows
multiple writers in the same directory, the truthful label is “observed during
this session,” not “modified by this Agent.” A watcher, timestamp window, active
Agent lookup, process ID guess, or tool-name allowlist cannot repair this causal
ambiguity and must not be introduced.

Writes that occur after a tool/process has returned are likewise outside the
owning message boundary. Background writer processes must remain owned until
settled by the existing process supervisor; late unowned changes are workspace
changes, not silently attributed Agent evidence.

## Message-Card Projection

The component is a projection, not a store:

- Read only PatchParts from the current card's own `parts`. Do not recursively
  collect `childIDs`; a parent Agent did not itself modify files written by a
  child Agent.
- Do not add `CardNode.fileChanges`, local storage, or a second Overlay signal.
  Solid derives rows from the canonical reactive `parts` array.
- Render one compact disclosure such as `Files 3  +42 -8` inside the Agent
  message card. Reuse the current Listbox, FileRow, disclosure, status, and
  DiffView primitives rather than authoring another interaction system.
- Extend the reusable file-list component with an explicit row resolver so a
  card row resolves lazily from its PatchPart snapshot pair, while task/goal
  Review rows continue resolving from their canonical acceptance scope.
- Live `message.part.updated` writes and full transcript hydration take the
  same tree-writer path, so refresh cannot produce a different list.
- A message with no PatchPart renders no file section. Failed tool input paths,
  watcher-only paths, and current workspace dirtiness never create rows.

Task/goal acceptance diffs remain a different semantic scope: they prove the
delivered aggregate, while PatchParts prove per-message Agent activity. The
Review panel may present both scopes with explicit labels, but must not merge
them into one unlabeled authority.

## Call-Site Disposition

| Current owner/call site                                                         | Decision                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `file/watcher.ts::FileWatcher.Event.Updated`                                    | Keep as project-instance invalidation only; never stamp an Agent or mutate message evidence.                                                                                   |
| `file/index.ts::File.Event.Edited` and Edit/Write/Apply Patch publications      | Keep for file/language-server consumers; remove them from any Agent-card attribution proposal.                                                                                 |
| `tool/edit.ts`, `tool/write.ts`, `tool/apply_patch.ts`, `tool/bash.ts` metadata | Keep tool-specific diagnostics/output. Do not use their heterogeneous metadata as the Agent file list.                                                                         |
| `session/processor.ts` start/finish/error paths                                 | Own the message baseline, latest tree capture, one PatchPart create/update, and terminal flush.                                                                                |
| `snapshot/types.ts` and `snapshot/index.ts`                                     | Replace the patch evidence schema, emit status/stat/body plus explicit text/binary identity, and parse machine output without path quoting ambiguity.                          |
| `session/message.ts::PatchPart`                                                 | Replace `hash/files` with `beforeSnapshot/afterSnapshot/changes`; no compatibility union.                                                                                      |
| `session/summary.ts`                                                            | Continue as a derived session aggregate for session APIs; derive from the same snapshot/part evidence and never become the card source.                                        |
| `session/message.ts` model replay and `session/compaction.ts`                   | Derive bounded patch filenames from `changes`; preserve bounded model evidence without retaining the old list.                                                                 |
| `protocol/session-mirror.ts`                                                    | Keep `message.part.updated` as the only live/replay path. Do not add `agent.files.changed`; retain `session.diff` only for its existing session-summary consumers.             |
| `server/routes/session.ts`                                                      | Keep transcript hydration as the durable list source; add one exact PatchPart file-body read projection backed only by its persisted snapshot refs.                            |
| Task/session conversation routes and `conversation/view.ts`                     | Do not add a parallel `fileChanges` hydration field or eagerly hydrate file bodies.                                                                                            |
| `tree-writer.ts` and `card-tree.ts`                                             | Keep PatchPart inside canonical `CardNode.parts`; no new card-level truth field.                                                                                               |
| `utils/file-change-summary.ts`                                                  | Extract a shared pure PatchPart reducer. Agent-card projection reads only the current node's parts; task Review aggregation keeps its explicitly scoped acceptance projection. |
| `FileChangesView`, `FileRow`, `DiffView`, disclosure primitives                 | Reuse through a compact message-card composition and explicit resolver; do not copy their keyboard, filtering, or diff behavior.                                               |
| `Card.tsx` and `ChatBubble.tsx`                                                 | Render one shared AgentFileChanges component for structured and bubble Agent cards.                                                                                            |

## Verification Plan

### Backend contract

1. Add/modify/delete and Unicode/special-character paths produce one PatchPart
   with exact session/message identity, status, statistics, text identity, and
   no eager file bodies.
2. Binary files produce `isText: false` and no fabricated empty-text diff.
3. Edit, Write, Apply Patch, Shell, and formatter writes all appear through the
   same Snapshot path; failed tools and read-only tools do not create rows.
4. Multiple steps editing the same file update one message-level net row rather
   than summing intermediate line counts.
5. Error, abort, and provider-stream failure paths flush the last owned tree.
6. Two concurrent Agent sessions in separate managed worktrees never see one
   another's paths.
7. Rewind derives its restore patch from `beforeSnapshot + changes[].file`.
8. Model replay and compaction keep bounded filename evidence after the old
   `hash/files` contract is removed.
9. The exact PatchPart file route returns before/after bodies only for a file
   owned by that part, handles added/deleted/empty files, and does not place
   bodies into protocol events or hydration.

### Protocol and hydration

1. The persisted part, protocol `message.part.updated`, live SSE payload, event
   replay, and conversation hydration carry the same PatchPart ID and content.
2. Reloading or paging an older session produces the same card rows as the live
   stream.
3. No new event type, table, hydration array, or watcher subscription exists.

### Overlay and visual acceptance

1. The component reads only its card's own PatchParts and never includes child
   Agent changes or current workspace dirtiness.
2. Repeated part updates replace rows without duplication; add/delete/modify
   status, statistics, keyboard disclosure, focus, lazy inline text loading,
   and binary states are covered.
3. Existing task Review file groups remain explicitly separate and unchanged.
4. Run the focused Overlay tests and typecheck, then a Node-launched real
   desktop Playwright fixture with concurrent parent/child cards, live updates,
   reload hydration, long paths, binary rows, and narrow-card stress.
5. Capture and inspect task-scoped screenshots at original resolution; correct
   density, clipping, focus, hierarchy, and diff readability before rerunning.
6. Run historical-document links, document health, diff hygiene, a second code
   review, commit with the required `dsw-33987` prefix, and push to `myhexin`.

## Codex Review Feedback

The first draft put complete `before` and `after` file bodies in every
PatchPart. Review rejected that shape because the same bodies would be copied
through the part table, protocol event, SSE stream, transcript hydration, and
card store even when the operator never opens a diff. The contract above is
revised to persist only immutable snapshot refs plus bounded file summaries and
to resolve one owned file body lazily from those refs. No second cache or
fallback body source is introduced.

## Delivery Boundary

This record designs the mechanism only. No production code or User Interface
(UI) has been changed in this round. Implementation is complete only after the
backend, protocol, hydration, Overlay, real-browser, screenshot, second-review,
commit, and git-cc checks above pass.
