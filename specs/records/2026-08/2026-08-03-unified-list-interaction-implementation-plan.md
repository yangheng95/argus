# Unified List Interaction Implementation Plan

> **For agentic workers:** Execute inline, task by task. UI changes must not create, modify, or run UI automated tests.

**Goal:** Give all interactive Overlay lists immediate, consistent hover, focus, selection, and disabled feedback in light, dark, and VS Code Dark themes.

**Architecture:** One body-scoped list-state token family derives all palette values from the active theme. Shared Kobalte primitives consume that family with explicit selected-hover precedence, while surface CSS only retains semantic variants and component geometry.

**Tech Stack:** SolidJS, Kobalte primitives, CSS custom properties, Bun typecheck/build, manual packaged-desktop visual review.

## Global Constraints

- Desktop-only; preserve Solid and Kobalte ownership.
- Do not add fallback paths, state-machine code, duplicate state-token owners, or UI automated tests.
- Hover transitions may change only `background-color`, `color`, and `opacity`; use `--ui-duration-base` and `--ui-timing-standard`.
- Light, dark, and VS Code Dark must derive from the active theme palette rather than literal color copies.
- The design source is `specs/records/2026-08/2026-08-03-unified-list-interaction-design.md`.

---

### Task 1: Establish the common list-state token contract

**Files:**
- Modify: `packages/overlay/src/styles/tokens/design-language.css`
- Modify: `packages/overlay/src/styles/primitives/navigation-row.css`

**Interfaces:**
- Produces: `--ui-list-hover-bg`, `--ui-list-selected-bg`, `--ui-list-selected-hover-bg`, and `--ui-list-danger-hover-bg` at `body` scope.
- Consumes: existing theme palette tokens `--text-strong`, `--accent`, and `--bad`.

- [ ] Add the four semantic token declarations at `body` scope using `color-mix()` with transparent, with light/dark-specific strength supplied by the existing theme selectors or a theme-safe derived definition.

```css
.oc-navigation-row:is(:hover, :focus-within):not([data-active="true"]) {
  background: var(--ui-list-hover-bg);
}

.oc-navigation-row[data-active="true"]:is(:hover, :focus-within) {
  background: var(--ui-list-selected-hover-bg);
}
```

- [ ] Remove list consumers of `--hover-wash` and `--selected-wash`; retain these legacy tokens only if non-list chrome still has verified callers.
- [ ] Ensure the navigation row transitions only `background-color` and `color`; do not alter compact-row geometry.
- [ ] Run `git diff --check` and `bun run --cwd packages/overlay typecheck`.
- [ ] Commit this isolated token/primitive change with `dsw-33987` prefix.

### Task 2: Normalize generic list, select, menu, and tab primitives

**Files:**
- Modify: `packages/overlay/src/styles/primitives/listbox.css`
- Modify: `packages/overlay/src/styles/primitives/select-control.css`
- Modify: `packages/overlay/src/styles/primitives/dropdown-menu.css`
- Modify: `packages/overlay/src/styles/primitives/tabs.css`

**Interfaces:**
- Consumes: Task 1 token family.
- Produces: matching state precedence for Kobalte item, select option, menu item, and tab components.

- [ ] Add the shared color/opacity transition declaration to each row primitive and ensure disabled selectors do not match hover rules.
- [ ] Make the state precedence exact: base → hover/highlight/focus → selected/checked/pressed → selected-hover.

```css
.oc-select-option[data-selected] { background: var(--ui-list-selected-bg); }
.oc-select-option[data-selected]:is(:hover, [data-highlighted], :focus-visible) {
  background: var(--ui-list-selected-hover-bg);
}
.oc-select-option:not([data-selected]):is(:hover, [data-highlighted], :focus-visible) {
  background: var(--ui-list-hover-bg);
}
```

- [ ] Route checked menu items through the selected token and destructive item hover through `--ui-list-danger-hover-bg`.
- [ ] Keep focus outlines visible; do not replace them with a background-only state.
- [ ] Run `git diff --check` and `bun run --cwd packages/overlay typecheck`.
- [ ] Commit this isolated primitive change with `dsw-33987` prefix.

### Task 3: Converge primary application list surfaces

**Files:**
- Modify: `packages/overlay/src/styles/surfaces/sidebar.css`
- Modify: `packages/overlay/src/styles/surfaces/work-ledger.css`
- Modify: `packages/overlay/src/styles/surfaces/settings.css`
- Modify: `packages/overlay/src/styles/surfaces/automations.css`
- Modify: `packages/overlay/src/styles/surfaces/composer.css`
- Modify: `packages/overlay/src/styles/surfaces/conversation.css`

**Interfaces:**
- Consumes: Tasks 1–2 list-state tokens and primitive precedence.
- Produces: app-specific rows that retain their data/status semantics without painting a second hover layer or changing list geometry.

- [ ] Replace local normal-state washes for project/task rows, settings navigation, Mission automation rows, Composer suggestions, and model/reference trigger options with common tokens.
- [ ] Preserve task statuses, unread cues, selected markers, tooltips, and user actions. Reserve action tracks so hover changes only opacity and pointer eligibility, never grid columns, height, padding, or margins.

```css
.project-group-actions {
  opacity: var(--ui-opacity-hidden);
  pointer-events: none;
  transition: opacity var(--ui-duration-base) var(--ui-timing-standard);
}
.project-group:is(:hover, :focus-within) .project-group-actions {
  opacity: var(--ui-opacity-full);
  pointer-events: auto;
}
```

- [ ] Remove the Composer wrapper hover paint when its nested interactive primitive remains the trigger owner.
- [ ] Run `git diff --check` and `bun run --cwd packages/overlay typecheck`.
- [ ] Commit this primary-surface change with `dsw-33987` prefix.

### Task 4: Converge secondary list surfaces and conduct visual acceptance

**Files:**
- Modify: `packages/overlay/src/styles/surfaces/inspector.css`
- Modify: `packages/overlay/src/styles/surfaces/workspace.css`
- Modify: `packages/overlay/src/styles/surfaces/mailbox.css`
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**
- Consumes: Tasks 1–3 common list contract.
- Produces: file tree, right dock, and mailbox rows with the same interaction language plus recorded evidence.

- [ ] Route file-explorer rows, right-dock tabs/menu items, and mailbox rows through the shared states; retain file/agent/activity semantics and all existing focus affordances.
- [ ] Launch the real desktop client and manually inspect in light, dark, and VS Code Dark: sidebar project/task list; settings navigation; Mission automation list; Composer recommendations/model/reference choices; a dropdown/select; file tree; right dock; mailbox.
- [ ] Capture and personally review one screenshot per light and dark theme that shows representative hover and selected states. Do not create screenshot baselines or test files.
- [ ] Run `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay build`, `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`, and `git diff --check`.
- [ ] Update the record/index with the verified light/dark evidence, commit all remaining work with a `dsw-33987` subject, and push the current delivery branch to `legacy-remote` through hooks.

## Plan Self-Review

Coverage: the design token family, all named primitive owners, all primary and secondary surfaces, all three theme modes, and real-client visual acceptance map to Tasks 1–4. UI automated testing is explicitly excluded. No placeholders or undefined interfaces remain.
