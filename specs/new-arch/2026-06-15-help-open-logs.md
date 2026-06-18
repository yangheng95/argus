# Help Open Logs

Date: 2026-06-15

## Requirement

Users need an obvious way to open runtime logs from the Help menu because failures are currently hard to diagnose from the main UI.

## Grep Evidence

| Surface          | Evidence                                                                                                                                 | Decision                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Help menu        | `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` renders Help entries for docs, SDK, DevTools, and About only.             | Add a Help Logs item in the same menu group.                                                         |
| Log viewer entry | `packages/overlay/src/main.tsx` owns `logOpen` and listens for `oc:open-logs`. `CommandPalette.tsx` already dispatches that event.       | Reuse `oc:open-logs` as the single UI event path; do not add another log state or fetch path.        |
| Log storage      | `specs/new-arch/2026-06-04-unified-log-storage-http-api.md` records `/log`, `/log/files`, and `/log/tail` as the unified server log API. | Do not add another API route for this UI change.                                                     |
| Existing guard   | `packages/overlay/test/browser/titlebar-menubar.test.ts` currently asserts Help does not contain `titlebar-help-logs`.                   | Update the browser-backed Help contract to assert the Logs item exists and opens `#logDialog`.       |
| i18n             | `cmdk.open_logs` exists, but `titlebar.logs` / `titlebar.logs_hint` are absent.                                                          | Add Help-specific labels in both locale files.                                                       |
| Visual review    | Screenshot review of `#logDialog` showed the virtual log list collapsed to a thin empty strip even though DOM text existed.              | Give `.log-viewer` a stable responsive height; a max-height-only virtual scroller is not acceptable. |

## Implementation

1. Add `openLogs()` in `TitlebarMenubar.tsx` that dispatches the existing `oc:open-logs` event and closes the Help menu.
2. Insert the Logs item in Help after SDK so documentation stays first and diagnostics remain adjacent.
3. Add `titlebar.logs` and `titlebar.logs_hint` to `en-US.json` and `zh-CN.json`.
4. Update the Playwright-backed titlebar test to verify the new Help contract and click the item until `#logDialog` is visible.
5. Fix the LogViewer list height so opened logs are readable, not just technically mounted.

## Verification

- `bun test packages/overlay/test/documentation-service.test.ts`
- `bun test packages/overlay/test/log-viewer-primitive.test.ts`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/titlebar-menubar.test.ts`
- Browser screenshot review of Help menu and opened Logs dialog.
