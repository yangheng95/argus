# Projects toolbar organization and create menus

## Recall

| Field | Evidence |
| --- | --- |
| User request | Add the controls shown in the two supplied screenshots to the left Dock Projects tab: an ellipsis menu for organization/sorting and a plus menu for starting from scratch or using an existing folder. |
| Acceptance criteria | The Projects heading owns two always-visible icon controls in ellipsis-then-plus order; both use the canonical Kobalte dropdown primitive; menu labels and checked states match the references; organization and sort choices immediately change the Work Ledger projection and persist through the canonical Overlay settings source; Start from scratch enters the canonical global Chat launcher; Use an existing folder opens the canonical native directory picker; pointer and keyboard interaction work; a fresh desktop screenshot is visually reviewed. |
| Hard constraints | Desktop-only scope; preserve `WorkLedger` as the single Projects projection owner and existing project-row actions; reuse `DropdownMenu`, `Button`, `Icon`, `browseDirectory`, `openGlobalChatLauncher`, and `settings.save`; no duplicate launcher, hidden menu, fallback storage, host gate, temporary iframe, or interference with the running OpenCorvus process; browser fixtures must run through Node. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-76ab9b0e-cdfd-4c30-aa9d-61279d2002b3.png` and `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-76ff6212-103d-42ca-8fe6-32242dddfbe9.png`, both inspected in the request. They show a compact gray `Projects` title, an ellipsis action, a plus action, sectioned menu copy, and leading checkmarks/icons. |
| Sources read | `AGENTS.md`; Browser skill; `specs/current/architecture/05-config.md`; `specs/records/2026-07/2026-07-16-project-actions-secondary-menu.md`; `WorkLedger.tsx`; `ProjectLedgerGroup.tsx`; `WorkspaceSplitLauncher.tsx`; `CommandPalette.tsx`; `workspace.ts`; `settings.ts`; transport-protocol settings contract; Tauri `OverlaySettings`; Work Ledger and sidebar styles; focused source/browser tests. |
| Git baseline | `v0.0.11beta` at `c338e0d5f`, synchronized with `legacy-remote/v0.0.11beta`. The pre-change push and hook suite passed. The unrelated untracked `C:/` path remains outside this task. |
| Independent agent feedback | None. The user did not request delegation, and current collaboration policy forbids unrequested sub-agents. |

## Whole-repository search evidence

- `WorkLedger.tsx` is the only production owner of the Projects title, grouped projection, item comparator, project ordering, and calls to `ProjectLedgerGroup`.
- `ProjectLedgerGroup.tsx` owns only per-project disclosure/actions; it remains unchanged and continues to render the by-project mode.
- `openGlobalChatLauncher()` is the canonical start-from-scratch lifecycle and closes an active project before focusing the existing Chat composer.
- `browseDirectory()` is the canonical existing-folder lifecycle and owns native picking, directory application, error reporting, and persistence.
- `DropdownMenu.tsx` wraps Kobalte and is already used for Project row, Right Dock, Composer, Terminal, and split launcher menus.
- `OverlayPersistedSettings` in transport-protocol, `OverlaySettings` in the Solid store, and Tauri `OverlaySettings` are the three typed projections of one canonical persisted Overlay settings payload. All must change together; browser local storage is only a host adapter for the same payload.
- Work Ledger rows already project Task `priority`, timestamps, queue order, and backend order, so sorting requires no new backend route or duplicate data source.
- Focused browser coverage is in `command-palette.test.ts`, `project-directory-new-chat-browser.test.ts`, and `ledger-scrollbar-browser.test.ts`; settings contract coverage is in transport-protocol, Overlay settings persistence, and Tauri parser tests.

## Call-site disposition

| Owner / caller | Current behavior | Disposition |
| --- | --- | --- |
| `WorkLedger` Projects title | Plain section label | Replace with a compact toolbar containing the same title plus ellipsis and plus dropdown triggers. |
| `WorkLedger.groups` | Always groups by directory and sorts projects/items by last update | Project through persisted organization and sort preferences; keep by-project/last-updated as defaults. |
| `ProjectLedgerGroup` | Renders each directory header and its items | Preserve for by-project mode only. |
| Flat Work Ledger rows | No production projection | Reuse the existing `WorkLedgerRowView` directly in one-list mode; do not create a second row component. |
| Start from scratch | Existing global command and New Chat action | Call `openGlobalChatLauncher()` directly from the plus menu. |
| Use an existing folder | Existing command palette/titlebar action | Call `browseDirectory()` directly from the plus menu. |
| Overlay persisted settings | No Work Ledger presentation preferences | Add strict organization/sort enums to the existing single settings payload across protocol, browser/Tauri adapters, store, parser, and tests. |

## Implementation plan

1. Extend the canonical persisted Overlay settings contract with strict Work Ledger organization and sort enums, defaults, sanitization, Tauri serialization/validation, and positive/negative tests.
2. Add a compact Projects toolbar in `WorkLedger` using two Kobalte dropdowns and existing Button/Icon primitives; wire create actions to the canonical workspace service functions.
3. Project the existing Work Ledger rows through the selected grouping and ordering without duplicating row rendering or backend data. Priority uses Task priority, last updated uses canonical timestamps, and manual preserves backend/queue order while retaining the existing queued-Task reorder interaction.
4. Add localized labels, focused source/contract tests, and Node-launched browser interaction coverage for menu geometry, checked state, persistence, list-mode changes, keyboard use, and both create actions.
5. Run focused tests, Overlay/transport typecheck and build, documentation health, inspect fresh desktop screenshots at original resolution, correct visual issues, perform a second diff review, commit with `dsw-33987`, and push `legacy-remote/v0.0.11beta`.

## Verification plan

```text
bun test packages/transport-protocol/test/contract.test.ts packages/overlay/test/settings-persistence.test.ts packages/overlay/test/projects-toolbar.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_settings
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/command-palette.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Result

- The Projects heading now owns an always-visible ellipsis trigger followed by a plus trigger, using the canonical Button, Icon, and Kobalte DropdownMenu primitives.
- The organization menu exposes By project / In one list and Priority / Last updated / Manual order with leading checked-state glyphs. By-project retains the existing Project group owner; one-list reuses the same `WorkLedgerRowView` projection without Project headings.
- Organization and sort choices are strict required fields in the one Overlay settings payload across transport protocol, Solid store, browser host adapter, and Tauri JSONC parser. Invalid values are rejected; there is no fallback storage.
- Start from scratch calls the existing global Chat launcher, while Use an existing folder calls the existing native directory selection lifecycle.
- Focused unit/contract tests passed (51 tests), Overlay typecheck/build and six Tauri settings tests passed, and the Node-launched command-palette browser scenario passed after exercising checked states, one-list projection, priority sorting, keyboard focus return, both create-menu entries, and the existing-folder native picker command.
- `.scratch/overlay-projects-organize-menu.png` and `.scratch/overlay-projects-create-menu.png` were inspected at original 1902×1314 resolution. The title/actions share one compact row, the popups anchor below the triggers, reference order/copy/checkmarks are preserved, and no clipping or overlapping Project content remains.
- The browser scenario also exposed three stale pre-existing assertions. They were corrected to the current canonical 26px navigation-row token, the `min(84%, 900px)` empty-home width contract, and the existing mention-prefixed expert-squad placeholder; expected aborted `/work-ledger?limit=12` command-palette fetches are now explicitly classified as cancellation rather than browser errors.
