# Overlay Workbench Resizable Panels - 2026-06-07

## Evidence

Full-repo grep before implementation, revised on 2026-06-17 after the separator accessibility follow-up:

- `packages/overlay/src/main.tsx` owns `RIGHT_ACTIVITIES`, `centerWorkbenchPanels`, and the DOM mapping for `centerWorkbenchWorkflow`, `centerWorkbenchExplorer`, `centerWorkbenchDiff`, `centerWorkbenchBrowser`, `centerWorkbenchInspector`, `centerWorkbenchNotifications`, and `centerWorkbenchFile`.
- `packages/overlay/src/index.html` owns real `centerWorkbenchSeparator*` elements between adjacent workbench peers. The hidden legacy outer center workbench resizer was removed; panel separators are the only draggable boundary source.
- `packages/overlay/src/styles/surfaces/workspace.css` owns `.center-workbench-body`, `.center-workbench-view`, and `.center-workbench-panel-separator`.
- `packages/overlay/src/store/settings.ts` and `packages/overlay/src/services/overlay-settings-storage.ts` keep `centerWorkbenchPanelWeights` as the only persisted center workbench panel dimension source.
- `packages/overlay/src/components/Icon.tsx` is the single overlay icon registry. Toolbar callers should not import icons directly or use unrelated glyphs as substitutes.
- `packages/overlay/test/acceptance-panel-mount.test.ts`, `packages/overlay/test/side-activity-toolbar-browser.test.ts`, and `packages/overlay/test/pane-config.test.ts` pin the workbench panel contract.

## Target

The center workbench panels are independent peer panels. Opening Inspector, Notifications, Explorer, Files, Browser, or Workflow adds/removes that panel inside the shared center workbench. The panel order is the DOM order, not the click order. Adjacent visible panels expose a narrow draggable boundary that adjusts only that pair's relative width.

Panel widths persist as `centerWorkbenchPanelWeights` in the existing settings source. This is a weight map, not pixel widths, so the layout remains proportional across viewport changes.

Toolbar icons are semantic:

| Activity      | Icon            |
| ------------- | --------------- |
| Workflow      | `workflow`      |
| Inspector     | `panel-right`   |
| Notifications | `notifications` |
| Explorer      | `folder`        |
| Files/Diff    | `files`         |
| Browser       | `web-search`    |
| Assistant     | `message`       |

## Tests

- Static mount tests assert the right activity metadata uses semantic icons and no tab strip is restored.
- Settings tests assert `centerWorkbenchPanelWeights` is declared, sanitized, serialized, and loaded through the same settings source.
- Playwright test opens Workflow + Inspector, drags their shared boundary, and asserts the widths diverge before continuing the rest of the toolbar workflow.
