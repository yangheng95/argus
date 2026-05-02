# Overlay Architecture Refactor — 3-Layer Primitives + Surface Modularization

Status: proposal awaiting user direction selection.

Trigger: user feedback (2026-05-03):

> 现在的 css 和面板源码太臃肿了，形成了 god module，极其难以维护，
> 也造成设计语言的统一和覆盖难题。我需要重新抽象 UI/UX，打散
> CSS 和面板组件。你觉得最大的问题在哪儿，应该如何设计方案？

This doc captures the proposed architecture so the user can
review the full plan before iter56+ starts moving code.

## Quantified current state

| Dimension | Value |
| --- | --- |
| `packages/overlay/src/styles.css` | **15,212 lines / 2,070 top-level rules / 490 nested rules** |
| `packages/overlay/src/styles/card.css` | 2,022 lines / 336 top-level rules |
| Total `!important` in stylesheets | **380** (331 in styles + 49 in card) |
| `body[data-theme="…"]` theme overrides | **262** |
| `packages/overlay/src/main.tsx` | **1,621 lines + 18 independent Solid mount points** |
| Largest 5 components | TaskList 696 / LogViewer 579 / CardHeader 544 / MemoryPanel 444 / GoalWorkflowGroup 206 |
| Total `.tsx` LOC across overlay | 28,700 |

53 single-source iters (iter5 / iter8 / iter14 / iter15 /
iter16 / iter17 / iter20 / iter22 / iter23 / iter25 / iter26 /
iter27 / iter28 / iter29 / iter30 / iter33 / iter36 / iter37 /
iter40 / iter47 / iter52 / iter53 / iter54) retired roughly
**~30 of the 380 `!important`** — 8% in 53 iters. The current
slope means clearing the `!important` debt at the per-selector
pace would take ~600 more iters.

## Top problems (severity order)

### 1. `styles.css` is a god file stacked by add-order

The same selector's canonical / `:hover` / `body[data-theme]` /
`@media` / `!important` reset are scattered thousands of lines
apart. iter21's 5-prefix grep checklist exists precisely
because the file structure offers no co-location guarantee.
Per rule 8 ("禁止双源设计"), the file structurally invites
every new selector to violate the rule.

### 2. `!important` debt is masking specificity collapse

380 `!important` declarations means the selector hierarchy has
broken down — devs reach for `!important` because cascade
ordering doesn't communicate intent. Each `!important` then
forces the next override to also use `!important`, compounding
debt. iter53 caught a `border: 1px !important` shorthand
silently overwriting a `border-left: 4px` accent rail — the
shorthand wiped a semantic visual signal.

### 3. Themes overstep — change chrome shape, not just palette

262 `body[data-theme]` overrides include padding / radius /
border / shadow declarations. iter17's CRON audit found theme
overrides re-introducing `border-radius: 18px` after the
canonical declared `0` — the user's "remove rounded corners"
request was nominally fixed but the rendered visual stayed
rounded. Themes should swap palette tokens only.

### 4. Tokens and component-private values share `:root`

`--card-stage-*`, `--gwg-*`, `--section-*`, `--ui-titlebar-*`
all live in the global token pool. Surface-private values leak
to every consumer; renaming any of them risks breaking
unrelated surfaces.

### 5. Zero shared primitives — every surface re-implements basics

Button has 8+ implementations (`.btn`, `.chat-send`,
`.titlebar-menubar-trigger`, `.executor-chip`, `.workspace-tab`,
`.right-panel-tab`, `.sidebar-tool`, `.titlebar-status-icon`).
Each declares its own hover / focus / active. iter4 (calm/flat
button uppercase removal) only touched `.btn`; the other 7
button-like surfaces went untouched.

### 6. main.tsx renders 18 separate Solid trees

`index.html` carries 18 `<div id="solid…">` mount points;
`main.tsx` runs 18 `render(() => <…/>, mountEl)` calls;
`dom.ts` exposes 18 accessors. Adding a component requires
editing all three. iter31 caught a real bug here:
`#deliverySection` id missing from the rendered DOM caused
`syncSectionPhases` to silently no-op and the operator never
saw the delivery phase highlight transition.

## Proposed architecture

```
packages/overlay/src/styles/
├── tokens/                  # PURE tokens. No selectors except :root.
│   ├── color.css
│   ├── typography.css
│   ├── spacing.css
│   └── motion.css
├── primitives/              # Reusable, surface-agnostic components.
│   ├── button.css           # .ui-btn[data-variant=primary|ghost|danger][data-size=sm|md]
│   ├── pill.css             # .ui-pill[data-tone=info|success|warn|danger]
│   ├── card.css             # .ui-card[data-elevation=flat|raised]
│   ├── tab.css              # .ui-tabs / .ui-tab[data-active]
│   ├── input.css            # .ui-input + textarea
│   ├── menu.css             # .ui-menu (listbox/dropdown)
│   └── empty.css            # .ui-empty-hint
├── surfaces/                # Layout-only. Each surface = 1 file.
│   ├── titlebar.css
│   ├── sidebar.css
│   ├── conversation.css
│   ├── inspector.css        # right panel
│   ├── composer.css
│   └── settings.css
└── themes/                  # PALETTE ONLY — :root selector only.
    ├── light.css
    ├── dark.css
    └── vscode-dark.css

packages/overlay/src/components/
├── ui/                      # Primitive Solid wrappers.
│   ├── Button.tsx
│   ├── Pill.tsx
│   ├── Card.tsx
│   ├── Tabs.tsx
│   ├── Menu.tsx
│   └── EmptyHint.tsx
├── surfaces/
│   ├── Titlebar/
│   ├── Sidebar/             (split TaskList 696 → list + row + sectioning)
│   ├── Conversation/        (split CardHeader 544 + Card.tsx)
│   ├── Inspector/           (board → workflow / inspector / preview)
│   └── Composer/
└── App.tsx                  # ONE Solid root replacing main.tsx's 18 mounts.
```

