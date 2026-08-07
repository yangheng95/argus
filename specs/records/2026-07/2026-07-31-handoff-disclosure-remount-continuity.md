# Handoff Disclosure Remount Continuity Repair

Date: 2026-07-31

## Recall

### User request and visible evidence

- Clicking `Handoff context` appears to do nothing and the conversation surface
  visibly flickers.
- The supplied native macOS screenshot shows the affected disclosure inside a
  child-Agent progress card; the same shared disclosure is also used by
  delegated-context message runs.
- The user requires the repair to preserve the conversation-switch correctness
  established by the recent refactor and to avoid efficiency or performance
  regression.

### Acceptance criteria

- A Handoff disclosure opens and closes on the first click in complete-message
  and child-Agent progress-card call sites.
- The operator's open/closed choice survives a same-conversation full card-tree
  replacement, including hydrate, recovery, and tail replacement.
- Switching to another Task, Mission, Chat, or Work conversation still replaces
  the Virtua subtree and cannot retain stale message rows.
- Child-Agent card activation remains independent from its nested Handoff
  disclosure.
- No additional observer, timer, transcript copy, renderer, route call, or
  persisted message field is introduced.
- The packaged native application is exercised directly and screenshots are
  inspected manually; no User Interface (UI) automated test is added,
  modified, or run.

### Hard constraints

- Preserve all unrelated shared-worktree modifications and deleted artifacts.
- Keep `cardTreeStore.treeEpoch` as the single complete-projection replacement
  identity; do not revert the conversation-switch repair.
- Reuse the existing task-scoped `conversationUiStore.expandedDisclosures`
  owner rather than adding a second state source or browser-storage format.
- Do not add a fallback renderer, state machine, gate, debounce, or delayed
  click workaround.
- Delete touched legacy UI source/fixture tests without running them.
- New commits use the `dsw-33987` prefix and push through normal hooks to
  `legacy-remote`.

### Sources read

- `AGENTS.md`.
- `specs/current/architecture/07-panel-reactivity.md`.
- `specs/records/2026-07/2026-07-30-conversation-virtualizer-source-switch-lifecycle.md`.
- `packages/overlay/src/components/{Conversation,CardParts,DelegatedContextDisclosure,SubagentProgressGrid}.tsx`.
- `packages/overlay/src/store/{card-tree,conversation-ui}.ts`.
- `packages/overlay/src/services/{conversation,tree-writer}.ts`.
- `packages/overlay/src/utils/{card-message-run,dom-utils}.ts`.
- The current packaged application's accessibility tree, screenshots, and
  read-only sidecar request log.

### Whole-repository search evidence

| Owner / call site | Evidence | Decision |
| --- | --- | --- |
| `DelegatedContextDisclosure` | Owns an anonymous component-local `useDisclosure(false)` signal. | Replace local ownership with a required stable disclosure ID projected through the existing conversation UI store. |
| `CardParts` / `DelegatedContextParts` | Creates one disclosure for each delegated persisted message run; `run.messageID` is the canonical stable message identity. | Pass a namespaced message disclosure ID. |
| `SubagentProgressGrid` / `SubagentProgressCard` | Creates the same disclosure for the child Session input preview; `sessionID` is the canonical stable Agent-conversation identity. | Pass a namespaced Session disclosure ID. |
| `conversationUiStore.expandedDisclosures` | Already owns task-scoped operator disclosure state specifically so card-tree replacement cannot rewrite page arrangement. | Reuse unchanged; do not add persistence or another store. |
| `loadConversationUiStateForTask` / `clearConversationUiState` | Clears disclosure state at real selection boundaries while same-Task hydrate/recovery leaves it intact. | Preserve. |
| `Conversation.visibleTreeGenerations` | Recreates the Virtua subtree for every complete `treeEpoch` replacement. | Preserve because it prevents stale rows across Session switching and New Chat. |
| `tree-writer.resetWriter` / tail hydrate | Advances `treeEpoch` for complete projection replacement. | Preserve. |
| `setupAutoScroll` / conversation `ResizeObserver` | Re-measures content and follows the tail only under its existing tracking contract. | Preserve; no new scroll owner. |
| `delegated-context-disclosure-alignment.test.ts` | Reads TSX, CSS, and locale source strings to assert UI presentation. | Delete without running. |
| `subagent-progress-input-markdown.test.ts` | Reads TSX and CSS source strings to assert UI composition and layout. | Delete without running. |
| `subagent-conversation-header-browser.test.ts` / `subagent-card-wave-browser.test.ts` | Drive a browser fixture and assert child-Agent UI header and animation presentation. | Delete without running. |
| `test/browser/fixtures/subagent-progress-dock/**` | Exists only for the touched child-Agent UI browser tests. | Delete the test-only fixture. |

