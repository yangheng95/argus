# Settings menu, Skill hub, and work-status semantics

## Recall

| Field | Evidence |
| --- | --- |
| User requirements | Fix the Settings page top menubar popup being covered; merge the Settings `Skill` and `Skill Market` entries into one menu; redesign and implement consistent Task / Mission / Chat status indicators between the Work Ledger and conversation title, while removing the duplicated dot semantics used for queued work and pending interactions. |
| Supplied visual evidence | `codex-clipboard-6d922801-1209-440d-9b3e-44a695add736.png` shows the Settings fullscreen surface painting over the opened top menubar content. `codex-clipboard-a9cced1f-9000-4e60-92ca-cf3c80a6bfe9.png` shows separate adjacent `Skill` and `Skill Market` sidebar entries. `codex-clipboard-3f9abdc6-2bfe-4d64-b8eb-7382cfb817f1.png` shows repeated trailing lifecycle dots in the Work Ledger. All three originals were inspected. |
| Acceptance criteria | An opened top menubar remains visibly and interactively above Settings. The Settings sidebar exposes one `Skill` entry and the Skill page exposes installed-management and marketplace views through the existing Tabs primitive. No `skill-market` Settings route or command remains. Work Ledger and conversation-header lifecycle state use the same status-icon mapping and semantic colors for Task, Mission, and Chat. Queued work uses the clock status glyph; pending interaction uses an explicit question/request glyph with its count; neither is represented as another ambiguous point. Focused unit/browser tests, Overlay typecheck/build, desktop screenshots, console review, document-health checks, second review, commit, and legacy remote push are required. |
| Hard constraints | Preserve unrelated dirty files and overlapping edits. Do not create a worktree, reset files, restart or refresh the user's running OpenCorvus/overlay, add compatibility routes, add fallback status sources, add a second Settings-section catalog, hand-write replacements for Kobalte/Solid primitives, or use Bun to launch Playwright. Desktop-only visual acceptance is in scope. |
| Existing architecture read | `specs/current/architecture/07-panel.md`; `2026-07-21-settings-extension-runtime-repairs.md`; `2026-07-21-chat-session-lifecycle-convergence.md`; `2026-07-22-left-rail-hover-and-action-column-convergence.md`; `2026-07-23-overlay-goal-status-settings-macos-keyboard-repair.md`; the current Overlay refinement and section-heading records; current Settings, Menubar, Work Ledger, conversation-header, status-mapping, icon, Tabs, and native-surface sources. |
| Whole-repository grep | Menubar content has one producer, `TitlebarMenubar.tsx`, and one surface owner, `titlebar.css`; Settings fullscreen layering is owned by `settings.css`. `CONFIG_SECTIONS` is the Settings route/label/order single source consumed by ConfigDialog, command palette, and menu entry points. The `skill-market` Settings route has production references in `store/dialog.ts`, `config-dialog-control.ts`, and `ConfigDialogHost.tsx`; `SkillMarketPanel.tsx` uses the same string only as an internal data mode. Expert Squad / Composer occurrences are icon identifiers, not Settings route calls, and remain unchanged. Work Ledger lifecycle and interaction marks have one production row producer in `WorkLedger.tsx`; title lifecycle has one producer in `TaskStatusHeader.tsx`; icon identity is owned by `status-mapping.ts` and the Lucide registry. Browser coverage is owned by `titlebar-menubar.test.ts`, `config-dialog-resizer.test.ts`, `skill-market-installed-action-browser.test.ts`, `hover-action-geometry.test.ts`, and `interaction-card-textarea-browser.test.ts`. |
| Independent-agent feedback | No subagent was launched because the user did not request delegation and the active repository instructions prohibit unsolicited multi-agent work. The main agent performs the required second review. |
| Repository state | The current branch is `work-v0.0.16beta-yr-0723`, one commit ahead of legacy remote at investigation time, with pre-existing unrelated and overlapping dirty changes. The required pre-change `git fetch` / push was attempted; legacy remote was unreachable on port 6443. No existing change was reset, overwritten, or staged. |

## Causal analysis

### Covered Settings menubar

Observed behavior: the trigger receives its open treatment but the menu body is not visible over Settings.

Direct trigger: `TitlebarMenubar` portals its `Menubar.Content` to `body`, where `.titlebar-menubar-panel` has no explicit layer. The Settings fullscreen dialog establishes `z-index: var(--ui-z-overlay)`.

Deep cause: the visible trigger lives inside `.titlebar` at the dialog layer, but the portalled content no longer inherits that stacking context. The trigger and popup therefore have different layer ownership. Raising the titlebar cannot raise the portalled popup.

Repair: assign the existing dialog layer to the portalled menubar panel itself and verify hit testing while Settings is open. No new layer token or iframe workaround is needed.

### Split Skill navigation

Observed behavior: `Skill` and `Skill Market` occupy two peer sidebar rows even though both are modes of `SkillMarketPanel.tsx` and share one Skill domain.

Direct trigger: `CONFIG_SECTIONS` declares both `skill` and `skill-market`, and `ConfigDialogHost` renders each as a peer route.

Deep cause: marketplace was modelled as application navigation instead of a view within Skill management. Because `CONFIG_SECTIONS` intentionally projects to every Settings entry point, the modelling choice propagates to the sidebar and command palette.

Repair: remove `skill-market` from the section identity union/catalog and make `SkillsPanel` the one page owner with `Installed` and `Marketplace` Tabs. The two existing data modes remain internal renderers and are active only while their tab is selected.

### Repeated work-state points

Observed behavior: Work Ledger lifecycle uses a trailing colored dot, the conversation header reduces its status icon to another dot, queued work shares that dot vocabulary, and pending interactions add another dot next to the title.

