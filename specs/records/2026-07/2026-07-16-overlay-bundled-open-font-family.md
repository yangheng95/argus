# 2026-07-16 Overlay Bundled Open Font Family

Date: 2026-07-16
Status: Complete
Owner: Codex

## Recall

| Item | Detail |
| --- | --- |
| User request | “似乎字体跟codex不一样，有什么好看的非专利字体？” followed by “改进字体”. |
| Acceptance criteria | Overlay body and code typography use attractive open-license fonts bundled with the application; Chinese and Latin text render consistently across Windows hosts; no overseas font CDN or runtime system-font dependency remains in the canonical typography tokens; focused tests, production build, computed styles, and a real isolated browser screenshot verify the result. |
| Hard constraints | Follow `AGENTS.md`; keep `packages/overlay/src/styles/tokens/design-language.css` as the single typography token source; no compatibility alias or second theme-specific font source; use mature font packages rather than hand-made/download-at-runtime font plumbing; preserve unrelated dirty worktree hunks; no git reset; do not restart, refresh, close, or kill any running OpenCorvus/Overlay process; use Node rather than Bun for browser automation on Windows; code changes require regression tests; update both spec indexes; commit subject starts with `dsw-33987`; push the delivery branch to `myhexin`. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-08-overlay-codex-font-size-alignment.md`; `packages/overlay/src/index.html`; `packages/overlay/package.json`; `packages/overlay/src/styles/tokens/design-language.css`; `packages/overlay/src/styles/cascade/base.css`; `packages/overlay/test/design-density-tokens.test.ts`; `packages/overlay/test/flat-redesign-theme-symmetry.test.ts`; Fontsource package manifests and packaged CSS for Geist, Noto Sans SC, and JetBrains Mono. |
| Existing dirty worktree | The worktree already contains unrelated changes across Overlay, OpenCorvus, transport protocol, and specs. Relevant pre-existing hunks are the macOS titlebar tokens in `design-language.css` and existing July index additions. This task will add only font-specific hunks and preserve those changes. |
| Git baseline | After `git fetch myhexin`, `myhexin/work-v0.0.6beta-yr-0716` resolved to local `HEAD` `afb457319`; the existing committed baseline was already present on git-cc before task edits began. |
| Whole-repository grep evidence | `rg -n --glob '*.css' --glob '*.tsx' --glob '*.ts' -- "--font:|--mono:|var\(--font\)|var\(--mono\)" packages/overlay/src packages/overlay/test` found 105 definition/consumer matches across 37 files. `rg -n --glob '!node_modules/**' "Segoe UI Variable Text|Microsoft YaHei UI|Cascadia Code|JetBrains Mono|--font:|--mono:" packages/overlay specs/records/2026-07 --glob '!*.svg' --glob '!*.html'` confirmed that the canonical runtime family literals live only in `design-language.css`; one isolated browser fixture owns its own Inter test stack. |
| Independent agent feedback | Not spawned because the user did not request sub-agents. The main agent owns the required second review of dependency footprint, source diff, tests, production build, computed styles, and screenshot. |

## Evidence and Decision

The existing canonical stacks are platform-dependent:

- `--font`: `Segoe UI Variable Text`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei UI`, `system-ui`, `sans-serif`.
- `--mono`: `Cascadia Code`, `JetBrains Mono`, `ui-monospace`, `monospace`.

This makes the same Overlay render with different glyph metrics and Chinese/Latin texture depending on the host. The prior Codex alignment changed the size scale but intentionally did not change font families, so it could not resolve this visual difference.

The initial IBM Plex family candidate was rejected after package inspection: `@ibm/plex-sans-sc@1.1.0` has an unpacked size of about 124 MB. The selected mature local packages are:

| Package | Exact version | Unpacked size | Role |
| --- | ---: | ---: | --- |
| `@fontsource-variable/geist` | `5.2.9` | about 181 KB | Modern Latin UI glyphs, variable weights 100–900. |
| `@fontsource-variable/noto-sans-sc` | `5.2.10` | about 4.9 MB | Simplified Chinese and uncovered glyph ranges, segmented by Unicode range, variable weights 100–900. |
| `@fontsource-variable/jetbrains-mono` | `5.2.8` | about 204 KB | Code and technical identifiers, variable weights 100–800. |

All assets are supplied as local WOFF2 files under dependencies and use the SIL Open Font License. No runtime network source is needed.

## Exhaustive Call-Site Disposition

The two definitions in `packages/overlay/src/styles/tokens/design-language.css:147,148` will be replaced. Every consumer remains unchanged and inherits the new families through the same canonical tokens.

