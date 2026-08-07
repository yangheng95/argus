# 2026-07-09 Codex Reference Light Theme

## Recall

| Item | Detail |
| --- | --- |
| User request | "你要是不会设计就抄这个主题" with screenshot `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-e20a74bf-95bb-44fb-b43f-2898a4ef3bb0.png`. |
| Acceptance criteria | Overlay light theme should follow the screenshot's Codex-style light theme: pale blue left/title rail, near-white main canvas and composer/card surfaces, soft neutral borders, restrained shadows, and neutral readable text. The palette must remain centralized in the existing light theme tokens; no component-level raw color branches or duplicate theme source. |
| Hard constraints | Follow `AGENTS.md`; no fallback or compatibility path; preserve unrelated dirty worktree changes; do not restart, reload, kill, or refresh running OpenCorvus/overlay; Playwright/browser checks must use Node on Windows; frontend visual work requires screenshot review; code changes need matching tests; commit subject starts with `dsw-33987`; push to `legacy-remote`. |
| Sources read | `AGENTS.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-08-overlay-codex-milk-tea-light-theme.md`; `packages/overlay/src/styles/cascade/light.css`; `packages/overlay/test/theme-palette-intent.test.ts`; `packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts`; `packages/overlay/src/styles/surfaces/sidebar.css`; `packages/overlay/src/styles/surfaces/conversation.css`; `packages/overlay/src/styles/surfaces/composer.css`. |
| Existing dirty worktree | Before this task, `git status --short` showed unrelated edits in `packages/overlay/src/components/TaskProgressBar.tsx`, locale files, `packages/overlay/test/task-progress-collapse.test.ts`, `specs/records/2026-07/README.md`, and an untracked goal-progress spec. This task must not stage or revert those unrelated changes. |
| Screenshot color evidence | Sampled with PIL from the attached screenshot: topbar/left sidebar `(236,246,249)`, sidebar lower `(239,245,246)`, main canvas `(255,255,255)`, composer card `(255,254,255)`, composer footer/border `(214,214,215)`. Rectangle modes: left sidebar `(236,244,248)` and `(232,244,248)`; main background `(252,252,252)`; composer card `(252,252,252)`; lower composer strip `(244,244,244)` / `(212,212,212)`. |
| Whole-repository grep evidence | `rg -n -e "--body-bg" -e "--bg" -e "--rail-surface" -e "--chat-canvas" -e "--chrome" -e "--panel-body-bg" -e "--surface" -e "--surface-inset" -e "--surface-strong" -e "--border" -e "--shadow" -e "--ui-shadow-tone" packages/overlay/src/styles packages/overlay/test -S`; `rg -n "milk-tea\|warm milk\|pure white\|blue-white\|light-theme\|light theme\|Codex" packages/overlay/test packages/overlay/src/styles specs/records/2026-07 -S`. |
| Independent agent feedback | Not spawned. The user did not request sub-agents; this is a focused palette correction with direct screenshot evidence and browser verification. |

## Diagnosis

The previous 2026-07-08 "milk tea" palette moved away from pure white, but it chose a beige ramp (`rgb(241,235,224)` / `rgb(250,246,239)`). The new screenshot reference is not beige. Its dominant structure is:

1. Pale blue rail/titlebar around `rgb(236,246,249)`.
2. Main content and composer/card bodies near white (`rgb(252,252,252)` to `rgb(255,255,255)`).
3. Low-contrast neutral borders around `rgb(214,214,215)`.
4. Dark neutral text rather than blue-purple text.

The existing architecture is still correct: `light.css` is the single source for these material tokens, and `sidebar.css`, `conversation.css`, `composer.css`, and card surfaces already consume the shared tokens. The fix is to revise the palette and tests, not add component-level overrides.

## Design

1. Replace the beige light palette with a Codex-reference light palette:
   - `--bg`, `--rail-surface`, and `--chrome`: pale blue rail/titlebar.
   - `--surface`, `--surface-strong`, `--chat-canvas`, `--panel-body-bg`, `--dialog-bg`, and `--menu-panel-bg`: near-white content surfaces.
   - `--surface-hover` and `--surface-inset`: neutral light gray control states.
   - border and shadow tones: neutral gray, not purple-blue.
