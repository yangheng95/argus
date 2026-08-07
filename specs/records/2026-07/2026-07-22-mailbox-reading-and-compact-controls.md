# Mailbox Reading And Compact Controls

## Recall

### User requirement

1. Replace the visually unrelated Mailbox launcher glyph and make the
   mark-all-read and refresh glyphs the same size.
2. Explain the yellow leading highlight and remove it only if it has no real
   meaning.
3. Hide row-selection controls at rest and reveal them through an intentional
   selection interaction.
4. Move Open Task into the hover action rail and remove the per-message archive
   action.
5. Make opening a message clear its unread dot, refine project/message
   typography, and distinguish read from unread subjects by color.
6. Replace the wide Inbox / Archived / Search controls with a right-aligned
   icon toolbar; Search expands into a complete input only after activation.

### Acceptance criteria

- The contextbar launcher and mark-all-read action use the installed Lucide
  mail family, and mark-all-read/refresh render at one canonical icon tier.
- Active and archived views remain reachable through the canonical Kobalte
  toggle group, with icon-only visible labels and accessible names/counts.
- Search is absent at rest, opens and receives focus from its icon button, and
  closes without leaving a hidden filter.
- An unread row becomes read after its Accordion disclosure is opened; Open
  Task and mark-all-read preserve the same durable backend acknowledgement.
- Row checkboxes are hidden and pointer-inert at rest, appear on row hover or
  keyboard focus, and all remain visible while a selection exists.
- Open Task and Delete are the only hover actions. The active/archived
  projection remains available, but no row archive/restore affordance remains.
- The yellow leading highlight remains only for canonical `attention: true`
  rows; it is not reused as unread decoration.
- Project headings are stronger/larger than message subjects; unread subjects
  use strong text while read subjects use muted text.
- Focused tests, Overlay typecheck/build, Node-launched Playwright interaction,
  and inspected task-scoped screenshots pass without touching the user's live
  OpenCorvus process.

### Hard constraints

- Keep `/mailbox` plus append-only acknowledgement events as the only source of
  read and archived state. Do not add frontend shadow state for either fact.
- Reuse Kobalte Accordion/ToggleGroup through existing primitives and the
  canonical Button, Checkbox, SearchField, and Icon components.
- Keep the archived view because the user explicitly requested its compact
  icon control; remove only the per-row archive/restore action.
- Desktop-only scope. Do not add responsive/mobile variants, compatibility
  paths, fallback logic, gates, or a second Mailbox renderer.
- Preserve unrelated dirty work, use the current worktree, use the
  `dsw-33987` commit prefix, and push the finished commit to `legacy-remote`.

### Sources read before implementation

