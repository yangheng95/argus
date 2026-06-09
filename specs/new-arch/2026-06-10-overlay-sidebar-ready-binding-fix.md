# Overlay Sidebar Ready Binding Fix

Date: 2026-06-10

## Problem

The overlay sidebar buttons for new task and Mission were wired inside a
`DOMContentLoaded` listener in `packages/overlay/src/main.tsx`.

`main.tsx` performs top-level async locale loading before that listener is
registered. When the document has already fired `DOMContentLoaded`, the callback
never runs. The visible result is systemic:

| Control | Expected | Broken behavior |
| --- | --- | --- |
| `#btnCreateTask` | Deselect task, clear messages, focus composer | Click does nothing, so old messages stay mounted |
| `#btnMission` | Toggle Mission page | Click does nothing |

## Call-Point Inventory

Full-repo search:

```text
rg -n -F "DOMContentLoaded" packages/overlay/src packages/opencorvus/src packages/overlay/test
rg -n -F "btnCreateTask" packages/overlay/src packages/overlay/test
rg -n -F "btnMission" packages/overlay/src packages/overlay/test
```

Results:

| Surface | File | Action |
| --- | --- | --- |
| Overlay sidebar button binding | `packages/overlay/src/main.tsx` | Replace late bare `DOMContentLoaded` listener with ready-aware initializer |
| Mission entry structural test | `packages/overlay/test/mission-html-entry.test.ts` | Assert binding uses the ready helper and still clears task state before focusing |
| Browser MCP script helper | `packages/opencorvus/src/mcp/browser/scripts.ts` | No change; it already uses `document.readyState === "loading" ? ... : attach()` |

No other overlay static button uses `DOMContentLoaded`.

## Fix

Create a small local `onDocumentReady()` helper in `main.tsx`:

```text
if document.readyState === "loading": add one-shot DOMContentLoaded listener
else: run immediately
```

Use it for the sidebar static controls. This is not a gate or fallback; it is
the browser document readiness contract for binding static DOM controls.

## Tests

Update the existing mission HTML entry test to require:

1. `onDocumentReady` reads `document.readyState`.
2. The loading branch registers `DOMContentLoaded` with `{ once: true }`.
3. The ready branch invokes the initializer immediately.
4. `btnCreateTask` still calls `setPageMode("panel")` before `selectTask("")`.
5. `btnMission` still toggles `pageMode`.

## Acceptance

- Clicking New Task works after async module startup and clears the active
  conversation through `selectTask("")`.
- Clicking Mission works after async module startup.
- A future edit cannot reintroduce a bare late `DOMContentLoaded` listener for
  these controls without failing the targeted test.
