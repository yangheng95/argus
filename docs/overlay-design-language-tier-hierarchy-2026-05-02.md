# Overlay Design-Language Tier Hierarchy

Status: implemented across iter4–iter12 of the 2026-05-02 overlay
UI/UX sweep. This doc is the falling-back source-of-truth so the
three-tier rule survives commit-message archeology.

## Why

Before iter4, the overlay rendered three competing typographic
voices in the same screen: section titles in Title Case ("Goals",
"Files"), small status pills in ALL CAPS ("EMPTY", "ACCEPTED"), and
a confusing middle layer of "field labels" / "section subtitles" /
"button labels" that adopted the all-caps + 0.05–0.08em pill
typography even though they had no pill chrome (no background, no
border-radius, no accent color). The result was the user-reported
"right-panel design language is completely inconsistent" — Title
Case "Goals" sitting next to UPPERCASE "OBJECTIVE / ACCEPTANCE
CRITERIA" in the same card surface, "Copy All" rendering as
"COPY ALL", "Server URL" rendering as "SERVER URL", etc.

This doc pins the contract so future contributors know which tier
a new label belongs in and don't reintroduce a tier-2 leak.

## The three tiers

### Tier 1 — Section title

What: the headline that introduces a card, panel, or column —
"Goals", "Files", "Workflow", "Conversation", workspace tabs.

Typography: Title Case, weight 650, `--ui-font-body`, no
`text-transform`, near-zero letter-spacing.

Implementation: `.section-title`, `.workspace-tab-label`,
`.agent-workflow-title`, `.chat-title`. The `.section-title`
primitive at styles.css:2333 is the canonical block.

### Tier 2 — Section subtitle, field label, group title

What: a small subhead that scopes content INSIDE a tier-1 surface
— form labels in settings ("Server URL", "API Key"), field labels
inside cards ("Objective", "Acceptance Criteria"), group titles
in pickers ("Theme", "Locale", "Custom Providers"), content
subtitles ("Stack", "Body", "Modes", "Agents").

Typography: Title Case, weight 600, `--ui-font-control` (or
`--ui-font-meta` for tighter contexts), no `text-transform`, no
wide letter-spacing. The i18n strings come through as written.

Implementation: `.field-label`, `.config-panel-group-title`,
`.about-section-title`, `.agent-model-tier-label`,
`.titlebar-menubar-group-title`, `.cmdk-item-group`,
`.provider-section-label`, `.gwg-objective-label`,
`.gwg-done-definition-label`, `.criteria-family-head`,
`.dialog-subtitle`, `.change-subline`, `.diff-preview-scope`,
`.msg-todo-card__label`, `.msg-read-reminder__label`,
`.log-detail-title`, `.board-intro__section-title`,
`.sidebar-list-heading`.

### Tier 3 — Status pill / status chip

What: a short single-word color-coded chip that conveys state —
"Empty", "Accepted", "Rejected", "Passed", "Failed", "Explicit",
"Inferred", "System", "Reasoning", "TypeScript" / language tags.

Typography: ALL CAPS via `text-transform: uppercase`, weight 700,
`--ui-font-tiny` or `--ui-font-small`, 0.04–0.1em letter-spacing.
MUST have pill chrome — at minimum either a background, a 999px
or radius border-radius, or an accent color. Without chrome the
uppercase reads as a screaming subtitle, not a status tag.

Implementation: `.verdict-pill`, `.req-type`, `.req-status`,
`.req-priority`, `.gwg-priority-badge`, `.gwg-step-status`,
`.gwg-verdict`, `.gwg-diff-files`, `.reasoning-label`,
`.criteria-result`, `.tool-status`, `.session-msg-role`,
`.eval-error-meta`, `.integrity__tag`, `.ndjson-badge`,
`.md-code-lang`, `.status-label`, `.brand-guide-kicker`.

## Rules of thumb

1. New label, no pill chrome → Tier 2 (Title Case, no
   `text-transform`).
2. New label, has pill chrome and short single-word content →
   Tier 3 (UPPERCASE, weight 700).
3. Section title above a card surface → Tier 1.
4. Don't paint Tier 3 typography onto a Tier 2 element. The
   "(rule 8) — single source" comment from the chat-empty
   collapse + the regression tests under
   `packages/overlay/test/*-typography.test.ts` exist precisely
   to catch this drift.

## Regression tests