| File | Lines | Disposition |
| --- | --- | --- |
| `src/styles/cascade/base.css` | 98 | Preserve consumer. |
| `src/styles/primitives/badge.css` | 12 | Preserve consumer. |
| `src/styles/primitives/button.css` | 36 | Preserve consumer. |
| `src/styles/surfaces/card.css` | 732, 752, 779, 1596, 1638, 1665, 1712 | Preserve consumers. |
| `src/styles/surfaces/changes.css` | 44, 96, 222 | Preserve consumers. |
| `src/styles/surfaces/conversation.css` | 1079, 1231 | Preserve consumers. |
| `src/styles/surfaces/diff.css` | 28 | Preserve consumer. |
| `src/styles/surfaces/header.css` | 38 | Preserve consumer. |
| `src/styles/surfaces/inspector.css` | 100, 423, 834, 955, 1462, 1732, 1752, 1790, 2010, 2084, 2181, 2233, 2633, 2720 | Preserve consumers. |
| `src/styles/surfaces/markdown.css` | 147, 160 | Preserve consumers. |
| `src/styles/surfaces/messages.css` | 51, 69, 116, 203, 218, 290, 344, 506, 591, 630, 732, 741, 773, 1077 | Preserve consumers. |
| `src/styles/surfaces/notifications.css` | 304 | Preserve consumer. |
| `src/styles/surfaces/settings.css` | 151, 334, 716, 1023, 1093, 1210, 1395, 1675, 2272, 2471, 2595, 2697, 2739, 2921, 2979, 3143, 3150, 3161, 3379, 3442, 3448, 3467, 3512, 3742 | Preserve consumers. |
| `src/styles/surfaces/terminal.css` | 78 | Preserve consumer. |
| `src/styles/surfaces/workspace.css` | 47, 294, 308, 345, 357, 362 | Preserve consumers. |
| `src/styles/tokens/design-language.css` | 147, 148 | Replace platform-dependent definitions with bundled family composition. |
| `test/browser/armed-confirm-button-browser.test.ts` | 54 | Preserve fixture consumer. |
| `test/browser/button-format-browser.test.ts` | 54 | Preserve fixture consumer. |
| `test/browser/button-solid-contrast-browser.test.ts` | 67 | Preserve fixture consumer. |
| `test/browser/card-todo-summary-progressbar-browser.test.ts` | 43 | Preserve fixture consumer. |
| `test/browser/conversation-scroll-bottom-button-browser.test.ts` | 54, 91 | Preserve isolated fixture-owned Inter definition and consumer; it does not load production tokens. |
| `test/browser/css-token-closure-browser.test.ts` | 54 | Preserve fixture consumer; update the computed-family assertion only if the existing JetBrains-compatible assertion is insufficient. |
| `test/browser/fixtures/agent-card-separation/fixture.css` | 17 | Preserve fixture consumer. |
| `test/browser/fixtures/integrity-card/fixture.css` | 11 | Preserve fixture consumer. |
| `test/browser/fixtures/message-part-chronology/fixture.css` | 10, 19 | Preserve fixture consumers. |
| `test/browser/integrity-panel-token-source-browser.test.ts` | 56 | Preserve fixture consumer. |
| `test/browser/markdown-code-copy-button-browser.test.ts` | 52 | Preserve fixture consumer. |
| `test/browser/memory-search-field-browser.test.ts` | 53 | Preserve fixture consumer. |
| `test/browser/popup-contrast-matrix.test.ts` | 61 | Preserve fixture consumer. |
| `test/browser/reasoning-markdown-browser.test.ts` | 53 | Preserve fixture consumer. |
| `test/browser/reasoning-toggle-button-browser.test.ts` | 54 | Preserve fixture consumer. |
| `test/browser/select-popup-contrast-matrix.test.ts` | 61 | Preserve fixture consumer. |
| `test/browser/session-dialog-residue-browser.test.ts` | 49, 91 | Preserve fixture consumers. |
| `test/browser/settings-neighbor-surfaces-pref-residue-browser.test.ts` | 64 | Preserve fixture consumer. |
| `test/browser/task-progress-floating-window-browser.test.ts` | 82 | Preserve fixture consumer. |
| `test/browser/task-progress-pill-focus-browser.test.ts` | 55 | Preserve fixture consumer. |
| `test/browser/trace-event-head-focus-browser.test.ts` | 56 | Preserve fixture consumer. |

## Design

1. Add exact Fontsource variable-font packages as Overlay runtime dependencies so Vite packages WOFF2 assets with the application.
2. Add one `styles/tokens/fonts.css` asset entry and load it before `design-language.css` in `src/index.html`.
3. Keep `design-language.css` as the single family selection source:
   - `--font: "Geist Variable", "Noto Sans SC Variable"`.
   - `--mono: "JetBrains Mono Variable", "Noto Sans SC Variable"`.
