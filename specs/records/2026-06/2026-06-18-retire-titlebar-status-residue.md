# Retire Titlebar Status Residue

Date: 2026-06-18

## Problem

The current task status is rendered in the workflow chat header by `TaskStatusHeader`:

- production component: `packages/overlay/src/components/TaskStatusHeader.tsx`
- live status shell: `.chat-task-status`
- shared status glyph: `.status-icon[data-status]`

The old titlebar status family was no longer rendered by production source, but CSS and tests still preserved it:

- `.titlebar-status-chip`
- `.titlebar-setup-cta`
- `.titlebar-status-icon`
- `.titlebar-task-status`
- `.titlebar-status-label`
- `.titlebar-status-value`

Keeping those selectors made the titlebar look like it still owned task status chrome, while the actual runtime owner had moved to the chat header. That is a dead-code and double-source risk.

## Recall

Checked before editing:

- `2026-06-17-left-activity-header-semantics.md`: activity headers derive runtime semantics from active activity state, not static titlebar status chrome.
- `2026-06-11-center-workbench-header-alignment.md`: center workbench headers use explicit `SurfaceHeader` ownership; file/status content should be owned by its active panel.
- `2026-06-05-vscode-style-activity-toolbars.md`: historical toolbar migration; current titlebar menu and side activities supersede older right-tab/status assumptions.

Read-only agent audit also flagged this family as dead CSS/test residue, with `.status-icon` and Kobalte menu selectors explicitly out of deletion scope.

## Full Grep

Command family:

```text
titlebar-status-chip|titlebar-setup-cta|titlebar-status-icon|titlebar-task-status|titlebar-status-label|titlebar-status-value
```

Scope:

```text
packages/overlay/src
packages/overlay/test
specs
```

Findings:

- No production component renders the old titlebar status classes.
- `titlebar.css` was the only production CSS owner for those selectors.
- Browser and static tests were preserving the retired selectors by asserting they existed or including them in geometry scans.
- `.status-icon` remains live and must stay because `TaskStatusHeader` and Board status rows use it.
- Kobalte runtime selectors such as `.titlebar-theme-option[data-highlighted]` remain live and are not part of this cleanup.

## Decision

Delete the old titlebar status family from `titlebar.css`, including its responsive leftovers.

Keep the generic `.status-icon` rules in `titlebar.css` because they are shared by the current task status icon and use the existing `--oc-titlebar-status-icon` token. The chat header continues to override sizing through `.chat-task-status .status-icon`.

Update tests so the old titlebar status family is an absence contract:

- static architecture and flat-redesign tests assert retired selectors do not return;
- owner-surface checks keep current titlebar surface tokens and `.status-icon` coverage;
- browser titlebar geometry ignores retired status nodes and asserts they are absent at runtime.

No compatibility selector or hidden fallback is introduced.

## Verification

Required checks:

- targeted static tests for titlebar architecture and flat-redesign rules;
- browser titlebar menubar test with Node runner, including runtime absence of old status nodes;
- overlay typecheck and i18n check;
- docs check after adding this record;
- visual screenshot review of the titlebar and workflow chat header.