## Hard rules enforced by tests + lint

| Rule | Enforcement |
| --- | --- |
| Surface CSS files declare NO raw `px` / `#hex` / `rgba()` values — only `var(--token)` | Regex test walks `styles/surfaces/*.css`, fails on raw values |
| Theme CSS files contain ONLY `:root` selector — no other selector allowed | Regex test walks `styles/themes/*.css` |
| Repo-wide `!important` count is monotonically non-increasing | Pre-push hook: `grep -c '!important' styles/**/*.css` ≤ `HEAD~1`'s count |
| Component files > 300 lines must split into a subdirectory | `wc -l` lint walking `components/**/*.tsx` |
| Primitive selectors use `data-*` attributes for variants, NOT `!important` | Regex test on `styles/primitives/*.css` |

## Migration phases

| Phase | Scope | Estimated iters |
| --- | --- | --- |
| **1** | Land empty directory tree, the 5 lint rules, and an empty `App.tsx` shell. Existing code untouched. | 1 iter |
| **2** | Button primitive ships first. Migrate 8+ existing button-like impls one at a time, each its own commit. | 8–12 |
| **3** | Pill / Tab / Card / Menu / Input / EmptyHint primitives ship. Existing surfaces consume them progressively. | 30+ |
| **4** | Surface migration — Titlebar → Sidebar → Conversation → Inspector → Composer → Settings, each surface one PR. | 50+ |
| **5** | Delete legacy `styles.css` residue. Collapse `main.tsx` 18 mounts into single `App.tsx`. Remove `index.html` placeholder divs. | 5–10 |

Total: **100–120 iters** within the 1000-iter target.

## Compatibility strategy

Phases 2–4 keep the legacy `styles.css` rules alongside the new
primitives. Per CLAUDE.md rule 8 (禁止双源), this is a
temporary violation. To bound it:

- Each new primitive ships with a regression test that asserts
  the matching legacy rules in `styles.css` no longer have any
  callers (consumed by zero JSX classes).
- Phase 5 deletes the legacy rules in one commit per surface,
  driven by the regression assertions.
- Pre-push hook tracks "lines of legacy `styles.css` not yet
  migrated" — must decrease iter-over-iter.

## What this is NOT

- **Not** a full UI redesign. The visual contract is the
  iter15-54 calm/flat trajectory the user has signed off on
  via screenshots. This refactor preserves the rendered
  visual; only the code structure changes.
- **Not** a runtime behavior change. Same DOM contract for
  external integrations (`dom.ts` accessors stay live during
  Phase 1–4; deleted in Phase 5 per the migration map).
- **Not** a switch to React / Vue / etc. Solid stays the
  framework. Only file layout + primitive abstraction.

## Risks + mitigations

| Risk | Mitigation |
| --- | --- |
| 17K line CSS rewrite blast radius | Per-selector / per-primitive iters; never bulk rewrite |
| Visual regression during phase migration | Each iter runs `agent-models-panel` puppeteer e2e + adds visual snapshot tests for the touched surface |
| Temporary rule-8 violation (legacy + new co-existing) | Bounded by Phase 5 deletion + per-iter regression tests asserting legacy callers reach zero |
| `index.html` 18-mount → single `App.tsx` breaking `dom.ts` consumers | Phase 5 only; `dom.ts` accessors stay live through Phase 4 |
| 100+ iters of refactor competing with user feature requests | User feature feedback preempts refactor iter; refactor runs as background autonomous-loop work |

## Recommendation

Approve this spec → iter56 starts Phase 1 (land the directory
tree + lint rules + empty App.tsx). Phase 1 alone is 1 iter
with zero runtime impact — pure scaffolding.

If a different shape is preferred (Tailwind atomic, css-in-js
with vanilla-extract, or stay-with-current-structure but break
`styles.css` into per-selector files), say which direction.

## Reference iters this builds on

- iter3 — `.empty-hint--card` shared primitive
- iter4 — `.btn` typography unification
- iter13 — `docs/overlay-design-language-tier-hierarchy-2026-
  05-02.md` (typography hierarchy spec)
- iter21 — 5-prefix grep checklist (folding discipline)
- iter32 — `docs/overlay-message-card-redesign-2026-05-03.md`
  (card visual spec)
- iter28-54 — 9-iter shell `!important` reset chain teardown
  (proves per-selector progress is exhausting)
