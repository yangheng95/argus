# Overlay text contrast deepening

## Recall

- User request: deepen the font colors across the user interface because the current text is too light.
- Acceptance:
  - increase the visual contrast of primary, secondary, and muted text without flattening their hierarchy;
  - keep one theme-owned source of truth across light, dark, and VS Code dark;
  - verify the affected UI in a real Vite page with screenshots for the delivery surface;
  - add regression coverage for the intended palette values and readable contrast.
- Hard constraints:
  - preserve all concurrent worktree changes;
  - do not add component-local color overrides, fallback palettes, gates, or a second theme source;
  - use Node, not Bun, for Playwright/browser execution;
  - do not restart or interfere with the running OpenCorvus/Overlay application;
  - commit with the `dsw-33987` subject prefix and push only the task-owned result to `legacy-remote`.
- Materials read:
  - `AGENTS.md`;
  - `specs/current/architecture/99-principles.md` is the referenced architecture source for prompt-over-host and single-source principles, but this token-only change does not alter those architectural contracts;
  - `packages/overlay/src/styles/tokens/design-language.css`;
  - `packages/overlay/src/styles/cascade/{dark,light,vscode-dark}.css`;
  - `packages/overlay/test/theme-palette-intent.test.ts`;
  - browser-control skill instructions for real Vite visual acceptance.
- Full-repository grep:
  - canonical declarations exist only in `cascade/dark.css`, `cascade/light.css`, and `cascade/vscode-dark.css`;
  - consumers across primitives, conversation, activity, automations, workspace, composer, settings, mailbox, markdown, terminal, titlebar, and interactive artifacts reference `--text`, `--text-strong`, `--text-soft`, or `--text-muted`;
  - `theme-palette-intent.test.ts` pins light text values and already contains contrast helpers;
  - theme token-name symmetry is covered by `flat-redesign-theme-symmetry.test.ts`;
  - no component-local rewrite is needed: changing the three symmetric palette declarations reaches every listed consumer through the canonical tokens.
- Independent agent feedback: not requested by the user, so no sub-agent was started.

## Diagnosis

The hierarchy is structurally correct, but the dark palettes assign `--text-soft`
and especially `--text-muted` values that are too close to the dark surfaces.
The light palette clears basic contrast checks but still renders its secondary
tiers with a low-emphasis gray that feels washed out at the Overlay's compact
font sizes. The correct repair is to strengthen the canonical palette tokens,
not to scatter per-component overrides.

## Call-site decision

| Surface | Existing source | Decision |
| --- | --- | --- |
| Dark theme | `cascade/dark.css` | strengthen primary, soft, and muted text while retaining ordered luminance |
| Light theme | `cascade/light.css` | darken primary, soft, and muted text while retaining ordered luminance |
| VS Code dark theme | `cascade/vscode-dark.css` | strengthen primary, soft, and muted text with the same semantic hierarchy |
| All component consumers | `var(--text*)` throughout Overlay styles/components | keep unchanged; they already consume the canonical source |
| Theme contract tests | `theme-palette-intent.test.ts` | replace stale literal expectations and add cross-theme surface contrast assertions |

## Verification

1. Run focused theme palette and symmetry tests.
2. Run Overlay typecheck and Vite build.
3. Start an isolated Vite server without touching the running native Overlay.
4. Capture and inspect before/after desktop screenshots of the same delivery surface in all three themes.
5. Recheck the diff, worktree status, staged paths, and `HEAD`; commit only task-owned files and push to `legacy-remote`.
