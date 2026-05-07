# Delivery Panel UI/UX Redesign — 2026-05-01

## Why we're rewriting it

The right-hand `#solidDeliveryMount` panel today is the bare minimum — a green-tinted card with one heading, an unsegmented Markdown blob, and a flat list of evidence rows where every entry just shows `name · status-string`. It hides the structure of the new delivery pipeline (deterministic gate + runtime flows + per-reviewer specialist reviews + agent verdict) and gives the operator no actionable signal: "Delivered" vs "Candidate" is the only header, the green container persists even when the verdict is rejected, and there is no way to tell which goal a failed check belongs to. The user explicitly said the current panel is "trash" and threatened to delete it — this doc fixes the UX so the panel earns its DOM space.

## What the panel must show (functional spec)

The panel has one job: at a glance, the operator must know **(a) is the latest delivery candidate accepted, rejected, in-flight, or empty; (b) which evidence categories failed; (c) which goal each failure attaches to; (d) the agent's one-paragraph verdict summary; (e) the changelog if there is one — and click-through to the diff**. Anything else is noise.

## Information architecture

Today the evidence is flattened from three categorically different sources (`checkResults` deterministic gates, `runtimeFlows` smoke / preview probes, `reviewEvidence` LLM specialist reviews) into one undifferentiated list. The redesign keeps three sections so the operator can read failure provenance:

```
DeliveryPanel
├── header          ── verdict pill + iteration · "i-th delivery"
│                       agent summary (collapsible if > N lines)
├── checks group    ── deterministic gate (build / test / lint / typecheck / api / docs)
├── runtime group   ── runtime flows (preview / SSE / golden-path)
├── reviews group   ── specialist reviews (one row per reviewer)
└── changelog       ── files changed count + click-through to ChangesPanel
```

Each group renders only when it has rows. Each row has `{ icon, name, goal-pill (when scoped), status-pill, evidence-excerpt-on-hover }`. Status drives both the icon and the row's left-edge accent — green check / red x / amber dash / muted dot.

## Status semantics (single source of truth)

The card's *outer* color must mirror the **agent verdict**, not the artifact-row lifecycle status — today the panel paints itself green on `status === "candidate"` and only changes when `row.status` flips to `delivered`, which never happens for rejected runs. New rule:

- `verdict === "accepted"` → green accent
- `verdict === "rejected"` → red accent
- `verdict === undefined` (in-flight) → blue accent
- no delivery at all → muted slate accent + "尚未交付" empty-state

`status === "publishing"` is a transient lifecycle state, not a verdict, and gets a thin pulsing border instead of changing the accent.

## Concrete changes

### 1. `components/Board.tsx · DeliveryPanel`

- Replace single `<div class="delivery-card">` with a structured tree:

  ```tsx
  <section class="delivery-panel" data-verdict={verdictTone}>
    <header class="delivery-panel-header">
      <span class="delivery-verdict-pill" data-verdict={verdictTone}>{verdictLabel}</span>
      <span class="delivery-iteration">{t("delivery.iteration", { n: iteration })}</span>
    </header>
    <Show when={summary}>
      <p class="delivery-summary md-content" innerHTML={renderMarkdown(summary)} />
    </Show>
    <DeliveryEvidenceGroup label={t("delivery.checks")} kind="check" rows={checkRows} />
    <DeliveryEvidenceGroup label={t("delivery.runtime")} kind="runtime" rows={runtimeRows} />
    <DeliveryEvidenceGroup label={t("delivery.reviews")} kind="review" rows={reviewRows} />
    <Show when={files > 0}>
      <button class="delivery-files-link" onClick={focusChangesPanel}>
        {tc("delivery.files_changed", files, { count: files })}
      </button>
    </Show>
  </section>
  ```

- Split `deliveryEvidenceRows` into three pure helpers (`checkRows`, `runtimeRows`, `reviewRows`) so each group stays single-source and the empty-list `<Show>` decides whether the group renders at all.

- Each row carries a `goalPill` when its source has `goalRunId` / `goalId` (specialist reviews + check results that name a goal); otherwise the row is task-level. The pill uses the same `goalRevisionLabel` helper as the FilesSection so V2/V3 attempts read consistently.

- `verdictTone` = `accepted | rejected | inflight | empty` derived once at the top of the component; this attribute drives all CSS variants. Drop the `deliveryStatusLabel` helper (which mixed lifecycle+verdict) and replace with a tiny `verdictLabel(verdictTone)` lookup.

- Click-through: the Files-changed footer button posts a custom `delivery:focus-changes` event the existing FilesSection / ChangesPanel listens for — no global-window touchpoints, no prop drilling.

### 2. `index.html`

