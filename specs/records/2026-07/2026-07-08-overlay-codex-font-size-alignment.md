# 2026-07-08 Overlay Codex Font Size Alignment

Date: 2026-07-08
Status: Complete
Owner: Codex

## Recall

| Item | Detail |
| --- | --- |
| User request | "把overlay的整体字号拉大，对标codex的app字体大小" |
| Acceptance criteria | Overlay user-facing typography is larger through the shared design-language font-size tokens; body, control, and meta text align to a 14px app baseline; the existing hierarchy remains ordered; no component-level scattered font-size overrides are added; focused tests and a real browser screenshot verify the rendered overlay. |
| Hard constraints | Follow `AGENTS.md`; no fallback or compatibility alias; no blind patch; no git reset; preserve unrelated dirty worktree changes; do not restart, reload, kill, or refresh any running OpenCorvus or overlay process; use Node, not Bun, for Playwright browser verification on Windows; code changes need matching tests; commit subject must start with `dsw-33987` if committing. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`; `specs/records/2026-07/2026-07-08-composer-file-loader-right-toolbar-hover.md`; `specs/current/architecture/07-panel.md`; `specs/current/architecture/07-panel-reactivity.md`; `packages/overlay/src/styles/tokens/design-language.css`; `packages/overlay/src/styles/cascade/base.css`; `packages/overlay/src/styles/cascade/typography.css`; focused typography/density tests. |
| Existing dirty worktree | Before this task, `git status --short` already showed many modified overlay, opencorvus, sdk, and spec files. Relevant dirty files include `packages/overlay/src/styles/tokens/design-language.css`, `packages/overlay/test/design-density-tokens.test.ts`, and `specs/records/2026-07/README.md`; this task must preserve those existing hunks. |
| Whole-repository grep evidence | `rg -n -e "--ui-font-(display|heading|title|body|control|meta|small|tiny|code)" -e "ui-font-body" -e "ui-font-control" -e "ui-font-meta" -e "font-size:\\s*(1[0-9](?:\\.\\d+)?px|calc\\(1[0-9](?:\\.\\d+)?px)" packages/overlay/src packages/overlay/test specs/records/2026-06 specs/records/2026-07`; `rg -n -e "design density|density tokens|typography|font size|font-size|字号|Codex app|overlay" specs/records/2026-06 specs/records/2026-07 specs/current/architecture --glob "!*.svg" --glob "!*.html"`. |
| Independent agent feedback | Not spawned. The user did not request sub-agents, and this is a narrow token/test change. Main-agent second review will inspect the diff, focused tests, and browser screenshot. |

## Evidence

- `packages/overlay/src/styles/tokens/design-language.css` is the single source for shared typography tokens.
- Current token values are `display=18px`, `heading=14px`, `title=13px`, `body=12px`, `control=12px`, `meta=12px`, `small=11px`, `tiny=10px`, and `code=11px`.
- `packages/overlay/src/styles/cascade/base.css` applies `font-size: var(--ui-font-body)` to `body`, so the whole overlay inherits the body token unless a surface intentionally selects another shared token.
- `packages/overlay/test/design-density-tokens.test.ts` currently pins control/meta to the 12px density contract. That test is the direct regression owner to update for this request.
- Most surface CSS already references the shared font tokens, so changing token values avoids adding per-component font overrides or a second typography source.

## Design

1. Keep layout density tokens, control heights, radius, spacing, and `--ui-scale` unchanged. The request is font size, not global chrome zoom.
2. Move the typography scale to a Codex-app-like 14px body baseline:
   - display: 22px
   - heading: 17px
   - title: 15px
   - body: 14px
   - control: 14px
   - meta: 14px
   - small: 12px
   - tiny: 11px
   - code: 13px
3. Preserve the hierarchy assertions: display > heading > title >= body.
4. Replace the old "control and meta stay on 12px" regression with a regression that pins body/control/meta to the 14px app baseline and keeps secondary tiers readable.
5. Do not change component markup, stores, routes, services, i18n, or pane sizing.

## Verification Plan

```powershell
bun test packages/overlay/test/design-density-tokens.test.ts packages/overlay/test/font-size-hierarchy.test.ts packages/overlay/test/goal-typography-floor.test.ts packages/overlay/test/discrete-typography-tokens.test.ts
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-composer-button-primitives.test.ts
```

Visual review must inspect an isolated browser screenshot and confirm the overlay text is materially larger, body/control/meta text is no longer on the previous 12px tier, and the composer/sidebar/conversation controls do not visibly overlap.

## Implementation Summary

- Updated `packages/overlay/src/styles/tokens/design-language.css` so the shared typography scale uses a 14px body/control/meta baseline and larger display/heading/title/code tiers.
- Kept `--ui-scale`, spacing, control heights, panel widths, and layout density tokens unchanged.
- Updated `packages/overlay/test/design-density-tokens.test.ts` to pin the 14px app baseline and readable secondary tiers instead of the retired 12px control/meta contract.
- Updated `packages/overlay/src/styles/surfaces/settings.css` to remove a stale comment that documented the old 14/13/12 typography tuple.
- Added this task record and indexed it in `specs/records/2026-07/README.md`.

## Validation

- `bun test packages/overlay/test/design-density-tokens.test.ts packages/overlay/test/font-size-hierarchy.test.ts packages/overlay/test/goal-typography-floor.test.ts packages/overlay/test/discrete-typography-tokens.test.ts`
  - 13 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck`
  - Passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - 20 pass, 0 fail.
- `git diff --check`
  - Passed; emitted an unrelated existing CRLF warning for `packages/overlay/test/conversation-agent-rail-records.test.ts`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-composer-button-primitives.test.ts`
  - 1 pass, 0 fail.

## Visual Review

- Component fixture screenshot: `.scratch/chat-composer-button-primitives.png`.
  - Reviewed: composer text and button labels are materially larger and remain within the rounded shell.
- Real overlay screenshot: `.scratch/overlay-codex-font-size-alignment.png`.
  - Reviewed: titlebar, Projects left rail, workspace dialog, composer, and primary buttons render larger without visible overlap or clipping.
- Computed metrics: `.scratch/overlay-codex-font-size-alignment-metrics.json`.
  - `bodyFontSize`: `14.56px`.
  - `--ui-font-body`, `--ui-font-control`, and `--ui-font-meta`: `calc(14px * 1.040)`.
  - Sample `.chat-textarea` font-size: `14.56px`; sample `.oc-button` font-size: `14.56px`; sample `.sidebar-title` font-size: `15.6px`.

## Second Review

- The change is centralized in design-language typography tokens; no component-level font-size exceptions were added.
- The old 12px control/meta regression was replaced with a 14px baseline regression.
- Existing dirty radius/index hunks in touched files were preserved.
- No running OpenCorvus or overlay process was restarted, refreshed, or killed; only an isolated Vite server was launched for screenshot verification.
