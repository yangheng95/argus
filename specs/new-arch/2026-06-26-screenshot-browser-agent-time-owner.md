# 2026-06-26 Screenshot Browser Agent Time Owner

## Goal

Right-toolbar screenshot browsing must group screenshots by the concrete agent
turn that produced the image, not only by the normalized agent role. A long
build phase must not absorb every screenshot under one broad `build` group.
Screenshots produced by low-level agent tool output, including Browser MCP
`observe`/`screenshot`, browser metadata screenshots, `webpage_*` multimodal
attachments, and ordinary image file parts, must flow through the same
collector and cache path.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate screenshot source, inspect landed plans before edits, test every code change, visually verify UI-adjacent changes. |
| `2026-06-14-right-toolbar-screenshot-browser.md` | Screenshot panel derives from transcript/card-tree image-bearing parts only; no new image history store, live-frame recorder, iframe, base64 archive, or browser-preview-only source. |
| `2026-06-22-screenshot-browser-card-tree-cache.md` | Per-card `subtreeScreenshotItems` is the canonical subtree aggregate maintained by `card-tree-stats.ts`. |
| `2026-06-22-screenshot-browser-top-level-index.md` | `cardTreeStore.screenshotItems` is the panel's single top-level source; the panel must not scan `order` or `cards`. |
| `2026-06-23-screenshot-top-level-incremental-index.md` | Top-level screenshot cache updates stay incremental and bounded; no full-root merge path. |
| `task-message-protocol-bridge.ts` | `channel` from persisted `session.kind` is the authoritative agent routing source; `info.agent` must not override it. |

## Call Point Inventory

| Surface | Current behavior | Repair |
| --- | --- | --- |
| `packages/overlay/src/utils/screenshot-browser.ts` | `ScreenshotBrowserItem` stores `role` only; `groupScreenshotBrowserItems()` groups by role. Phase-absorbed build cards therefore collapse multiple image-producing turns under one build group. | Add one owner derivation in this collector: `ownerKey`, `ownerRole`, `ownerSessionID`, `ownerMessageID`, and `ownerTime`. `ownerKey` must be the structured role/session/message/time turn identity, never a role-only key. Keep file/tool/browser evidence extraction here as the only source. |
| Phase card boundaries in `tree-writer.ts` | Phase cards include boundary parts with `messageID`, `role`, and `time`; regular cards use card `sessionID/messageID/time`. | Use boundary metadata when present so phase-absorbed screenshots inherit the producing message turn's role/time instead of the phase card's broad role/time. |
| Browser/MCP observe images | `materializeMcpToolResult()` stores image content as tool attachments and browser metadata; screenshot browser already listens to tool attachments and metadata browser screenshot refs. | Keep this path; tests must prove Browser observe remains collected through the same owner-aware collector. |
| `packages/overlay/src/components/ScreenshotBrowserPanel.tsx` | Headers render one group per role. | Render one group per owner key, labeled as `roleLabel(ownerRole) · timestamp`, with owner metadata only from `ScreenshotBrowserItem`. |
| `packages/overlay/src/store/card-tree-stats.ts` | Equality checks ignore owner fields because they do not exist. | Include owner fields in cache equality so owner/time restamps update subtree and top-level caches. |
| Tests | Existing tests assert grouping by `["visual-qa", "build"]`. | Replace with agent-turn grouping assertions and add a same-build-role/two-message regression. |

## Fix Shape

1. Extend screenshot item identity with owner fields. `role` remains as the
   canonical owner role for existing color/role consumers, but grouping moves
   to `ownerKey`. The key shape is
   `role:session:<sessionID>:message:<messageID>:time:<timestamp>` when all
   fields are present; if `messageID` is unavailable the timestamp segment is
   still required so the collector does not silently collapse a role bucket.
2. Derive owner from the lowest available message evidence:
   - phase boundary matching the part `messageID`;
   - otherwise persisted message/card info;
   - tool/file part `sessionID` and `messageID` for identity.
3. Keep the display list bounded by the existing `SCREENSHOT_BROWSER_ITEM_LIMIT`
   and keep top-level cache updates in `card-tree-stats.ts`.
4. Do not add a backend screenshot table, overlay local storage, browser
   preview secondary source, or panel-local cache.

## Verification Plan

```bash
bun test packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts --timeout 30000
bun run --cwd packages/overlay typecheck
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts
```

Visual review must inspect the screenshot-browser browser test output under
`.scratch/` before the change is considered complete.
