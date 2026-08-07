# Environment Menu, Subagents, And Radius Refinement

Date: 2026-07-26
Status: Implemented and visually accepted
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.
- VCS: Version Control System, the canonical repository status source.
- DOM: Document Object Model, the rendered browser element tree.

## Recall

### User requirements

- Restyle the message-panel floating Environment surface after the supplied
  compact desktop reference.
- Separate menu regions with restrained one-pixel dividers.
- Raise the shared rounded-corner primitives slightly across the Overlay.
- Follow-up: include Subagents in the same floating surface.

### Acceptance criteria

- The existing chat-header Environment Popover remains the only floating
  surface and retains its canonical Kobalte Portal, placement, viewport fit,
  open state, VCS actions, Worktree actions, task information, Right Dock
  launchers, and Sources.
- Environment facts, Subagents, task/workspace/tool resources, and Sources read
  as distinct low-noise menu regions separated by one shared thin-line recipe.
- The Subagents region appears only when the selected canonical conversation
  contains real child-session records. It reports truthful active and terminal
  counts, and its single action opens one exact real session in the existing
  aggregate `Squad agents` Right Dock.
- Subagent identity and status come only from
  `conversationAgentRecordsForSource(boardStore.selectedSource)` and the
  existing child-session predicate. No second session list, transcript store,
  title inference, or fake progress is introduced.
- The global soft and large radius tokens increase modestly from 4/8 pixels to
  6/10 pixels at scale one. Primitive and browser contracts that intentionally
  measure those tokens are updated together.
- Focused source tests, Overlay typecheck/build, localization validation, a
  Node-launched real Vite browser fixture, geometry assertions, task-scoped
  screenshot review, documentation health, and a second diff review pass.

### Hard constraints

- Preserve all unrelated staged, unstaged, and untracked work in the shared
  main worktree. Do not reset, restore, stash, create a worktree, or broadly
  stage files.
- Do not restart, close, refresh, or otherwise interfere with the operator's
  running OpenCorvus or Overlay process. Browser verification uses an isolated
  Vite fixture launched by Node.
- Keep every existing Environment capability. The reference controls visual
  hierarchy and region rhythm; it does not authorize deleting Task, Workspace,
  Tool, Goal, Worktree, or Source behavior.
- Reuse the existing Popover, Button, Section, Icon, Right Dock, conversation
  Agent projection, and radius-token system. Do not add a second popover,
  session store, route, iframe, local signal copy, fallback, compatibility
  branch, gate, or state machine.
- Desktop is the only visual acceptance target.
- Commit subjects use `dsw-33987`; delivery goes to the `legacy-remote` remote.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control skill.
- Supplied reference screenshot
  `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-d720ccf6-5c8e-44e3-a165-dc5eaabe7b06.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/12-overlay-card-system.md`.
