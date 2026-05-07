# Overlay Workspace Onboarding Rebuild (2026-05-05)

## Problem Statement

The overlay no longer has a clear in-app workspace onboarding surface.

The historical regression chain is:

1. `04fc490d7` added `BoardIntro` as the right-panel empty-state explainer.
2. `b8d5b6e8e` added a high-contrast cold-start CTA when no working directory was set.
3. `bf4e0c8de` shifted cold start toward an immediate OS folder picker.
4. `9978c43ba` deleted `BoardIntro` entirely because the startup picker was considered sufficient.

That left the product with only two weak entrypoints:

- an automatic native picker with no surrounding explanation
- a workspace menu entry in the title bar

When the picker is dismissed, the user lands in a partially disabled shell with no durable professional onboarding surface.

## Target State

Reintroduce a first-class startup workspace onboarding window that:

1. appears whenever no working directory is selected
2. explains the two valid starting actions: open an existing local directory or create a new project folder
3. surfaces recent directories as direct recovery actions
4. looks like a deliberate product surface, not a fallback alert
5. replaces the automatic startup picker as the primary cold-start path

## Design Rules

- Use a modal dialog, not an inline empty state, so the cold-start action is explicit and blocking.
- Keep the copy operational and brief: what action to take, what folder shape is valid, what happens next.
- Use the existing dialog/button/icon primitives and current design tokens.
- Avoid reintroducing the old `BoardIntro` teaching wall; focus on workspace entry, not agent education.

## Implementation

### Phase 1: New Startup Dialog

Add a dedicated Solid component:

- `WorkspaceOnboardingDialog`

Behavior:

- open while `settingsStore.directory` is empty
- primary action: `browseDirectory()`
- secondary action: `createDirectory()`
- recent directory rows call `setDirectory(path)`

Files:

- `packages/overlay/src/components/WorkspaceOnboardingDialog.tsx`
- `packages/overlay/src/main.tsx`

### Phase 2: Visual Surface

Add a dedicated surface stylesheet for the modal body:

- action bands
- recent directory list
- concise status/tip copy

Files:

- `packages/overlay/src/styles/surfaces/workspace-onboarding.css`
- `packages/overlay/src/index.html`

### Phase 3: Copy + Tests

Add bilingual i18n keys and update tests to assert the new modal instead of the deleted BoardIntro surface.

Files:

- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- `packages/overlay/test/titlebar-menubar.test.ts`
- targeted source/behavior tests as needed

## Acceptance Criteria

This batch is complete only when:

1. cold start no longer auto-opens the native folder picker
2. the overlay shows a professional modal onboarding window when no workspace is selected
3. the modal offers open existing directory, create new project, and recent directory recovery
4. targeted overlay tests pass
