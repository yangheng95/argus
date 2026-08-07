# Composer conversation context flags

## Recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User request               | After Code or Work is selected and a conversation exists or is in progress, replace the Code / Work buttons with a flag that shows the current mode; show the active Expert Squad beside that flag while the conversation is active. The supplied crop highlights the current segmented control and the adjacent destination for the context flag.                                                                                                                                                                             |
| Acceptance criteria        | Before a Task or Chat is selected, preserve the interactive Code / Work selector. Once a Task or Chat is selected, replace it with a compact non-interactive current-mode flag. If the strict scoped Expert Squad catalog has an active squad, render its display label immediately beside the mode flag. Returning to the launcher restores the selector.                                                                                                                                                                     |
| Hard constraints           | Desktop-only UI change; no UI automated test additions, edits, updates, or execution; validate through a real page, visible interaction, screenshots, and manual inspection; reuse mature UI primitives; do not add a second active-squad source, fallback identity, compatibility path, state machine, gate, temporary iframe, query override, or local-signal test seam; use Node for browser control; preserve unrelated dirty work; no new worktree; commit subjects start with `dsw-33987`; push to `legacy-remote`.            |
| Sources read               | `AGENTS.md`; `specs/current/architecture/07-panel.md`; `2026-07-29-code-work-composer-and-grouped-references.md`; `2026-07-29-composer-mode-selected-state-contrast.md`; `ChatComposer.tsx`; `main.tsx`; `store/board.ts`; `services/expert-squad-scope.ts`; `services/composer-expert-squad-catalog.ts`; `services/events.ts`; shared `Badge`, `SegmentedControl`, and `Icon` primitives; the user-supplied screenshot.                                                                                                       |
| Whole-repository grep      | `ChatComposer` has one production mount in `main.tsx`. `composer-mode-toggle` has one production render site and one scoped CSS block. `activeTaskID()` and `activeSessionID()` are the canonical selected Task / standalone Chat selectors. `composerExpertSquadCatalog()` is built once from the strict request-scoped snapshot and is already invalidated by the event service. `ExpertSquadOption` comes from the generated SDK catalog shape. No second Composer mount or alternate active Expert Squad UI source exists. |
| Independent agent feedback | None. The user did not request multiple agents or parallel audit, so this localized UI change remains with the primary agent.                                                                                                                                                                                                                                                                                                                                                                                                  |
| External review            | The required local Claude Code preflight completed, but its read-only review could not start because the installed CLI is not authenticated. No review claim is made from that unavailable tool.                                                                                                                                                                                                                                                                                                                               |

## Root cause

The Composer always renders the two-option segmented control even after a Task or Chat owns the conversation surface. That control communicates a pre-conversation choice, so keeping it interactive inside an established conversation obscures the immutable conversation experience and leaves no compact place to expose the active Expert Squad. The needed facts already exist, but they are not projected into the Composer:

- `boardStore.selectedSource`, exposed through `activeTaskID()` / `activeSessionID()`, is the single selected-conversation source.
- `composerMode()` is the existing current Code / Work experience source.
- `composerExpertSquadCatalog().activeID` and `.squads` are the strict, scope-correct Expert Squad selection and catalog.

The repair is therefore a presentation projection, not new state or routing.

## Call-site disposition

| Surface                                               | Decision                                                                                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx` `ChatComposer` mount                       | Pass `conversationActive` from the canonical selected Task / Chat selectors and pass `activeExpertSquadID` from the existing scoped catalog snapshot.                                                                      |
| `ChatComposer.tsx`                                    | Preserve the current segmented selector for launcher state. In conversation state, render shared `Badge` primitives for current mode and the catalog-resolved active Expert Squad. Do not infer a squad label from its ID. |
| `composer.css`                                        | Add only Composer-scoped flag layout, truncation, and compact badge geometry. Preserve the shared Badge and SegmentedControl contracts.                                                                                    |
| `board.ts`, expert-squad scope/catalog/event services | Preserve. These already own conversation selection, scope resolution, strict catalog identity, and invalidation.                                                                                                           |
| Other Badge / SegmentedControl consumers              | Preserve. The behavior is local to the Composer.                                                                                                                                                                           |

## Implementation and verification

1. Extend the single `ChatComposer` contract with conversation-active and active-squad identity inputs derived at its production mount.
2. Replace the segmented control with static mode and active-squad flags only while a selected Task or Chat exists.
3. Run formatting checks, Overlay typecheck/build, required documentation-health checks, and `git diff --check`; do not run UI tests.
4. Open the real desktop page, inspect launcher and active-conversation states, capture task-scoped screenshots, and manually review layout, hierarchy, truncation, and theme contrast.
5. Re-read the diff and visual evidence, then commit only task-owned changes and push the branch to `legacy-remote`.

## Progress

- [x] Recorded requirements, constraints, prior decisions, root cause, and exhaustive call sites.
- [x] Implemented the conversation context flags.
- [x] Passed typecheck, production build, formatting, diff, historical-link, and product-documentation checks.
- [x] Interacted with the real page and inspected launcher plus selected-Task screenshots; the selector is replaced by one compact Code flag without toolbar shift.
- [x] Confirmed the real project catalog returns active `general` with display label `Builtin/General`; the isolated selected-Task view did not hold its session scope long enough to capture the asynchronously loaded second flag, so no fake visual state was introduced.
- [x] Completed second review and task-owned commit.
- [x] Push and remote convergence check.

## Verification

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed after transforming 7,055 modules; only the existing large-chunk advisory was emitted.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 13 passed, 0 failed.
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`: 8 passed, 0 failed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 62 passed and 1 shared-worktree failure. The only failure lists monthly-index links whose record files are still untracked by concurrent tasks; it includes this new record until staging and is not a product-code failure.
- `bunx prettier --check ...` and `git diff --check`: passed.
- Real page at `http://127.0.0.1:5198/`, started with Node: `launcher.png` shows the unchanged interactive Code / Work selector; `active-chat-transient.png` and `active-chat-delayed.png` show a selected real conversation replacing it with the compact Code flag. The mode flag remained aligned with the attachment and model controls and did not create a second selected state.
- Read-only `GET /expert-squad/catalog` against the same real backend/project returned HTTP 200, `active.effective: "general"`, and `display_label: "Builtin/General"`, proving the component's strict ID-to-label lookup has real catalog data without inventing an alias.
- No UI automated test was added, modified, updated, or run.
