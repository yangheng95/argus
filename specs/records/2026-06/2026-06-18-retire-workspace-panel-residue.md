# Retire Workspace Panel Residue

Date: 2026-06-18

## Problem

The old `WorkspacePanel` surface was no longer mounted in the production overlay, but it still kept a second diff shell alive in source and tests:

- `WorkspacePanel.tsx` rendered `.workspace`, `.workspace-header`, `.workspace-tabs`, `.workspace-tab*`, `.workspace-body`, `.workspace-view`, and `.workspace-close`.
- `workspace.css` still owned chrome for the retired shell.
- `FileChangesPanel` was the actual mounted diff owner, but its close affordance reused the retired `.workspace-close` class instead of the shared `Button` primitive.

This was a double-source risk: the current diff surface lived in `FileChangesPanel`, while an unmounted component and stale style contract kept asserting an obsolete shell.

## Recall

Checked existing records before editing:

- `2026-06-07-overlay-center-tab-workbench.md`: diff moves to `FileChangesPanel` as the center tab single source.
- `2026-06-11-center-workbench-header-alignment.md`: `FileChangesPanel` uses `SurfaceHeader`, with tabs in header actions.
- `2026-06-11-mission-left-activity-retire-panel.md`: Mission no longer renders a second workspace panel.
- `2026-06-01-overlay-file-explorer-editor.md`: older file editor plan still mentioned `WorkspacePanel`, but it is superseded by the center workbench plan and current mount chain.

Independent read-only agents confirmed the same ownership split:

- Current production mount is `#solidFileChangesMount` in `index.html`, rendered from `main.tsx` into `FileChangesPanel`.
- No production source imports or mounts `WorkspacePanel`.
- `.workspace-main`, `.conversation-workspace`, `.center-workbench*`, `.pane-resizer*`, `.file-editor*`, `.diff-preview*`, `code .file-link`, `workspace-onboarding*`, and launcher classes remain live and must stay.

## Full Grep

Before writing this note, the workspace-family grep covered:

```text
WorkspacePanel|workspace-mount|workspace-header|workspace-tabs|workspace-tab|workspace-tab-label|workspace-tab-file|workspace-close|workspace-view|workspace-body
```

Scope:

```text
packages/overlay/src
packages/overlay/test
specs/new-arch
```

Production findings:

- Retired shell classes had no remaining production owner after deleting `WorkspacePanel.tsx`.
- Remaining `workspace-*` production classes are unrelated live surfaces such as workspace command launchers, onboarding, center workbench layout, and editor launchers.

Test and history findings:

- Tests now assert the retired shell selectors stay absent instead of preserving them.
- Old dated specs still mention `WorkspacePanel`; they are historical references and are superseded by the center workbench records listed above.

## Decision

Delete `WorkspacePanel.tsx` and remove the retired workspace shell rules from `workspace.css`.

Move the live diff close affordance in `FileChangesPanel` to the `Button` primitive:

- `variant="ghost"`
- `size="icon"`
- `tone="neutral"`
- `data-ui="file-changes-diff-close"`

Keep the local danger hover tint in `activity.css`, scoped to the current file changes diff header and expressed through `--oc-button-*` primitive variables.

No fallback, compatibility layer, or parallel selector is introduced.

## Verification

Static tests:

- `bun test packages/overlay/test/workspace-surface-consistency.test.ts packages/overlay/test/tabs-primitive.test.ts packages/overlay/test/workspace-editor.test.ts packages/overlay/test/primitives-panel-section.test.ts`
- `bun test packages/overlay/test/file-explorer-editor.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `bun test packages/overlay/test/overlay-architecture-guards.test.ts -t "retired workspace|conversation auxiliary surfaces|workspace panel|diff preview"`
- `bun test packages/overlay/test/flat-redesign-border-policy.test.ts -t "workspace|file changes diff close"`
- `bun test packages/overlay/test/button-primitive.test.ts`

Visual verification is required because this touches the file changes diff surface. The browser check must open the real overlay, open the diff center workbench, capture a screenshot, and confirm:

- the diff list and preview remain visible;
- the close button renders as the shared button primitive;
- old `.workspace-mount`, `.workspace-header`, `.workspace-tabs`, `.workspace-tab`, and `.workspace-view` nodes are absent from the runtime document.
