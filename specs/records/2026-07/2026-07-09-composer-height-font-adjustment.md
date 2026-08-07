# 2026-07-09 Composer Height Font Adjustment

## Recall

### User Request

- Slightly shorten the bottom input box.
- Slightly enlarge the font inside the input box.
- Screenshot shows the Codex-style composer shell still reading too tall, with placeholder/input text feeling too small inside the shell.

### Acceptance Criteria

- The existing `ChatComposer` remains the single composer implementation and keeps the existing textarea, Button, SelectControl, attachment loader, send/stop, drag/drop, paste, and resize behavior.
- The default composer shell becomes slightly shorter, without changing the message lane/composer width alignment.
- The textarea and floating placeholder use a slightly larger local font than the current `--ui-font-body` / `--ui-font-control` 14px tier.
- The textarea default floor and keyboard/drag resize minimum stay aligned so using the resize handle does not jump the composer taller.
- No fallback, alternate composer, iframe, query override, duplicate signal, or process restart is introduced.
- Real browser screenshot verification must inspect the rendered composer after the change.

### Hard Constraints

- Follow `AGENTS.md`: no fallback/compatibility paths, no blind patching, no git reset, preserve unrelated worktree changes, pair frontend changes with tests.
- Inspect persisted plans and grep evidence before editing.
- Do not restart, refresh, or kill the user's running OpenCorvus / overlay process; use an isolated browser fixture.
- Playwright/browser verification on Windows must run through Node, not Bun.
- Commit subject must start with `dsw-33987`; push to `legacy-remote`.

### Hard-Disk Context Read Before Editing

- `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`
- `specs/records/2026-07/2026-07-09-message-composer-scrollbar-alignment.md`
- `specs/records/2026-07/README.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/composer-resizer.ts`
- `packages/overlay/src/components/primitives/AutoGrowTextarea.tsx`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/styles/tokens/design-language.css`
- `packages/overlay/test/workspace-composer-density.test.ts`
- `packages/overlay/test/chat-input-flat.test.ts`
- `packages/overlay/test/chat-textarea-single-source.test.ts`
- `packages/overlay/test/browser/chat-composer-resize-browser.test.ts`

### Full-Repository Grep Evidence

- Command: `rg -n "composer|chat-input|textarea|input box|chatComposer|Prompt|mission\\.launcher|model capsule|message composer" packages/overlay/src packages/overlay/test specs/records/2026-07 -S`
- Relevant owners found:
  - `packages/overlay/src/components/ChatComposer.tsx`
  - `packages/overlay/src/components/composer-resizer.ts`
  - `packages/overlay/src/components/primitives/AutoGrowTextarea.tsx`
  - `packages/overlay/src/styles/surfaces/composer.css`
  - `packages/overlay/test/workspace-composer-density.test.ts`
  - `packages/overlay/test/browser/chat-composer-resize-browser.test.ts`
- Current token evidence:
  - `--ui-font-body` and `--ui-font-control` are both `calc(14px * var(--ui-scale))`.
  - `--ui-font-title` is `calc(15px * var(--ui-scale))`.
  - Current composer CSS sets `--chat-composer-min-height: calc(96px * var(--ui-scale));` and `--chat-textarea-height: calc(48px * var(--ui-scale));`.
  - Current `composer-resizer.ts` sets the keyboard/drag minimum to 72px, which is already taller than the CSS default floor and should be aligned during this density adjustment.

### Independent Agent Feedback

- None requested; this is a localized Overlay composer visual adjustment with direct tests.

## Implementation Plan

1. Add local composer text-size and line-height variables on `.chat-composer-stack`.
2. Lower the default composer shell and textarea floors slightly.
3. Change the composer textarea to one default row so the empty composer reads as a concise input.
4. Align `composer-resizer.ts` minimum height with the new textarea floor.
5. Update focused density and browser resize tests.
6. Run focused unit/browser tests, inspect generated screenshot, run i18n/typecheck/docs health, then commit and push.