- `AGENTS.md`
- Browser control skill
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-07/2026-07-18-mailbox-inline-expansion.md`
- `specs/records/2026-07/2026-07-21-mailbox-global-project-grouping-and-action-geometry.md`
- `specs/records/2026-07/2026-07-21-tool-message-mailbox-dialog-refinement.md`
- Mailbox production component, service, icon registry, primitives, styles,
  translations, focused tests, and headed browser fixture.
- Installed `lucide-solid` mail glyph exports and the official Lucide design
  system overview.

### Whole-repository search evidence

Commands:

- `rg -n "mailbox|Mailbox" packages/overlay packages/opencorvus specs/current`
- `rg -n "acknowledgeMailboxItem|markAllMailboxItemsRead|MailboxView|MailboxAction" packages/overlay packages/opencorvus`
- `rg -n "mailbox-panel__|mailbox-item__|mailbox-toggle|name=\"mailbox\"|name=\"inbox\"" packages/overlay`
- `rg -n "archive|restore|read-all|/mailbox" packages/overlay packages/opencorvus`

Call-site disposition:

| Owner / call site | Existing responsibility | Decision |
| --- | --- | --- |
| `App.tsx` and `Icon.lucide.ts` | Sole left-sidebar Mailbox launcher and semantic glyph registry. | Preserve the launcher contract; map its semantic icon to Lucide Mails and add Lucide MailCheck for mark-all-read. |
| `MailboxPanel.tsx` | Sole list renderer and owner of view/search/selection/expanded presentation state. | Add compact icon controls, disclosure-owned read acknowledgement, intentional selection visibility, and hover Open Task; delete the row archive/restore affordance. |
| `mailbox.css` | Sole Mailbox geometry, typography, hover rail, attention border, unread dot, and scrollbar owner. | Keep the meaningful attention border; refine control expansion, selection visibility, hierarchy, density, and read/unread color. |
| `services/mailbox.ts` | Typed `/mailbox` transport for list, read/archive/restore, delete, read-all, and events. | Preserve unchanged: archived history and durable read acknowledgements remain backend-owned. |
| `engine/mailbox.ts` and Mailbox routes | Fold append-only read/archive/restore/delete acknowledgements and expose active/archived pages. | Preserve unchanged; this is a presentation and read-trigger repair, not a protocol rewrite. |
| `mailbox-panel.test.ts` and `mailbox-contextbar-launcher.test.ts` | Focused structural, request-ownership, primitive, and semantic icon checks. | Replace retired archive/old-icon assertions and cover compact controls, read trigger, selection mode, and typography. |
| `mailbox-left-sidebar-browser.test.ts` | Real built Overlay fixture, interaction assertions, and Mailbox screenshots. | Exercise search expansion/focus/filter/close, icon view switch, disclosure read, hover actions, checkbox reveal, batch selection, and visual geometry. |
| Other Mailbox browser fixtures | Consume the stable `/mailbox` response and mount contract. | Preserve; no route or response shape changes. |
| Current architecture and spec indexes | Define Mailbox source and durable interaction semantics. | Record disclosure-as-read, independent attention, compact controls, and retired row archive action. |

### Independent-agent feedback

- No independent agents were requested by the user, so none were started.

## Root-cause chain

Observable symptoms: the launcher looks unrelated to mark-all-read, the two
header action glyphs differ in size, the unread dot survives message expansion,
checkboxes consume every row at rest, and a large text/action layout obscures
the actual hierarchy.

Direct triggers: the launcher maps to Lucide Mailbox while mark-all-read maps to
Lucide Inbox; mark-all-read explicitly uses `compact` while refresh uses the
default tier; Accordion changes update only local expansion state; checkboxes
are always opaque; archive/delete own the hover rail while Open Task is rendered
as a large expanded button; read and unread subjects share the same color.

Deeper cause: the first compact Mailbox pass combined multiple independently
added interactions without one reading/selection/action hierarchy. Durable
backend state is correct, but the UI does not project it through conventional
mail interaction semantics.

Root repair: keep the backend projection as the single source, make disclosure
append the existing read acknowledgement, consolidate mail icons and density,
make selection/action affordances contextual, and encode attention, unread,
and selection as three visibly and semantically independent facts.

## Implementation plan

1. Refine the icon registry, Mailbox controls, disclosure read trigger, action
   rail, and selection-mode rendering.
2. Refine desktop Mailbox geometry and typography, including explicit
   read/unread color and retained attention treatment.
3. Update focused and headed browser regressions, translations only where a new
   accessible label is required, and current architecture wording.
4. Run tests, typecheck, build, docs health, real headed interaction, screenshot
   review, and a second diff review; iterate before commit and legacy remote push.

## Status

- [x] Recall, root-cause analysis, and whole-repository call-site audit recorded.
- [x] Production implementation complete.
- [x] Focused tests, Overlay typecheck, historical-doc links, and production
  build pass. The complete document-health run has 60 passes and one unrelated
  dirty-worktree failure: the shared July index currently links two concurrent,
  untracked records (`conversation-card-goal-identifier` and
  `bun-windows-opentest-package-tool-build`). This Mailbox record is staged and
  no longer appears in that failure.
- [x] Headed browser interaction and screenshot review pass.
- [x] Second review, commit, and `legacy-remote` push complete.

## Verification evidence

- `bun test packages/overlay/test/mailbox-panel.test.ts packages/overlay/test/mailbox-contextbar-launcher.test.ts packages/opencorvus/test/server/mailbox-routes.test.ts`: 20 passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/mailbox-left-sidebar-browser.test.ts`: passed in headed Node mode after building 2,649 modules.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: passed as part of the combined documentation run.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 60 passed; one unrelated concurrent untracked-record failure described above.
- `.scratch/left-sidebar-mailbox-focused-open.png`: compact right-aligned icon controls, hidden resting row checkboxes, larger project headings, and read/unread title contrast.
- `.scratch/left-sidebar-mailbox-search-expanded.png`: focused full SearchField expanded from the search icon.
- `.scratch/left-sidebar-mailbox-project-group-hover.png`: hover-only Checkbox plus Open Task/Delete action rail.
- `.scratch/left-sidebar-mailbox-focused-read-all.png`: unread dots and strong titles cleared while the independent attention edge remains.
- `.scratch/left-sidebar-mailbox-delete-confirmation.png`: active multi-selection with every Checkbox visible.

## Follow-up correction: compact row geometry and refresh stability

### Recall

- User requirements: (1) a hover-only row Checkbox must not reserve an empty
  column at rest; (2) remove the Mailbox list's right edge; (3) remove the
  button beside mark-all-read because it has no useful standalone value; (4)
  let the view icons and expanded SearchField fill their complete control row;
  and (5) opening an unread message must not flash the list while its durable
  read acknowledgement refreshes the canonical projection.