- `specs/records/2026-07/2026-07-25-environment-popover-floating-message-overlay.md`.
- `specs/records/2026-07/2026-07-25-environment-information-text-axis-alignment.md`.
- `specs/records/2026-07/2026-07-25-subagent-progress-grid-and-conversation-dock.md`.
- `specs/records/2026-07/2026-07-17-overlay-primitive-system-convergence.md`.
- `packages/overlay/src/components/TaskDirBar.tsx`.
- `packages/overlay/src/components/App.tsx`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/components/SubagentConversationPanel.tsx`.
- `packages/overlay/src/store/conversation-agents.ts`.
- `packages/overlay/src/utils/subagent-presentation.ts`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/src/styles/primitives/popover.css`.
- `packages/overlay/src/styles/primitives/dropdown-menu.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- Focused source and browser tests for Environment, Subagents, Buttons, and
  interaction dialogs.

### Whole-repository search evidence

Searches covered:

- `ProjectRuntimeStatusPanel`, `ProjectRuntimeToolbarActions`,
  `project-runtime-status-panel`, all Environment category/source selectors,
  `onOpenRightDockPanel`, and `onOpenRightDockAddMenu`.
- `conversationAgentRecordsForSource`, `isSubagentActivityRecord`,
  `openSubagentConversation`, `SubagentConversationPanel`, the programmatic
  `subagent` Right Dock identity, and every existing exact child-session route
  consumer.
- Every `--oc-radius-soft` and `--oc-radius-large` definition, primitive
  consumer, literal computed-radius assertion, token fallback, and relevant
  architecture/history reference.

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Owns the one floating Environment Popover and all visible regions. | Keep one Popover; flatten its expanded body into divider-separated menu regions and add the conditional Subagents summary. |
| `TaskDirBar` VCS, Worktree, Task, Tool, and Source memos/actions | Read canonical board/service data and launch existing actions. | Preserve behavior and ordering; do not delete data-bearing regions to mimic an incomplete reference. |
| `conversation-agents.ts` | Owns the selected conversation's canonical Agent records. | Read through `conversationAgentRecordsForSource(boardStore.selectedSource)` only. |
| `subagent-presentation.ts` | Owns the child-session predicate and progress identity helpers. | Reuse the predicate and add one shared terminal-status helper so the card and menu summary cannot drift. |
| `main.openSubagentConversation` | Selects an exact session and opens the aggregate Squad agents panel. | Thread the existing callback through `App` and `TaskDirBar`; do not generically open an unselected panel. |
| `SubagentConversationPanel` | Lists every canonical child session and loads the selected exact transcript. | Keep unchanged. |
| `conversation.css` | Owns Environment layout; Sources alone currently draw a top border. | Introduce one sibling-region divider recipe and remove the Source-only separator special case. |
| `design-language.css` | Defines the only five-token radius scale at 0/4/8/24/pill. | Change only soft and large values to 6/10; keep none, extra-large, and pill semantics unchanged. |
| Primitive CSS consumers | Read soft/large tokens rather than hard-coded values. | Inherit the global refinement without feature overrides. |
| `McpAppArtifact.tsx` | Provides an 8-pixel fallback for the soft radius token. | Synchronize the fallback to 6 pixels so missing-token rendering does not become a second radius source. |
| `design-density-tokens.test.ts` and real browser tests | Intentionally assert the current 8-pixel large token. | Update the token and computed-style expectations to 10 pixels. |
| Environment source/browser tests | Guard current hierarchy, behavior, and screenshots. | Add Subagent source/count/navigation and menu-divider contracts while retaining existing capability checks. |

No backend route, API contract, database model, Agent lifecycle source, Right
Dock catalog identity, worktree service, attachment projection, or Popover
visibility behavior changes.

### Independent agent feedback

None. The user did not request delegation, and the active collaboration
boundary forbids unrequested Subagents.

## Root cause

The Environment surface already floats correctly, but its visual grouping
predates the supplied menu reference. Environment facts and peer
classifications flow together without a common inter-region separator; only
Sources has a local top border. That makes the card read as one long
configuration sheet instead of a compact grouped menu.

The child-session facts already exist in `conversationAgentStore` and already
drive the main progress grid, Agent Rail, and Squad agents Dock. The Environment
surface simply never projects a compact summary of them. A generic call to
`onOpenRightDockPanel("subagent")` would be incomplete because that panel
requires an exact selected session. The correct route is the existing
`openSubagentConversation(sessionID)` callback.

The rounded-corner system is already centralized, so raising individual
popover/card radii would create feature exceptions. Updating the soft and large
tokens, their one fallback, and exact computed-style tests preserves a single
global primitive source.

## Implementation plan

1. Add shared child-session terminal-status semantics and thread the existing
   exact-session open callback from `main` through `App` to `TaskDirBar`.
2. Project a conditional Subagents menu region with active/terminal counts and
   exact-session navigation.
3. Restructure the expanded Environment body into sibling menu regions and
   apply one thin divider recipe while keeping every existing action and data
   source.
4. Raise the global soft/large radius tokens to 6/10 pixels, synchronize the
   embedded-app fallback, and update exact radius contracts.
5. Update current architecture, localization, focused source/browser tests, and
   the spec indexes.
6. Run focused tests, Overlay typecheck/build/localization checks, document
   health, and the Node-launched Vite fixture. Inspect the generated screenshot
   at original resolution and correct any remaining visual defect.
7. Perform a second source/diff/screenshot review, commit only task-owned
   changes with the required prefix, reconcile remote changes, and push the
   delivery branch to `legacy-remote`.

## Status

- [x] Baseline diagnosis, architecture review, and whole-repository call-point search.
- [x] Architecture, component, CSS, localization, and regression implementation.
- [x] Vite geometry and screenshot review.
- [x] Validation and second review.
- [x] Commit and push.

## Verification evidence

- Focused source suite:
  `bun test packages/overlay/test/agent-activity-status.test.ts
  packages/overlay/test/task-cwd-row-layout.test.ts
  packages/overlay/test/design-density-tokens.test.ts
  packages/overlay/test/message-interactive-artifact.test.ts` — 24 passed,
  zero failed.
- Overlay TypeScript:
  `bun run --cwd packages/overlay typecheck` — passed.
- Overlay localization:
  `bun run --cwd packages/overlay check:i18n` — passed.
- Isolated real browser:
  `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test
  --test-name-pattern='chat header environment panel matches the compact
  Codex information layout' test/browser/task-dirbar-keyboard.test.ts` —
  passed under Node against the built Vite page.
- The browser contract verified a 10-pixel Popover radius, one-pixel borders
  on every adjacent menu region, one active and three terminal child sessions,
  exact selection of `ses_runtime_visual_review`, and the existing Subagent
  conversation Dock.
- Original-resolution screenshot review:
  `.scratch/task-dirbar-environment-compact-menu.png` — visually accepted for
  compact density, shared left axis, restrained separators, rounded primitive
  hierarchy, and clear Subagent working/done balance.
- Documentation validation:
  `historical-docs-links.test.ts` passed. `document-health.test.ts` passed all
  task-content checks; before commit its tracked-link audit also reported this
  new record and an unrelated concurrent record as untracked, which resolves
  when their owning commits add those files.
- `git diff --check` — passed.
