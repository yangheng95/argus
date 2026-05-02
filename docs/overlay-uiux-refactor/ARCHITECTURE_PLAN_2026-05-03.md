# Overlay UI/UX Architecture Refactor - 2026-05-03

## Current Evidence

Measured on 2026-05-03:

| Area | Evidence | Impact |
| --- | --- | --- |
| Global CSS size | `packages/overlay/src/styles.css` 15,212 lines | One file owns layout, theme, component chrome, markdown, dialogs, and late overrides. |
| Card CSS size | `packages/overlay/src/styles/card.css` 2,022 lines | Conversation card styling has its own override history and fights `styles.css` theme selectors. |
| `!important` count | 380 across `styles.css` + `styles/card.css` | Cascade order is no longer trusted; changes require defensive overrides. |
| Bootstrap module size | `packages/overlay/src/main.tsx` 1,621 lines | Rendering roots, DOM wiring, settings effects, layout effects, debug hooks, and startup logic live together. |
| Imperative UI wiring | 142 matches in `main.tsx` for `render(` / `getElementById` / `addEventListener` / `window as any` | Panel ownership is unclear; mount points become hidden component APIs. |
| Tree writer size | `packages/overlay/src/services/tree-writer.ts` 1,905 lines | Conversation projection, event interpretation, and card-shape decisions are too coupled. |

## Biggest Problem

The largest problem is not visual taste. The largest problem is that UI semantics, layout structure, and visual language are all encoded in global CSS selectors and imperative mount wiring.

Concretely:

1. `styles.css` is a chronological patch log, not a design system. Many blocks document that previous "canonical" rules lied because later overrides won. That is the root reason every visual change becomes an override fight.
2. `main.tsx` is acting as the application shell, router, dependency injector, DOM adapter, settings synchronizer, debug surface, and component mount registry. That makes panel boundaries impossible to reason about.
3. Card visuals are tied to backend-ish implementation details such as `data-stage`, depth, and late theme selectors. The UI needs a small role vocabulary first, then components render from that role. Stage names should remain content/meta, not drive unbounded styling.
4. There is no automated architecture gate for UI code. The project currently relies on convention, but the existing `!important` and "folded canonical" comments prove convention is not enough.

## Target Architecture

### 1. App Shell Single Root

Replace the current multi-mount `main.tsx` pattern with one Solid root:

```tsx
render(() => <OverlayApp />, document.getElementById("root")!)
```

Target ownership:

| Module | Responsibility |
| --- | --- |
| `OverlayApp.tsx` | Top-level providers and shell composition only. |
| `layout/AppShell.tsx` | Three-column layout: left rail, center conversation, right workspace. |
| `layout/LeftRail.tsx` | Recent tasks, workspace directory, global task actions. |
| `conversation/ConversationPanel.tsx` | Conversation stream and composer. |
| `workspace/RightWorkspace.tsx` | Plan, evaluation, changes, preview tabs. |
| `bootstrap/install-global-handlers.ts` | Window-level shortcuts and explicit external bridge hooks only. |

`main.tsx` target size: under 180 lines.

### 2. CSS Cascade Layers

Split CSS into explicit layers. This is the core mechanism that prevents override drift:

```css
@layer reset, tokens, primitives, layout, features, utilities;
```

File layout:

```text
packages/overlay/src/ui/styles/
  index.css
  reset.css
  tokens.css
  themes.css
  primitives/
    button.css
    icon-button.css
    chip.css
    surface.css
    tabs.css
    scroll-area.css
  layout/
    app-shell.css
    left-rail.css
    conversation-panel.css
    right-workspace.css
  features/
    conversation-card.css
    composer.css
    task-list.css
    board.css
    changes.css
    preview.css
```

Rules:

1. `tokens.css` and `themes.css` are the only files allowed to define CSS custom properties.
2. `primitives/*` cannot select feature class names.
3. `features/*` can compose primitives but cannot redefine token values.
4. `utilities.css` must stay tiny and audited; no component chrome goes there.
5. `!important` is banned except for native `[hidden]` behavior, with a test-enforced allowlist.

### 3. Design Tokens

Keep one token family. Do not add parallel `--space-*` or `--fs-*` systems beside existing `--ui-*`.

Token groups:

| Group | Examples |
| --- | --- |
| Color | `--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-border-subtle`, `--color-text`, `--color-text-muted` |
| Status | `--status-info`, `--status-success`, `--status-warning`, `--status-danger` |
| Role | `--role-user`, `--role-agent`, `--role-tool`, `--role-system` |
| Spacing | existing `--ui-gap-*`, plus missing sizes only if needed |
| Type | existing `--ui-font-*` |
| Radius | `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-pill` |
| Shadow | `--shadow-raised`, `--shadow-float`, `--shadow-focus` |