### Independent agent feedback

- No new sub-Agent was started for this narrow follow-up. The prior
  data-flow, Solid reactivity, and WebKit/Virtua audits recorded in the
  2026-07-30 source-switch repair established that `treeEpoch` must own full
  Virtua replacement while `visibleVersion` owns ordinary publication.
- The current defect is downstream of that boundary: the shared Handoff
  primitive kept operator choice in component-local state even though the
  virtual subtree is intentionally replaceable.

## Causal chain

The click handler runs and `aria-expanded` changes to `true` →
the disclosure body is inserted →
a complete conversation hydrate, recovery, or tail replacement advances
`cardTreeStore.treeEpoch` →
`VirtualizedConversationCards` intentionally recreates the Virtua subtree to
prevent stale rows after source replacement →
`DelegatedContextDisclosure` is recreated with `useDisclosure(false)` →
the body disappears and the virtual surface remeasures, producing a visible
flash that looks like an ignored click.

The defect is not a missing click listener and not failed Handoff data loading.
The renderer replacement lifecycle is correct; the operator-owned disclosure
choice is stored at the wrong lifetime.

## Implementation plan

1. Make the shared Handoff disclosure require a stable, namespaced identity and
   read/write the existing task-scoped disclosure store.
2. Project persisted message ID and child Session ID from the two production
   call sites.
3. Delete the touched UI source tests and obsolete dedicated browser fixture
   without running them.
4. Run focused non-UI state contracts, Overlay typecheck/build, documentation
   health, and a second diff review.
5. Rebuild the packaged GUI, launch it, exercise message and child-Agent
   Handoff disclosures across repeated full conversation replacement, and
   inspect native screenshots.

## Performance boundary

- Each disclosure render and click performs one existing reactive record lookup
  or keyed write.
- The change adds no Store, Map, list scan, network request, event listener,
  observer, timer, animation, or card-tree publication.
- Virtua remounts only at the same complete `treeEpoch` boundaries as before;
  streaming publication and ordinary message updates retain their current
  incremental path.

## Result

- `DelegatedContextDisclosure` now reads and writes the existing
  `expandedDisclosures` projection through a required stable identity instead
  of recreating anonymous local state.
- Delegated message runs use their canonical persisted `messageID`; child-Agent
  progress cards use their canonical child `sessionID`.
- The intentional `treeEpoch`-keyed Virtua replacement remains unchanged, so
  Session switches and New Chat still discard stale virtual rows.
- The touched source-string UI tests, browser UI tests, and their dedicated
  fixture were deleted without being run.

## Verification

- Positive non-UI disclosure lifecycle contract:
  `bun test packages/overlay/test/card-fold-store.test.ts` — 11 passed.
- Overlay typecheck:
  `bun run --cwd packages/overlay typecheck` — passed.
- Overlay production build:
  `bun run --cwd packages/overlay build` — passed.
- Documentation health:
  historical links, document health, and product documentation single-source
  suites — 72 passed.
- macOS GUI installer matrix built and validated the native Apple Silicon
  executable, `.app`, `.dmg`, and `.app.tar.gz` with the embedded backend.
- The rebuilt packaged application launched as GUI process `39127` with
  managed backend process `39261`.
- In the rebuilt native Task, the message-level Handoff changed from collapsed
  to expanded on the first click, remained expanded after 5 seconds and again
  after 20 seconds of active Task updates, and displayed the complete original
  request without layout corruption.
- In the exact reported `system-integrity-reviewer` progress card, the nested
  Handoff changed from collapsed to expanded on the first click, remained
  expanded after 5 seconds, rendered the real Integrity Review input, and did
  not activate the parent child-conversation action or open the Right Dock.
- Native Task → Prism Mission switching replaced the title and complete
  conversation projection; the previous Phase title and
  `system-integrity-reviewer` card were absent, confirming no source-switch
  regression.