- Move `#solidDeliveryMount` ABOVE `#solidFilesSectionMount`. Verdict + summary belongs on top of the right column; the changelog is a consequence of the verdict, not a sibling.

### 3. `styles.css` — `.delivery-panel` family (replace the `.delivery-card` family)

- `.delivery-panel`: `padding: 12px`, `border-radius: var(--radius)`, `background: var(--surface)`, `border-left: 4px solid var(--accent)`, `--accent` set via `[data-verdict="..."]` selectors so a single attribute drives the chrome. No more "always green dim".
- `.delivery-panel-header`: flex row, gap 8, baseline-aligned. The verdict-pill is a `<span>` with status icon + label, sized like the existing `.status-pill` variants in the workflow column for visual consistency.
- `.delivery-summary`: max-height-clamped at ~10 lines with a "show more" toggle (Solid `createSignal` inside the panel). Markdown blob no longer dominates the column on rejected verdicts.
- `.delivery-evidence-group`: `<details>` element so the group can collapse; default-open when the group has any failing row, default-closed when all green. Group header carries `n / total · failed: k` summary so collapsed state still informs.
- `.delivery-evidence-row`: 3-column grid `goal-pill | name | status-pill`, alignment matches the FilesSection rows so the eye stitches them together.
- `.delivery-evidence-status`: status-pill matching `.status-dot` family already used in the workflow steps; no more raw `failed` / `passed` text in mono — use a Lucide-shaped svg icon already in the project's icon registry.
- Drop the dark-mode override at line 9822/9854 — the new panel uses `--surface` / `--accent` tokens that already adapt; the explicit overrides cause flicker on theme switches.
- Drop the duplicate rule at 11890 / 12628 — they're old leftover stylings the user never deleted; keep one source.

### 4. New i18n keys (`en-US.json` + `zh-CN.json`)

- `delivery.verdict.accepted`, `delivery.verdict.rejected`, `delivery.verdict.inflight`, `delivery.verdict.empty`
- `delivery.iteration` (`"Delivery #{n}"` / `"第 {n} 次交付"`)
- `delivery.checks` / `delivery.runtime` / `delivery.reviews` (group labels)
- `delivery.show_more` / `delivery.show_less`
- `delivery.empty.title` / `delivery.empty.hint` (replaces today's `empty.delivery`)

### 5. Hygiene tests

Update / extend `test/delivery-panel-mount.test.ts`:

- The existing 3 mount-asserts stay.
- Add: index.html declares `#solidDeliveryMount` *before* `#solidFilesSectionMount` in document order (regex on the markup).
- Add: `Board.tsx` exports both `DeliveryPanel` AND `DeliveryEvidenceGroup` (the new helper component).
- Add: `Board.tsx` references `data-verdict={` (the attribute that drives the new theming) — guards against a future refactor reverting to the always-green container.
- Drop / rewrite: `delivery.status.delivered/publishing/failed/candidate` references in source — searching for them must return zero in `Board.tsx` after the rewrite (they were the buggy lifecycle-as-verdict mapping).

## Out of scope (won't touch in this pass)

- The bus-event path (codex's `DeliveryEvidenceUpdated` → board hydration) already works once the panel mounts; the fan-out reset + multi-source artifact issue tracked separately.
- The sub-rows' click-through to the ChangesPanel goes through a single CustomEvent — the underlying ChangesPanel route stays unchanged.

## Acceptance for this redesign

1. With a rejected delivery on screen, the panel's left edge is red, the verdict pill says "已拒绝", the summary is the agent's reject text (clamped at 10 lines), and three collapsible groups list the failing checks / runtime flows / specialist reviews with goal pills where applicable. Files-changed footer works as a click-through.
2. With an accepted delivery, the panel's left edge is green, the pill says "已交付", and all three groups default-collapse showing `n / n · all passed`.
3. With no delivery, the panel renders the new empty state (title + hint), not just `t("empty.delivery")`.
4. Bench `_session-r22-*` shows every emitted `delivery.evidence.updated` produces a panel re-render the operator can verify in the puppeteer screenshot.
5. `bun test test/delivery-panel-mount.test.ts` stays green and adds the four new asserts.

## Open questions for codex review

- Should the goal-pill in evidence rows click-through to the goal's worktree (anchor to FilesSection's existing per-goal group) or to the ChangesPanel's goal tab? Today's panel can't disambiguate.
- Should the agent summary collapse default-open on `rejected` and default-closed on `accepted`? Default-open everywhere bloats the column when accepted runs land.
- Is there a single shared `.status-pill` token I should reuse instead of inventing `.delivery-verdict-pill`? If yes the file `styles/card.css` already declares it — point me at the exact selector and I will dedupe.