No component should hardcode raw hex/rgb except inside token/theme files.

### 4. UI Primitives

Create a small primitive layer before redesigning feature panels:

| Primitive | Purpose |
| --- | --- |
| `Surface` | Shared bordered/elevated container with `tone` and `density`. |
| `IconButton` | All square icon controls. |
| `Button` | Text/icon command buttons. |
| `Chip` | Status/meta pills. |
| `Tabs` | Right workspace and settings tabs. |
| `ScrollArea` | Scrollbar, padding, overflow behavior. |
| `PanelHeader` | Title, actions, status line layout. |

Features should not hand-roll these shapes.

### 5. Conversation Model for UI

Introduce a UI-facing conversation projection separate from backend event details:

```ts
type ConversationItem =
  | UserMessageItem
  | AgentRunItem
  | ToolCallItem
  | SystemNoticeItem
  | InteractionRequestItem;
```

Each item exposes:

```ts
{
  id: string
  role: "user" | "agent" | "tool" | "system"
  status?: "pending" | "running" | "done" | "error"
  title: string
  meta: ConversationMeta[]
  parts: ConversationPart[]
  children: string[]
}
```

Backend `stage` remains visible as metadata, but styling consumes `role` and `status`, not arbitrary stage names.

### 6. Panel Boundaries

Right workspace target tabs:

| Tab | Owns |
| --- | --- |
| `Plan` | Agent workflow and goal plan. |
| `Evaluation` | Board, delivery evidence, interaction requests. |
| `Changes` | Files, diffs, changed file workspace. |
| `Preview` | Frontend preview. |

The center column owns only conversation and composer. It should not contain hidden workspace surfaces.

## Migration Plan

### Phase 0 - Architecture Gates

Add tests before moving code:

1. `styles.css` + `card.css` combined `!important` count must not increase.
2. New CSS files must be under 450 lines each.
3. Raw color literals are allowed only in token/theme files.
4. `main.tsx` may contain only one `render(` call after shell extraction.
5. `document.getElementById` is allowed only in bootstrap adapter files.

### Phase 1 - App Shell Extraction

1. Add `OverlayApp.tsx`.
2. Move existing mount points into JSX structure without changing behavior.
3. Keep current stores/services.
4. Delete equivalent imperative `render()` blocks from `main.tsx`.

Acceptance:

- One root render.
- Existing panels still mount.
- `main.tsx` becomes startup/bootstrap only.

### Phase 2 - Token and Layer Split

1. Create `ui/styles/index.css` with cascade layers.
2. Move tokens/theme definitions first.
3. Move only layout shell CSS next.
4. Keep old CSS imported temporarily only for unmigrated components, but each migrated selector must be deleted from old files in the same change.

Acceptance:

- No duplicate selector ownership for migrated modules.
- No new `!important`.

### Phase 3 - Primitive Components

Implement `Surface`, `IconButton`, `Button`, `Chip`, `Tabs`, `ScrollArea`, `PanelHeader`.

Acceptance:

- New feature work uses primitives only.
- Existing panels are migrated module by module.

### Phase 4 - Conversation Refactor

1. Split `Card.tsx` into `ConversationItemView`, `MessageCard`, `AgentRunCard`, `ToolCallCard`, `SystemNoticeCard`.
2. Split `CardHeader.tsx` into `ConversationHeader`, `CardActions`, `MetaRow`.
3. Move conversation styles to `features/conversation-card.css`.
4. Delete corresponding blocks from `styles/card.css`.

Acceptance:

- Conversation card styling no longer depends on global late theme overrides.
- `data-stage` no longer drives visual palette.

### Phase 5 - Right Workspace Refactor

1. Move hidden chat workspace into `RightWorkspace`.
2. Replace `workflow / inspector / preview` with `plan / evaluation / changes / preview`.
3. Delete center-column workspace toggle and horizontal workspace resizer.

Acceptance:

- Center column contains only conversation stream and composer.
- Right column owns all non-conversation work surfaces.

### Phase 6 - Delete the God CSS Files

After all migrated selectors are removed:

1. Delete `styles.css`.
2. Delete `styles/card.css`.
3. Keep only layered `ui/styles/index.css` imports.

Acceptance:

- No import of legacy CSS files.
- Architecture tests pass.
- Visual benchmark covers light, dark, and VS Code dark.

## Non-Negotiables

1. No compatibility theme branch or legacy selector fallback.
2. Every migrated component deletes its old CSS in the same change.
3. No feature component writes raw colors, raw shadows, or ad hoc button/chip/card chrome.
4. No hidden workspace surface inside the conversation column.
5. No panel-level imperative mount registry in `main.tsx`.
6. No broad "cleanup" commit. Each phase must have a measurable boundary and tests.