- Acceptance criteria: resting row content starts in the former avatar lane;
  hover/focus/selection replaces that identity lane with the Checkbox without
  moving the subject; the Mailbox activity owns no trailing border; Refresh is
  absent while live invalidation and canonical request ownership remain intact;
  expanded Search consumes all space after the view icons; and a delayed
  same-scope read refresh keeps the existing rows, disclosure, and scroll
  projection mounted until the replacement page commits.
- Hard constraints: retain `/mailbox` and `mailbox.acknowledged` as the only
  durable read source; retain the existing Checkbox, SegmentedControl,
  SearchField, Accordion, and request owner; do not add optimistic read shadow
  state, fallback data, responsive scope, a new renderer, or any process restart.
  Preserve unrelated dirty work and deliver from the current branch with the
  `dsw-33987` prefix to `legacy-remote`.
- Sources read: the original and follow-up screenshots; this record;
  `2026-07-21-mailbox-global-project-grouping-and-action-geometry.md`;
  `2026-07-20-desktop-left-rail-and-mailbox-refinement.md`;
  `2026-07-20-left-sidebar-mailbox-mark-all-read.md`; current panel and
  panel-reactivity architecture; `MailboxPanel.tsx`, `mailbox.css`, the Mailbox
  transport, activity/workspace/sidebar CSS, focused tests, and the headed
  Mailbox browser fixture.
- Whole-repository grep: `MailboxPanel` is still the sole row/control renderer;
  `mailbox.css` is the sole row grid/search/list geometry owner; `App.tsx` owns
  the sole `leftPanelMailbox` mount; `workspace.css` owns the adjacent pane
  resizer; `applyAction` is the sole per-message read call site and calls the
  same-scope `refresh`; the browser fixture is the only rendered Mailbox
  interaction suite. The backend service, routes, engine fold, notification
  projector, and other Mailbox fixtures retain their current contracts.
  The connection-lifecycle browser fixture was the sole second caller of the
  retired Refresh button; it now proves the reconnected event stream triggers
  the same canonical page refresh. The now-unused `mailbox.refresh` locale keys
  are removed with the control.
- Independent-agent feedback: none; the user did not request sub-agents.

### Root-cause chain

The blank row gutter is caused by a three-column grid that keeps the hidden
Checkbox column in layout; opacity hides paint, not geometry. The read flash is
caused later in the same action chain: `applyAction` correctly awaits the
backend acknowledgement and starts a same-scope refresh that preserves
`items`, but the body conditional requires `!loading()` and replaces those
preserved rows with the loading placeholder. Refresh therefore creates a
presentation teardown even though the canonical projection never disappeared.

The repair uses the identity lane as the contextual selection lane, removes
the unused manual Refresh control, makes the SearchField the flexible owner of
the remaining control-row width, keeps existing items rendered during
same-scope refresh, and shows the loading placeholder only when no projection
exists yet. No read fact is guessed locally.

### Follow-up implementation and verification plan

1. Update the Mailbox component/CSS and the current architecture description.
2. Add structural assertions for the two-column row, identity-lane replacement,
   borderless Mailbox activity, retired Refresh button, full-width search, and
   projection-preserving loading condition.
3. Delay the browser fixture's post-read `/mailbox` response and prove the
   existing row/disclosure remains mounted and visible throughout the request.
4. Run focused tests, Overlay typecheck/build, document health, headed Node
   browser interaction, screenshot inspection, and second diff review before
   commit and legacy remote push.

### Follow-up verification evidence

- Focused Mailbox tests and backend route tests: 20 passed.
- Overlay typecheck: passed.
- Production Vite build: passed with 2,649 modules transformed.
- Headed Node Mailbox browser fixture: passed. Its delayed post-read page
  proved `aria-busy=true` while all 10 rows, the expanded disclosure, and the
  existing list remained mounted with no loading placeholder.
- Connection lifecycle browser fixture: passed after replacing its retired
  manual Refresh click with a real `mailbox.changed` stream event.
- Original-resolution screenshots reviewed: resting rows have no Checkbox
  gutter, hover swaps Checkbox for avatar without shifting the heading, Search
  fills the remaining control row, the scrollbar track is transparent, and the
  deliberately delayed read refresh remains visually stable.
- The combined document-health run completed 74 passing checks and 8 failures:
  seven repository-wide scans exceeded their original five-second timeout in
  the concurrently busy worktree, and the remaining check identified two
  concurrent untracked July records already linked by the shared July index.
  Historical link resolution itself passed; these failures are unrelated to
  the Mailbox files and are retained as explicit shared-worktree evidence.
- Delivery commit `44a199dd6` passed the repository pre-push typecheck,
  route-inventory, generated API documentation, Overlay i18n, and secret-scan
  hooks, then pushed successfully to
  `legacy-remote/work-v0.0.15beta-yr-0722`.
