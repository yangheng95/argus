# Unified List Interaction Design

Date: 2026-08-03
Status: Approved design; awaiting implementation-plan review

## Recall

| Item | Evidence |
| --- | --- |
| User request | Scan all list-related regions, unify hover and selected styles, and support both light and dark themes. |
| Acceptance criteria | Every interactive list uses the same default, hover/focus, selected/active, selected-hover, disabled, and destructive-menu interaction semantics. Hover is immediate and does not cause layout movement. Light and dark themes have equivalent visual hierarchy. |
| Hard constraints | Desktop-only; preserve existing Solid and Kobalte component ownership; no fallback paths, duplicate style sources, state-machine code, or UI automated tests. UI acceptance is real-client manual interaction and screenshots. |
| Read records | `specs/records/2026-08/2026-08-03-hover-interaction-responsiveness.md`; `specs/README.md`; `specs/records/2026-08/README.md`; `specs/current/architecture/README.md`. |
| Whole-repository grep | Enumerated `.oc-navigation-row`, `.oc-listbox-item`, `.oc-menu-item`, `.oc-select-option`, `.oc-tab`, `.task-row-mini`, `.project-group`, Composer selector classes, and all hover / selected selectors under `packages/overlay/src/components` and `packages/overlay/src/styles`. Primary owners are `design-language.css`, primitive list/menu/select/tab/navigation styles, and surface overrides in sidebar, settings, composer, automations, inspector, workspace, mailbox, and work-ledger CSS. |
| Independent agent feedback | None; delegation was not requested. |

## Cause and Scope

List state is presently expressed by several independent token families and per-surface rules. `oc-navigation-row` uses the rail-aware `--hover-wash` and `--selected-wash`; settings adds a distinct `--settings-surface-hover`; select and listbox options use opaque `--surface-hover`; tabs use another active background; some sidebar rows also reveal controls or animate body content. The inconsistent sources produce unequal visual contrast, while geometry and multi-owner hover transitions make some rows feel delayed.

The work covers interactive navigation rows, project/task/session rows, settings rows and tabs, listboxes, selects/comboboxes, dropdown/context/menubar items, Composer recommendation/model/reference choices, file-tree rows, and workbench list controls. Informational cards, message bodies, and data tables keep their present information architecture; where they are interactive, they may consume the state tokens but are not redesigned as list rows.

## Design

### One semantic state-token family

`design-language.css` becomes the single owner of interaction-wash tokens at `body` scope so every active palette resolves per theme:

| State | Semantic token | Light palette effect | Dark palette effect |
| --- | --- | --- | --- |
| Hover / focus | `--ui-list-hover-bg` | `--text-strong` mixed into transparent at 7% | same derivation, therefore a light wash on dark surfaces |
| Selected / active | `--ui-list-selected-bg` | `--accent` mixed into transparent at 12% | same derivation at 20% |
| Selected + hover | `--ui-list-selected-hover-bg` | `--accent` mixed into transparent at 16% | same derivation at 26% |
| Destructive hover | `--ui-list-danger-hover-bg` | `--bad` mixed into transparent at 10% | same derivation at 16% |

The values derive from each theme's existing `--text-strong`, `--accent`, and `--bad` palette tokens. They therefore remain correct for light, dark, and VS Code Dark without copied palette literals. Existing `--hover-wash` and `--selected-wash` are replaced at their consumers, not retained as parallel list-state sources.

### Common interaction contract

Each primitive owns its own rendering but reads the common token family:

1. Default is transparent and preserves the surface background.
2. Hover, `data-highlighted`, and keyboard focus render the hover wash. `:focus-visible` also keeps the existing focus outline.
3. `data-selected`, `data-active="true"`, `data-checked`, and `data-pressed` render the selected wash. Selected hover gets the selected-hover wash and never falls back to plain hover.
4. Disabled controls render at the shared disabled opacity and do not take interactive washes.
5. Destructive menu items use only the danger-hover wash; their normal state stays neutral.

`background-color`, `color`, and `opacity` are the only hover-transitioned properties. They use the existing `--ui-duration-base` (120 ms) and `--ui-timing-standard`; state feedback is rendered by a single interactive owner for each row. Hover must not change geometry, margins, border widths, or conditional children. Row actions reserve their layout track and transition opacity/pointer availability rather than entering the flow.

### Adoption map

| Owner | Consumers | Change |
| --- | --- | --- |
| `primitives/navigation-row.css` | Project/task/session navigation rows | Use common state tokens; retain compact density and active marker. |
| `primitives/listbox.css`, `select-control.css`, `dropdown-menu.css`, `tabs.css` | All Kobalte choice, select, menu, and tab primitives | Normalize state precedence and transition properties. |
| `surfaces/sidebar.css`, `work-ledger.css` | Project groups and task rows | Remove conflicting local washes and layout-changing hover behavior; retain status and unread semantics. |
| `surfaces/settings.css`, `automations.css` | Settings navigation and interactive settings rows | Replace local hover family with common tokens while retaining the selected rail marker. |
| `surfaces/composer.css`, `conversation.css` | Composer recommendations, model/reference selectors, and option lists | Retain component structure but ensure a single hover paint owner. |
| `surfaces/inspector.css`, `workspace.css`, `mailbox.css` | File tree, right dock, and mailbox list controls | Route interactive list states through the shared token family. |

## Verification

1. Do not create, modify, or run UI automated tests.
2. Run targeted non-UI typecheck/build and `git diff --check` after implementation.
3. Launch the real desktop client in light and dark themes. Manually inspect and screenshot the sidebar project/task list, settings navigation, automated Mission list, Composer recommendations, model/reference selections, a dropdown menu, select/listbox options, and the file tree.
4. Confirm no pointer entry causes row movement, action-track reflow, double hover paint, or selected-state loss; confirm keyboard focus remains visible.
5. Run the required spec health test after this record/index update, then commit with the `dsw-33987` prefix and push main to `myhexin` through hooks.

## Spec Self-Review

No placeholders remain. The scope distinguishes shared interaction semantics from non-list content layout. Theme values have one derivation path at body scope, and selection does not compete with hover. The work is focused on one cross-surface design-system change.
