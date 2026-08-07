# Sub-agent Running Surface Wave and Selection Stability

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Replace the flashing-light effect on running cards with a wave effect, make the same change in the exact conversation surface, and stop this area from automatically jumping to the first card. |
| Supplied evidence | `codex-clipboard-d0976b58-51c8-4c33-843f-a67786bf9715.png` was inspected at the supplied desktop resolution. It shows the selected `MIRROR-PRD-AUTHOR` exact-session conversation card under the horizontal Squad-agent selector. |
| Acceptance criteria | A canonical `running` Sub-agent record drives one traveling, non-blinking surface wave on both its compact progress card and its exact-session conversation card. The animation does not change geometry or animate nested Tool rows, completed/error cards remain static, and reduced-motion rendering remains static. Opening/selecting an exact Session preserves that explicit Session through record-list churn; an empty or temporarily absent selection is not rewritten to the first record. The real desktop fixture verifies computed motion, selection stability, and task-scoped screenshots. |
| Hard constraints | Reuse canonical Agent status and the existing 2-second wave motion token; do not introduce a second status/selection source, fallback selection, timer, gate, temporary iframe, query override, mobile scope, or local interaction surrogate. Use Solid/Kobalte primitives already present. Run Playwright through Node and do not restart, refresh, terminate, or reuse the user's running OpenCorvus/Overlay process. Preserve all unrelated shared-worktree changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md` and `07-panel-reactivity.md`; `2026-07-24-agent-card-palette-and-running-tool-wave.md`; `2026-07-27-active-tool-wave-all-agent-surfaces.md`; `2026-07-27-subagent-card-pulse-and-tool-status-removal.md`; `2026-07-28-subagent-card-pulse-restraint.md`; current `SubagentProgressGrid.tsx`, `SubagentConversationPanel.tsx`, `subagent-conversation.ts`, `main.tsx`, `conversation.css`, `messages.css`, motion tokens, and focused source/browser tests. |
| Whole-repository grep | `SubagentProgressGrid.tsx` is the sole compact-card renderer and projects canonical `record().status` to its article. `SubagentConversationPanel.tsx` is the sole exact-session panel; `projectSubagentConversationCard()` projects the same status into its one `ConversationCard`. `conversation.css` owns the only whole-card running pulse. `messages.css` owns the existing `tool-active-wave` and deliberately excludes compact Tool rows. `SubagentConversationPanel.tsx` lines 108-116 were the only application path that wrote `candidates[0]`; a real browser regression then proved Kobalte Tabs also selects `collection.getFirstKey()` when its controlled value is temporarily absent. `main.tsx::openSubagentConversation()` and the Tab/Dropdown callbacks remain the explicit selection writers. `running-tool-wave.test.ts`, `subagent-card-wave-browser.test.ts`, and `subagent-progress-dock-browser.test.ts` own motion verification; `subagent-conversation-autoscroll.test.ts` and `right-dock-panel-ownership.test.ts` own exact-session selection contracts. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.23beta-yr-0728` and `legacy-remote/work-v0.0.23beta-yr-0728` both point to `b0754fdc0c`. A pre-change empty commit was intentionally not created because concurrently owned files were already staged; committing would have captured unrelated work. |
| Concurrent-worktree evidence | During read-only investigation, unrelated Mailbox, user-message, scrollbar, environment-clearance, and Projects changes appeared. `conversation.css` has an unrelated top-of-file `overflow-y` edit; the running-card block is untouched. All task patches and staging must remain line-scoped. |

## Causal chain

1. Observable symptom: the running compact card periodically brightens its
   background, border, inset edge, and halo, which reads as a flashing light.
2. Direct trigger: `subagent-progress-card-running-pulse` interpolates those
   whole-surface paint values at 0%, 50%, and 100%.
3. Deep cause: an earlier requirement deliberately replaced the compact Tool
   wave with an unmistakable whole-card pulse. The later amplitude reduction
   made it quieter but preserved the brightness-cycle motion model; tuning the
   pulse again cannot turn it into directional movement.
4. Exact-session mismatch: the projected conversation card receives canonical
   running status, but only its nested active Tool text consumes the traveling
   wave. The card surface itself therefore does not share the compact-card
   activity language requested now.
5. Observable selection symptom: the exact-session panel can jump to the first
   Agent while the user is reading a later one.
6. First direct trigger: a reactive effect called
   `onSessionSelect(candidates[0]?.sessionID ?? "")` whenever the current
   selection was empty or temporarily absent from the live record list.
7. Deeper trigger proven after deleting that effect: Kobalte Tabs treats an
   absent controlled value as invalid selection, obtains
   `collection.getFirstKey()`, and emits the first record through
   `onValueChange`. `activationMode="manual"` does not change that collection
   reconciliation behavior.
8. Deep cause: a mandatory-selection Tabs primitive was mounted while the
   domain legitimately had no matching record. That let presentation-level
   collection availability author the persistent explicit selection. The
   correction is to render the existing no-selection surface until the
   canonical selected record exists, and only then mount Tabs with a valid
   controlled value; no callback filter, shadow selection, or hidden Tab is
   introduced.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/styles/surfaces/conversation.css` | Replace the pulse keyframe with one directional overlay wave shared by running compact and exact-session cards. Keep static running border ownership and preserve nested content/geometry. |
