# Screenshot Browser Agent Goal Owner

Date: 2026-06-29

## Task Definition

The right-toolbar screenshot browser must aggregate screenshots produced by the
same agent owner. A goal-scoped build agent must be represented by the existing
goal revision label, for example `#G1V1`, rather than by independent message
turn headers.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback or duplicate screenshot source; inspect landed plans before edits; test every code change; visually verify screenshot browser UI changes. |
| `2026-06-26-screenshot-browser-agent-time-owner.md` | Screenshot browser owner fields live in `utils/screenshot-browser.ts`; card-tree `subtreeScreenshotItems` remains the canonical cached source; boundary parts are still the lowest message evidence inside phase cards. |
| `2026-06-28-screenshot-browser-stable-thumbnail-size.md` | Keep fixed thumbnail/card geometry, virtualization, lazy loading, and stored attachment thumbnail variants unchanged. |
| `utils/goal-label.ts` | `#GxVy` is the existing UI label source through `goalRevisionLabel`; do not introduce a parallel goal label format. |

## Call Point Inventory

| Area | Current behavior | Repair |
| --- | --- | --- |
| `packages/overlay/src/utils/screenshot-browser.ts` | `ownerKey` includes `messageID` and timestamp, so one session's screenshots split into one group per turn. Card-derived messages also do not expose goal revision fields. | Derive one owner scope per item: goal revision when `goalID + round + attempt` exist, otherwise session, otherwise message/time identity. Add an owner label so goal build groups render as `#GxVy`. |
| Phase boundaries in `utils/screenshot-browser.ts` | Boundary parts intentionally restamp role/message/time, but their owner scope is still turn-shaped. | Keep boundary role/time for item evidence while inheriting the card/message owner scope so phase screenshots from the same goal build owner aggregate. |
| `packages/overlay/src/services/tree-writer.ts` | Step cards get `goalID/round/attempt`; phase cards can be created by live stubs or board rebuilds without the same goal owner metadata. | Stamp `goalID`, `goalDescription`, `round`, and `attempt` onto goal phase cards through both creation paths. Board rebuild overlays the authoritative revision metadata without clobbering phase parts. |
| `packages/overlay/src/components/ScreenshotBrowserPanel.tsx` | Group header label is always role label plus time. | Prefer the owner label supplied by the screenshot item/group; keep role label for non-goal agent owners. |
| `packages/overlay/src/store/card-tree-stats.ts` | Screenshot cache equality only checks existing owner fields. | Include the owner label in equality so goal revision label changes invalidate cached screenshot items. |
| Tests | Existing tests assert the old turn split. | Replace with same-agent aggregation assertions, add goal build `#GxVy` assertions, and keep browser screenshot review coverage. |

## Acceptance

- Same session/agent screenshots from multiple messages appear under one group.
- Goal-scoped build screenshots from a goal phase appear under the existing
  `#GxVy` label, using `goalRevisionLabel`.
- Different goal revisions and different sessions do not merge.
- The screenshot browser still reads from `cardTreeStore.screenshotItems` only.
- Focused unit tests, tree-writer metadata coverage, browser runner, and visual
  screenshot review pass.
