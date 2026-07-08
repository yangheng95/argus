# Overlay Codex Milk Tea Light Theme

Date: 2026-07-08
Status: Verified

## Recall

| Item | Detail |
| --- | --- |
| User request | "把纯白色的主题改成类似codex的奶茶白色". |
| Acceptance criteria | Overlay light theme no longer renders the main shell, chat canvas, sidebar, panel body, chrome, dialog, and menu materials as pure white or blue-white; the change is centralized in the existing light palette tokens; no component-level color overrides or second theme source are introduced; focused theme tests, raw color scan, real browser screenshot review, and second review pass. |
| Hard constraints | Follow `AGENTS.md`; no fallback or compatibility path; no blind component patching; preserve unrelated dirty worktree changes; do not restart, reload, kill, or refresh any running OpenCorvus or overlay process; run Playwright through Node on Windows; every code change needs matching test coverage. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/artifacts/tv2ainvest.md`; `specs/current/architecture/99-principles.md`; `specs/records/2026-07/2026-07-08-overlay-codex-font-size-alignment.md`; `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`; `specs/records/2026-07/2026-07-08-codex-message-panel-titlebar-toolbar.md`; `packages/overlay/src/styles/cascade/light.css`; `packages/overlay/src/styles/cascade/base.css`; `packages/overlay/src/styles/tokens/design-language.css`; `packages/overlay/test/theme-palette-intent.test.ts`; `packages/overlay/test/window-opacity-shell-tokens.test.ts`; `packages/overlay/test/flat-redesign-theme-symmetry.test.ts`. |
| Existing dirty worktree | Before this task, `git status --short` already showed broad uncommitted changes in `packages/opencorvus/**`, `packages/overlay/**`, generated SDK docs, and July specs. This task must only touch the light theme palette/test/spec surfaces needed for the user request. |
| Whole-repository grep evidence | `rg -n -e 'body\\[data-theme="light"\\]' -e ':root\\[data-theme="light"\\]' -e '--bg' -e '--body-bg' -e '--surface' -e '--surface-inset' -e '--surface-strong' -e '--chat-canvas' -e '--rail-surface' -e '#fff' -e '#ffffff' -e '255, 255, 255' -e 'white' packages/overlay/src/styles/cascade packages/overlay/src/styles/surfaces packages/overlay/test -S -g '*.css' -g '*.ts' -g '*.tsx'`; `rg -n "milk|cream|latte|奶茶|warm|Codex app|Codex-style|light theme|palette|surface|body-bg|chat-canvas|rail-surface" specs/records/2026-07 specs/current packages/overlay/test packages/overlay/src/styles -S -g '*.md' -g '*.css' -g '*.ts'`. |
| Independent agent feedback | Not spawned. The user did not request parallel agents; this is a narrow theme-token change with focused source and browser verification. |

## Diagnosis

The pure-white feeling is not a component implementation bug. The light theme declares the shared material tokens in `packages/overlay/src/styles/cascade/light.css`, and many surfaces correctly consume those tokens:

- `--surface`, `--surface-strong`, `--chat-canvas`, `--panel-body-bg`, `--chrome`, `--dialog-bg`, and `--menu-panel-bg` are currently `rgb(255, 255, 255)`.
- `conversation.css`, `sidebar.css`, `composer.css`, `card.css`, `field.css`, and primitives consume `var(--surface*)`, `var(--chat-canvas)`, `var(--rail-surface)`, and `var(--menu-panel-bg)`.
- Moving the palette in `light.css` changes the whole light theme without adding local CSS branches, raw component colors, or a duplicate visual source.

## Design

1. Keep theme architecture unchanged: three cascade theme files still declare the same token set; structural tokens stay in `design-language.css`.
2. Replace the blue-white light palette with a warm off-white material ramp:
   - shell/backing: warm paper beige;
   - primary surface: milk-tea off-white;
   - hover/inset: slightly deeper warm ivory;
   - strong/dialog/menu/chrome: warm near-white, not pure white.
3. Keep accent, status, syntax, and text contrast tokens in their current families unless contrast tests require adjustment. The user asked for white-material replacement, not an accent redesign.
4. Replace light-theme white highlight and panel/card wash literals with warm `var(--surface-strong)` mixes where they are material highlights.
5. Add a regression in `theme-palette-intent.test.ts` that pins the warm light material tokens and rejects pure-white light material tokens.

## Verification Plan

```powershell
bun test packages/overlay/test/theme-palette-intent.test.ts packages/overlay/test/window-opacity-shell-tokens.test.ts packages/overlay/test/flat-redesign-theme-symmetry.test.ts packages/overlay/test/flat-redesign-theme-cascade-discipline.test.ts
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-composer-button-primitives.test.ts
```

Visual review must inspect the generated browser screenshot and confirm the light-theme screenshot no longer reads as pure white/blue-white on the visible shell, sidebar, chat canvas, composer, and controls.

## Implementation Summary

- `packages/overlay/src/styles/cascade/light.css`
  - Replaced the light-theme shell/material ramp with warm off-white values for `--bg`, `--surface`, `--surface-hover`, `--surface-inset`, `--surface-strong`, `--rail-surface`, `--chat-canvas`, `--inspector-surface`, `--body-bg`, `--panel-body-bg`, `--chrome`, `--dialog-bg`, and `--menu-panel-bg`.
  - Replaced material highlight washes that used pure white rgba/keyword mixes with `var(--surface-strong)` mixes.
  - Lowered light-theme `--accent-dim` from 11% to 7% after contrast verification showed the warm popup background made secondary text on accent wash fall below 4.5:1.
  - Darkened light-theme `--oc-syntax-function` from `#8250df` to `#6f42c1` so Markdown code function tokens remain readable on the new warm code surface.
- `packages/overlay/test/theme-palette-intent.test.ts`
  - Added a regression that pins the warm milk-tea material ramp and rejects the retired blue-white material colors.
- `packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts`
  - Added a Node Playwright browser test that renders the real light-theme CSS over representative sidebar, chat canvas, card, and composer surfaces, asserts computed colors are warm off-white rather than pure white, and saves visual evidence.
- `specs/records/2026-07/README.md`
  - Indexed this record under the July spec record list.

## Validation

- PASS: `bun test packages/overlay/test/theme-palette-intent.test.ts packages/overlay/test/window-opacity-shell-tokens.test.ts packages/overlay/test/flat-redesign-theme-symmetry.test.ts packages/overlay/test/flat-redesign-theme-cascade-discipline.test.ts`
  - 40 pass, 0 fail.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - 20 pass, 0 fail.
- PASS: `git diff --check -- packages/overlay/src/styles/cascade/light.css packages/overlay/test/theme-palette-intent.test.ts packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts specs/records/2026-07/2026-07-08-overlay-codex-milk-tea-light-theme.md specs/records/2026-07/README.md`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-composer-button-primitives.test.ts packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts`.

## Visual Review

- Reviewed `C:\Users\chuan\myhexin-local\opecorvus\.scratch\light-theme-milk-tea.png`.
- The left Projects rail, chat canvas, message/card region, composer shell, and controls now read as warm milk-tea/off-white surfaces rather than pure white or blue-white.
- The screenshot still preserves visible hierarchy between sidebar, chat canvas, card/message surfaces, and the composer shell.

## Raw Color Scan

Scan command:

```powershell
rg -n "rgb\(255,\s*255,\s*255\)|rgba\(255,\s*255,\s*255|#fff(?:fff)?\b|\bwhite\b|rgb\(238,\s*243,\s*255\)|rgb\(243,\s*247,\s*255\)|rgb\(247,\s*249,\s*255\)|rgb\(250,\s*252,\s*255\)" packages/overlay/src/styles/cascade/light.css packages/overlay/test/theme-palette-intent.test.ts packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts specs/records/2026-07/2026-07-08-overlay-codex-milk-tea-light-theme.md -S
```

Result:

- No retired blue-white material colors remain in `light.css`.
- `light.css` still contains `--text-on-accent: #ffffff` and `--text-on-strong: #ffffff`; these are foreground contrast tokens for strong/accent buttons, not background material tokens.
- Remaining `white` / pure-white matches are in test assertions and this record's prose.

## Second Review

- The change is centralized in the existing light theme palette. No surface CSS file gained `body[data-theme=...]`, component-specific color branches, or a second palette source.
- Theme parity tests prove dark, light, and vscode-dark still declare the same token set.
- The browser screenshot and computed-color test verify visible surfaces, not only CSS text.
- Existing broad dirty worktree changes were preserved; this task did not reset or rewrite unrelated files.