Direct trigger: `.work-row-status-mark::before`, `.chat-task-status .status-icon`, and `.work-row-attention-mark` independently paint circles. Queue, lifecycle failure/activity, and operator-required interaction are distinct semantics but look interchangeable.

Deep cause: icon identity already has one mature mapping (`statusIconName`), but the two high-frequency surfaces discard it in CSS and recreate local point renderers. Pending interaction then adds a third local point rather than using the existing interaction icon vocabulary.

Repair: render the mapped Lucide lifecycle icon in both Work Ledger and conversation title. Normalize Mission and Chat states into the same task lifecycle vocabulary before presentation. Keep the Work Ledger trailing alignment box and hover action behavior. Render pending interaction as a compact warning Badge containing the existing question icon and count beside the title. Queue becomes the existing clock glyph, so it no longer competes with interaction attention.

## Call-site disposition

| Surface | Current ownership | Disposition |
| --- | --- | --- |
| `TitlebarMenubar.tsx` / `titlebar.css` | Trigger and portalled popup | Keep structure and mature Menubar primitive; give the popup the dialog layer. |
| `settings.css` | Fullscreen Settings layer | Keep its current overlay layer and geometry. |
| `store/dialog.ts::CONFIG_SECTIONS` | Settings identities, labels, order | Delete `skill-market`; retain `skill` as the only Skill Settings identity. |
| `config-dialog-control.ts` | Valid-section and focused-element mapping | Delete the `skill-market` route target; `skill` remains the only valid Settings route for this domain. |
| `ConfigDialogHost.tsx` | Sidebar groups, active body, panel mount | Delete the peer market icon/route/switch arm and mount the unified Skill page once. |
| `SkillMarketPanel.tsx` | Tool, Skill, MCP, and market data/actions | Retain internal `skill` / `skill-market` modes; make exported `SkillsPanel` the tabbed page; remove the exported peer `SkillMarketPanel`. |
| Expert Squad / Composer `config-skill-market` occurrences | Icon identifiers, not Settings navigation calls | Keep the presentation asset references; they do not participate in Settings routing. |
| Command palette / Settings browser matrices | Catalog-derived Settings entries | Expect one Skill command/row and exercise the page's marketplace tab. |
| `WorkLedger.tsx` | Row lifecycle and interaction attention | Replace local point renderers with mapped lifecycle icon and explicit interaction Badge; retain row selection/actions and status facts. |
| `TaskStatusHeader.tsx` | Selected conversation title lifecycle | Generalize to Task, Mission, and Chat selected sources; render the mapped icon instead of hiding it behind a dot. |
| `status-mapping.ts` / status labels | Closed lifecycle icon and label vocabulary | Extend only the exact `terminal` normalization needed for Chat; do not add alternate mapping. |
| `sidebar.css` orphan `task-row-badge` rules | No production JSX call site | Remove during the requested status redesign and update architecture guards so the retired second status renderer cannot return. |

## Verification

1. Focused source/unit tests for Settings sections, config routing, status labels/mapping, Work Ledger runtime state, and architecture ownership.
2. Node-launched browser tests:
   - open Settings, click each top menubar trigger, assert popup stacking/hit testing, keyboard focus, and capture the supplied-failure region;
   - assert one Skill sidebar entry, switch Installed/Marketplace tabs, verify actions and capture the full Settings desktop surface;
   - render Task/Mission/Chat plus queued, failed, completed, idle, and pending-interaction rows; assert icon identity, tone, alignment, hover action replacement, explicit interaction count, and matching conversation-title icon.
3. Overlay typecheck and production build.
4. Inspect every current-goal screenshot at original resolution and correct any mismatch before rerunning.
5. Run historical-link and relevant document-health tests, `git diff --check`, and a second source/diff review.
6. Commit only attributable files with a `dsw-33987` subject and push the current delivery branch to `legacy-remote`; if legacy remote remains externally unreachable, report the exact unpushed commit instead of claiming delivery.

## Verification results

- `bun run typecheck` passed after the final source changes.
- `bun run build` passed; the Vite production bundle contains 2,645 transformed modules.
- Focused Bun suites passed:
  - 145 architecture, empty-state, and Work Ledger tests;
  - 73 status, Settings, menubar, motion, ownership, and row-geometry tests;
  - 17 task-runtime single-source and Work Ledger runtime tests;
  - 8 strict status-label / idle-Chat boundary tests.
- Node-launched real-browser suites passed:
  - titlebar menubar: 5/5;
  - unified Skill page: 1/1;
  - Work Ledger lifecycle/attention geometry: 1/1;
  - Task status header timing and lifecycle parity: 6/6;
  - conversation header and Right Dock toolbar: 2/2.
- Current desktop evidence was inspected at original resolution:
  - `packages/overlay/.scratch/settings-titlebar-menu-layer.png`;
  - `.scratch/settings-skills-unified-menu.png`;
  - `packages/overlay/.scratch/work-ledger-attention-lifecycle-separation.png`;
  - `packages/overlay/.scratch/task-status-header-ledger-consistency.png`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed 21/21.
- `git diff --check` passed before final review.

## Second review

The browser review exposed two issues that source assertions alone did not catch and both were corrected before acceptance:

1. The conversation empty state still painted a local point even after the header and Work Ledger reused the shared lifecycle SVG. It now renders the same `StatusIndicator`, so active state is visibly the same waveform across all three visible surfaces.
2. The first unified-status implementation incorrectly reused the Work Ledger row's optional `started` field for title timing and passed explicit Work Ledger `idle` through the strict task-lifecycle translator. Timing now has one source (`task.time`), lifecycle presentation has one source (Work Ledger), and the Work Ledger label layer explicitly maps its idle domain without weakening strict task statuses.