| `packages/overlay/src/styles/surfaces/messages.css` | Preserve existing active Tool wave and terminal-state exclusions; it remains the Tool-row contract rather than a second card-surface implementation. |
| `packages/overlay/src/components/SubagentConversationPanel.tsx` | Delete the first-candidate selection effect. Mount Kobalte Tabs only while the canonical selected record exists, otherwise show the existing no-selection surface. Keep explicit Tab, menu, and compact-card selection callbacks plus the guarded request key. |
| `packages/overlay/src/main.tsx` | Preserve `openSubagentConversation(sessionID)` as the explicit selection source and task/session reset as the explicit clearing source. |
| `packages/overlay/test/running-tool-wave.test.ts` | Replace pulse-specific source assertions with directional surface-wave, shared-selector, terminal exclusion, nested Tool stability, and reduced-motion assertions. |
| `packages/overlay/test/subagent-conversation-autoscroll.test.ts` | Assert record-list projection never writes first-candidate selection while preserving exact-session Tab/menu ownership. |
| `packages/overlay/test/right-dock-panel-ownership.test.ts` | Replace the stale first-candidate requirement with the explicit-selection-only contract. |
| `packages/overlay/test/browser/subagent-card-wave-browser.test.ts` | Focused motion evidence samples directional wave movement and terminal/reduced-motion stability on compact and exact-session cards. |
| `packages/overlay/test/browser/subagent-progress-dock-browser.test.ts` | Extend the real combined fixture to prove compact and exact-session wave motion and selected-session stability across temporary record churn. |

## Implementation plan

1. Change the focused source and browser regressions to the new wave and
   explicit-selection contracts and observe the old implementation fail.
2. Delete automatic first-record selection and replace the pulse paint cycle
   with the shared directional surface wave.
3. Run focused source tests, the Node-launched real Sub-agent browser fixtures,
   Overlay typecheck/i18n checks, and documentation health checks.
4. Inspect compact-card and exact-session task-scoped screenshots at original
   resolution; correct motion, clipping, readability, and selection behavior.
5. Re-grep all owners, perform a second exact-diff review, update this record and
   the two Specs indexes without dropping concurrent entries, commit only
   task-owned hunks with the `dsw-33987` prefix, reconcile with legacy remote, and push.

## Progress

- [x] Recall, causal chain, prior decisions, and full call-site inventory recorded.
- [x] Failing regressions observed: the original first-record effect failed the
      source contract, and after its removal the Node/Chromium test exposed
      Kobalte's independent first-key reconciliation.
- [x] Implementation complete.
- [x] Real browser and screenshot acceptance complete.
- [x] Second review, commit, convergence, and legacy remote push complete.

## Verification

- `bun test packages/overlay/test/running-tool-wave.test.ts packages/overlay/test/subagent-conversation-autoscroll.test.ts packages/overlay/test/right-dock-panel-ownership.test.ts` — 10 passed.
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --experimental-strip-types --test test/browser/subagent-card-wave-browser.test.ts` from `packages/overlay` — 1 passed; samples both pseudo-element transforms over 700 milliseconds, proves static surface paint and terminal/reduced-motion exclusions, and preserves `session-temporarily-missing`.
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --experimental-strip-types --test test/browser/subagent-progress-dock-browser.test.ts` from `packages/overlay` — 1 passed.
- `bun run typecheck` and `bun run check:i18n` from `packages/overlay` — passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` — 22 passed.
- Original-resolution screenshots inspected:
  `.scratch/subagent-card-running-wave.png` and
  `.scratch/subagent-conversation-running-wave.png`. Both preserve readable
  content and geometry while the directional band crosses the surface.
- Commit `27c43d5358` passed the legacy remote pre-push SDK import, AI runtime,
  repository typecheck, API route, generated API documentation, Overlay
  localization, and tracked-source secret checks, then pushed to
  `legacy-remote/work-v0.0.23beta-yr-0728`.