4. Remove the old operating-system-specific families rather than retaining them as compatibility fallbacks.
5. Keep font sizes, line heights, spacing, layout, component CSS, themes, and terminal rendering logic unchanged.
6. Add a focused source-contract test that proves local package imports, load order, exact runtime dependencies, canonical tokens, removal of old platform stacks, and absence of remote font URLs.

### Codex review feedback

The first implementation/build review found that Vite correctly emitted the WOFF2 font binaries but the repository had no Overlay third-party notice surface. SIL Open Font License condition 2 requires redistributed copies to retain the copyright notice and license. The design is therefore revised before final delivery:

7. Add `src/licenses/fonts/NOTICE.md` plus the complete `SIL-OFL-1.1.txt` text.
8. Extend the existing `copyStaticAssets` Vite path to copy `src/licenses` into `dist-vite/licenses`, and extend the focused regression to prove both notice content and packaged output ownership.

## Verification Plan

```powershell
bun test packages/overlay/test/font-family-assets.test.ts packages/overlay/test/design-density-tokens.test.ts packages/overlay/test/flat-redesign-theme-symmetry.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build:vite
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
```

Launch a new isolated Vite process without touching the running Overlay, open it with the in-app Browser, and verify:

- computed `--font` and representative UI text resolve to Geist/Noto;
- computed `--mono` and code text resolve to JetBrains Mono/Noto;
- `document.fonts.check` succeeds for Latin, Chinese, and monospace samples;
- the screenshot shows no clipping, weight regression, tofu glyphs, or broken mixed-language alignment in the task-scoped delivery surface.

## Implementation Summary

- Added exact runtime dependencies for Geist Variable 5.2.9, Noto Sans SC Variable 5.2.10, and JetBrains Mono Variable 5.2.8 with a nine-line minimal `bun.lock` update.
- Added `styles/tokens/fonts.css` as the only local font asset entry and loaded it before `design-language.css`.
- Replaced the platform-dependent `--font` and `--mono` definitions with the bundled Geist/Noto and JetBrains/Noto compositions; all 103 existing token consumers remain unchanged.
- Added `font-family-assets.test.ts` to cover dependency ownership, stylesheet ordering, local-only imports, retired system-font stacks, attributions, license text, and packaging configuration.
- Added the font notice and complete SIL Open Font License 1.1 text under `src/licenses/fonts`; Vite copies the directory into the production bundle.

## Validation

- `bun test packages/overlay/test/font-family-assets.test.ts packages/overlay/test/design-density-tokens.test.ts packages/overlay/test/flat-redesign-theme-symmetry.test.ts`
  - 40 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck`
  - Passed.
- `bun run --cwd packages/overlay build:vite`
  - Passed; emitted local Geist, Noto Sans SC, and JetBrains Mono WOFF2 assets.
  - Confirmed `dist-vite/licenses/fonts/NOTICE.md` and `dist-vite/licenses/fonts/SIL-OFL-1.1.txt` exist.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - 21 pass, 0 fail.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/css-token-closure-browser.test.ts`
  - 1 pass, 0 fail under the required Node runner.
- `git diff --check`
  - Passed.

## Visual Review

- Real isolated Overlay screenshot: `.scratch/overlay-bundled-font-preview.png`.
- Reviewed the desktop home/composer surface and live project rail at the actual application viewport. English headings, controls, labels, timestamps, and Chinese project/chat titles render cleanly without clipping, tofu glyphs, or broken weight hierarchy.
- Computed `--font`: `"Geist Variable", "Noto Sans SC Variable"`.
- Computed `--mono`: `"JetBrains Mono Variable", "Noto Sans SC Variable"`.
- Body computed family matches the sans token at `14px`; empty-home heading matches it at `32px`.
- Visible Chinese sample `你好` uses the same composed family at `14px`/400 and reports Noto Sans SC loaded.
- Browser console error count: 0.

## Second Review

- Rejected the approximately 124 MB unpacked IBM Plex Sans SC package in favor of the approximately 5.3 MB combined variable-font packages with Unicode-range-segmented Chinese assets.
- Confirmed all family selection remains centralized in `design-language.css`; no component, theme, or runtime font fallback path was added.
- Found and repaired the initial license-distribution gap before final delivery, then rebuilt and re-ran the focused suite.
- Preserved concurrent Work Ledger, Mission, native-window, and spec-index changes. The initial font implementation was incorporated into the concurrent `6f11a6f33` baseline and is already present on `myhexin`; the final font-license closure is committed separately.
- Did not restart, refresh, close, or kill the user's running OpenCorvus/Overlay. Visual verification used only a task-owned Vite process on port 43217, which was stopped after browser cleanup.
