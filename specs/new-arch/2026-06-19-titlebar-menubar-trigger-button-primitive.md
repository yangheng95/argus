# Titlebar Menubar Trigger Button Primitive

Date: 2026-06-19

## Problem

`TitlebarMenubar` already delegates menubar behavior to Kobalte Menubar, but
the visible top-level menu trigger still hand-assembles the shared button
contract by rendering `class="oc-button"` plus `data-variant`, `data-size`, and
`data-tone` attributes directly on `Menubar.Trigger`.

That creates a second construction path for button chrome. The stylesheet also
keeps a stale `.titlebar-menubar-trigger` rule family even though the live TSX
uses `data-ui="titlebar-menubar-trigger"` as a stable hook.

## Recall

| Source | Evidence | Decision |
| --- | --- | --- |
| `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` | `Menubar.Trigger` owns menu semantics but manually emits `class="oc-button"` and button data attributes. | Keep `Menubar.Trigger`, render it `as={Button}`. |
| `packages/overlay/src/components/WorkspaceSplitLauncher.tsx` | Existing Kobalte trigger pattern uses `DropdownMenu.Trigger as={Button}`. | Reuse the same primitive-composition pattern. |
| `packages/overlay/src/styles/surfaces/titlebar.css` | `.oc-button[data-ui="titlebar-menubar-trigger"]` already owns live trigger dimensions, while `.titlebar-menubar-trigger` duplicates hover/focus chrome. | Retire `.titlebar-menubar-trigger`; keep `.oc-button[data-ui=...]`. |
| `packages/overlay/test/titlebar-menubar-primitive.test.ts` | Guards Kobalte ownership but not shared `Button` ownership. | Add a guard requiring `as={Button}` and rejecting manual button contract assembly. |
| `packages/overlay/test/flat-redesign-border-policy.test.ts` and `owner-surface-consistency.test.ts` | Assert hover background through the stale class selector. | Retarget to the live `.oc-button[data-ui=...]` selector. |

## Fix

- Import `Button` in `TitlebarMenubar`.
- Render `Menubar.Trigger as={Button}` with `variant="ghost"`, `size="sm"`,
  and `tone="neutral"`.
- Remove the stale `.titlebar-menubar-trigger` CSS rule family.
- Retarget tests to the live `oc-button[data-ui="titlebar-menubar-trigger"]`
  selector and add a primitive guard.

## Acceptance

- `TitlebarMenubar` trigger chrome is created only through `Button`.
- No production CSS selector targets `.titlebar-menubar-trigger`.
- `data-ui="titlebar-menubar-trigger"` remains available for browser tests and
  Alt access-key workflows.
- Targeted titlebar unit/browser tests and overlay typecheck pass.

## Verification

- `bun test packages/overlay/test/titlebar-menubar-primitive.test.ts packages/overlay/test/flat-redesign-border-policy.test.ts packages/overlay/test/owner-surface-consistency.test.ts packages/overlay/test/overlay-architecture-guards.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 --test-name-pattern "titlebar menubar uses theme-adaptive text color" packages/overlay/test/browser/titlebar-menubar.test.ts`
- Visual review: `.scratch/titlebar-menubar-trigger-button-menu.png`