Each tier-2 sweep landed with a regression test that asserts
the targeted selectors do NOT carry `text-transform: uppercase`
AND that a sample of legitimate tier-3 pills DO. The negative
control prevents a future "remove all uppercase" sweep from
quietly stripping the legitimate pill styling.

- test/right-panel-tier2-labels.test.ts            (iter2)
- test/panel-empty-states-share-primitive.test.ts  (iter3)
- test/btn-typography.test.ts                      (iter4)
- test/chat-empty-single-source.test.ts            (iter5)
- test/titlebar-brand-strip.test.ts                (iter6)
- test/field-label-typography.test.ts              (iter7)
- test/sidebar-list-heading-single-source.test.ts  (iter8)
- test/settings-section-headers-typography.test.ts (iter9)
- test/content-tier2-typography.test.ts            (iter10)
- test/menu-group-typography.test.ts               (iter11)
- test/content-subtitles-typography.test.ts        (iter12)
- test/titlebar-single-source.test.ts              (iter14)
- test/sections-single-source.test.ts              (iter15)
- test/sidebar-chat-single-source.test.ts          (iter16)
- test/chat-input-flat.test.ts                     (iter17)
- test/right-panel-tabs-flat.test.ts               (iter18)
- test/dark-mode-primary-button.test.ts            (iter19)
- test/chat-textarea-single-source.test.ts         (iter20)

## Single-source folding checklist

The shell-container collapse iters (iter5 / iter8 / iter14 /
iter15 / iter16 / iter17 / iter20) hit the same rule-35
("穷举调用点") gap three times in a row. Each time the
post-commit CRON self-audit caught a leftover override that
the canonical-only grep had missed. The fixes added "iter X
follow-up" commits, but the lesson belongs at the planning
stage — before the canonical edit goes out.

When folding a CSS selector to a single-source flat
canonical, the all-of-the-following grep MUST run before the
edit, not after:

1. **Solo top-level rules** — `^\.foo\s*\{` / multi-line
   selector lists where `.foo` appears as ANY member, top-
   level only (no leading whitespace).

2. **Pseudo-class siblings** — `\.foo:hover`, `\.foo:focus`,
   `\.foo:focus-within`, `\.foo:active`, `\.foo:disabled`.
   Iter16 missed `.chat:hover` chrome that would have
   re-introduced gradient + shadow on hover the moment the
   !important resets were removed.

3. **Theme-scoped overrides** — `body\[data-theme=` chains
   that re-style `.foo` for light / dark / vscode-dark.
   Iter17 missed two theme overrides that quietly forced
   `border-radius: 18px` back onto the chat input even though
   the canonical declared 0. The rendered visual was the
   opposite of what the commit message claimed.

4. **Multi-selector partners** — when collapsing
   `.foo-wrap, .foo { … }` to `.foo { … }`, the cleanup
   MUST also confirm `.foo-wrap` either inherits the same
   value from its own canonical or has a matching update.
   Iter20 missed that the wrap kept declaring 72px while the
   textarea collapsed to 62px — the wrap rendered ~10px
   taller than its own child.

5. **`@media` nested rules** — narrow-width / print /
   prefers-reduced-motion overrides that re-set the same
   property at a different breakpoint. Iter14 caught and
   merged three `@media (max-width: 760px) .titlebar { … }`
   blocks scattered across styles.css; the canonical alone
   would have lied about the narrow-width visual.

If any of the five comes up empty, write the grep command
into the commit message. Future contributors and the CRON
self-audit can verify the gap was checked, not just
overlooked.

## Empty-state primitive (iter3 companion)

Empty states ("no data here yet") used to be styled by five
per-panel classes (`.arch-empty`, `.req-empty`,
`.agent-workflow-empty`, `.delivery-empty-hint`,
`.integrity__empty`). All converged on the shared
`.empty-hint` primitive plus a new `.empty-hint--card` modifier
that opts panels INTO the bordered-card chrome without nesting
inside `.section-body` / `.sidebar-list-cluster`. Single source.
Regression: test/panel-empty-states-share-primitive.test.ts.

## What this is NOT

- A token system or a refactor of `--ui-font-*` variables. The
  font-size / weight / color tokens stay where they are; this
  doc just classifies which selectors are which tier.
- A button system. The button family unification (chat-send /
  chat-interrupt / sidebar-tool / titlebar-menubar-trigger) is a
  separate problem and intentionally out of scope here.
- A border-radius / spacing token cleanup. Also out of scope.