2. Keep the theme token set unchanged so dark, light, and vscode-dark remain symmetric.
3. Keep semantic accent/status colors in the existing family for now. The screenshot's black send button is a composer/button styling question; this task is scoped to the shared light material theme.
4. Rename/update browser theme assertions away from "warm milk tea" and toward "Codex reference" evidence.
5. Preserve browser screenshot review and raw-color scanning over changed files.

## Verification Plan

```powershell
bun test packages/overlay/test/theme-palette-intent.test.ts packages/overlay/test/window-opacity-shell-tokens.test.ts packages/overlay/test/flat-redesign-theme-symmetry.test.ts packages/overlay/test/flat-redesign-theme-cascade-discipline.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check -- <changed files>
```

Visual review must inspect the generated screenshot and confirm the rendered rail is pale blue while the main canvas/composer/card surfaces read as near-white, matching the attached Codex reference more closely than the previous beige palette.

## Implementation

- `packages/overlay/src/styles/cascade/light.css` now uses the screenshot-derived Codex reference ramp: pale-blue `--bg` / `--rail-surface` / `--chrome`, near-white main surfaces, neutral text, neutral borders, and restrained neutral shadows.
- `packages/overlay/src/styles/surfaces/header.css` gives `.sidebar-header.oc-surface-header` `background: var(--rail-surface)` so the left rail header remains continuous with the left rail instead of reverting to the shared white header surface.
- `packages/overlay/test/theme-palette-intent.test.ts` now pins the Codex-reference light theme token values and rejects the retired beige milk-tea values.
- `packages/overlay/test/surface-header-primitive.test.ts` now pins the sidebar header rail-token variant without moving header ownership into the cascade layer.
- `packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts` keeps its historical filename but now validates the Codex-reference theme, including computed colors for the sidebar, sidebar header, main panel, chat canvas, scroll area, and composer.

## Validation

```powershell
bun test packages/overlay/test/theme-palette-intent.test.ts packages/overlay/test/window-opacity-shell-tokens.test.ts packages/overlay/test/flat-redesign-theme-symmetry.test.ts packages/overlay/test/flat-redesign-theme-cascade-discipline.test.ts packages/overlay/test/surface-header-primitive.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check -- packages/overlay/src/styles/cascade/light.css packages/overlay/src/styles/surfaces/header.css packages/overlay/test/theme-palette-intent.test.ts packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts packages/overlay/test/surface-header-primitive.test.ts specs/records/2026-07/README.md specs/records/2026-07/2026-07-09-codex-reference-light-theme.md
```

Results:

- Theme/header unit suite: 49 pass, 0 fail.
- Node browser theme suite: 1 pass, 0 fail.
- Overlay typecheck: pass.
- Historical docs link suite: 20 pass, 0 fail.
- `git diff --check`: pass.

## Visual Review

Generated screenshot: `.scratch/light-theme-codex-reference.png`.

Review result: passed. The rendered sidebar and sidebar header are continuous pale blue, while the main panel, chat canvas, message/card surfaces, and composer are near-white. This removes the visible beige cast from the prior light theme and fixes the sidebar header white-block mismatch found during the first browser screenshot pass.

## Raw Color Scan

Scoped command:

```powershell
rg -n --glob 'packages/overlay/src/styles/cascade/light.css' --glob 'packages/overlay/src/styles/surfaces/header.css' --glob 'packages/overlay/test/theme-palette-intent.test.ts' --glob 'packages/overlay/test/browser/light-theme-milk-tea-browser.test.ts' --glob 'packages/overlay/test/surface-header-primitive.test.ts' --glob 'specs/records/2026-07/2026-07-09-codex-reference-light-theme.md' --glob 'specs/records/2026-07/README.md' "#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|color-mix\(|linear-gradient\("
```

Result: matches are limited to centralized light theme tokens, existing theme-token assertions, browser-test computed-style assertions, and this evidence record. No component JSX raw color branch was added.

## Second Review

The final diff keeps the theme source centralized in `light.css`, uses a single header-surface variant for rail continuity, and does not introduce fallback, compatibility branches, alternate theme sources, or component-level raw color overrides.
