# Retire TopBar Dead Control

## Problem

`packages/overlay/src/components/TopBar.tsx` is a dead Solid component. Its header comment says it is shown above the Mission main panel, but the current source tree has no production mount point for `<TopBar>`. The only non-self reference is `packages/overlay/test/host-transport-capabilities.test.ts`, which reads the file as source text and treats it as a visible HostTransport capability control.

That makes the HostTransport capability test a second source for a UI surface that users cannot see. A regression in the real directory controls could be hidden by a passing assertion against this dead file.

## Recall

- `specs/new-arch/2026-06-09-overlay-ui-tech-debt-consensus.md` requires visible native-command controls to match HostTransport capabilities.
- That requirement applies to mounted UI controls such as `TaskDirBar`, `TitlebarMenubar`, `WorkspaceOnboardingDialog`, `WindowControls`, and `WorkspaceEditorLaunchers`.
- Keeping an unmounted component only so a test can read it violates the single-source rule and leaves a raw button primitive in dead code.

## Impact Search

| Search | Result |
| --- | --- |
| `rg -n -F "<TopBar" packages/overlay/src packages/overlay/test` | No matches. |
| `rg -n -F "TopBar" packages/overlay/src packages/overlay/test` | Only `TopBar.tsx` definition and `host-transport-capabilities.test.ts` source read. |
| `rg -n -F "top-bar" packages/overlay/src packages/overlay/test` | Only classes inside `TopBar.tsx`; no CSS owner or mount. |
| `rg -n "visible native-command controls|HostTransport capability test" specs/new-arch packages/overlay/test -S` | Existing consensus requires real visible controls, not retired test doubles. |

## Fix Plan

1. Delete `packages/overlay/src/components/TopBar.tsx`.
2. Remove `TopBar.tsx` source-string assertions from `host-transport-capabilities.test.ts`.
3. Add a focused source absence guard proving `TopBar` and `top-bar` do not remain in overlay production source.
4. Keep HostTransport capability assertions on real mounted controls.

## Verification

- `bun test packages/overlay/test/host-transport-capabilities.test.ts packages/overlay/test/mission-html-entry.test.ts packages/overlay/test/mission-launcher-component.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Browser visual smoke on the real overlay Mission/workspace chrome to confirm no layout gap is introduced by deleting the unmounted component.
