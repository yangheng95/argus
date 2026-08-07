# Mission Skill Panel Spacing Repair

## Recall

### User request

- Restore the visibly obscured border around the Mission-only information state.
- Relieve the crowded lower master-detail region.
- Add bottom spacing for both the inner master-detail frame and the outer panel boundary.
- User correction after the first implementation: the one-pixel panel inset did not restore the border, and bottom-only padding did not create spacing between the lower content and an outer frame.

### Acceptance criteria

- The information-state border is fully visible on both horizontal edges in the desktop Settings surface.
- The Mission Skill list and detail surfaces no longer meet the lower group boundary without breathing room.
- The complete Mission Skill panel retains a separate lower inset at the end of its scroll content.
- The change remains local to the Mission Skill Settings tab and does not alter shared Settings primitives.
- The real desktop page is opened and visually reviewed from a current screenshot; no User Interface automation test is added, changed, or run.

### Hard constraints

- Preserve the shared `SettingsState`, `SettingsGroup`, and `SettingsSurface` contracts.
- Use existing spacing and border tokens; do not hard-code a second layout scale.
- Do not restart or refresh the running OpenCorvus or Overlay process; use an isolated preview.
- Preserve unrelated working-tree changes.

### Existing material read

- `specs/records/2026-07/2026-07-23-mission-skill-settings-tab.md`
- `packages/overlay/src/components/settings/MissionSkillPanel.tsx`
- `packages/overlay/src/components/settings/layout.tsx`
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/styles/surfaces/settings.css`
- `packages/overlay/src/styles/surfaces/dialog.css`

### Whole-repository search inventory

| Surface                         | Search result and decision                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission Skill panel rendering   | `MissionSkillPanel.tsx` is the only renderer of `mission_skill.*` Settings content; preserve its structure.                                 |
| Mission Skill layout            | The `.mission-skill-*` family in `settings.css` is the only dedicated layout source; repair the panel and browser spacing there.            |
| Shared state and surface chrome | `layout.tsx` renders `.s-state` and `.s-surface`; both are shared by many Settings tabs and remain unchanged.                               |
| Dialog scroll boundary          | `.config-content` owns vertical scrolling and already supplies general page padding; do not change this shared owner.                       |
| User Interface tests            | No Mission Skill panel or `.mission-skill-*` layout assertion exists under `packages/overlay/test`; no User Interface test is added or run. |

### Independent review feedback

Claude Code 2.1.147 was invoked with read-only `Read,Grep,Glob` tools, but the installed client returned `Not logged in` with `is_error: true` before reviewing the repository. This external authentication blocker provides no review evidence and does not replace direct source inspection, build verification, or manual visual review.

## Root cause

The information state is rendered flush inside a group body even though the shared group already provides an explicit content-inset contract. More importantly, the catalog currently renders the toolbar and two bordered master-detail surfaces directly in the group body: there is no outer surface at all. A one-pixel panel inset cannot supply meaningful paint clearance, and bottom-only grid padding cannot create the requested outer-frame relationship because that frame does not exist.

## Implementation

1. Use the shared `SettingsGroup` content inset around the Mission-only state so all four border edges stay away from the group boundary.
2. Wrap the catalog toolbar, states, and master-detail grid in one real `SettingsSurface` outer frame.
3. Give that outer surface token-derived padding on all four sides so the list and detail frames keep a consistent inset from it.
4. Retain the panel's larger final bottom inset for the end of the scroll content.
5. Verify the Overlay typecheck and production build.
6. Open an isolated desktop page, inspect a current screenshot, and correct any remaining border or spacing defect.

## Verification

- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Isolated desktop preview and current screenshot reviewed manually.
- Final diff review and required legacy remote commit/push.

## Delivery evidence

- Overlay typecheck passed.
- Overlay production build passed with only the existing large-chunk warnings.
- Historical document link health passed: 2 tests, 0 failures.
- Task `tsk_fc69563a5001T8TH2zO8pbhiIm` published a real `BrowserPreviewTarget` for the isolated Vite service, but repeated scheduler wakes produced no navigation screenshot or visual report. The Task was cancelled after its terminal stop settled so the preview lease would not remain active.
- Consequently, the post-change manual screenshot criterion remains unverified in this delivery; service readiness is not treated as visual acceptance.
- After the user rejected the first spacing change, commit `71df8b98d3` replaced the ineffective one-pixel inset and bottom-only padding with the shared group content inset plus a real padded outer catalog surface. Overlay typecheck, production build, and document-link health passed again.
- The second read-only visual Task `tsk_fc765be5f001xgfPiTPNdvZXmX` produced Research and implementation-plan evidence, but repeated Developer continuations never created a `BrowserPreviewTarget`, screenshot, or visual report. It was cancelled terminally; the corrected structure therefore remains blocked on post-change manual screenshot evidence.
