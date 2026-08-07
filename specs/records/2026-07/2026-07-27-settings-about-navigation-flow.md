# Settings About Navigation Flow

Date: 2026-07-27

UI means User Interface. CSS means Cascading Style Sheets.

## Problem

The Settings sidebar renders About after the ordinary navigation groups, but a
dedicated CSS rule gives that tab `margin-top: auto`. The vertical Tabs list
therefore consumes every remaining pixel before About and pins it to the bottom
edge of the sidebar. As the settings catalog grows, About appears detached from
the menu canvas instead of continuing the navigation sequence after Archive.

## Recall

| Source                                                               | Relevant constraint                                                                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User screenshot and request                                          | About must remain inside the visible Settings navigation flow rather than being pushed to the bottom edge.                                                  |
| `AGENTS.md`                                                          | Preserve concurrent work, add a regression test, use a real rendered page and screenshot for frontend acceptance, and avoid restarting the running Overlay. |
| `specs/records/2026-06/2026-06-18-settings-dialog-tabs-primitive.md` | Kobalte Tabs owns Settings navigation semantics; About is a real tab and the retired spacer element must not return.                                        |
| `packages/overlay/src/components/ConfigDialogHost.tsx`               | About is rendered once, after the filtered grouped tabs, so DOM order already expresses the intended sequence.                                              |
| `packages/overlay/src/styles/surfaces/settings.css`                  | `.config-sidebar .oc-tab[data-config-tab="about"] { margin-top: auto; }` is the only production rule that detaches About from the preceding Archive row.    |
| Independent agent feedback                                           | Not requested by the user; no sub-agent was started.                                                                                                        |

## Impact Sweep

| Whole-repository search                                                                                               | Result                                                                                                                            | Decision                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `rg -n "ABOUT_CONFIG_TAB\|visibleConfigGroups\|visibleConfigTabIDs" packages/overlay/src packages/overlay/test specs` | One runtime owner builds and filters the About tab; search behavior depends on keeping the standalone tab rendering.              | Preserve the component and filtering source.                               |
| `rg -n "data-config-tab=\"about\"\|margin-top:\s*auto" packages/overlay/src packages/overlay/test specs`              | The Settings CSS rule is the only About-specific auto margin; the other auto margin belongs to an unrelated conversation surface. | Delete only the Settings About auto margin.                                |
| `rg -n "config-nav-spacer\|config-nav-item" packages/overlay/src packages/overlay/test specs`                         | Existing tests intentionally reject the retired spacer and hand-written navigation row.                                           | Do not restore either legacy path.                                         |
| `rg -n "config-dialog-resizer" packages/overlay/test/browser packages/overlay/test`                                   | The existing Node-launched browser test already opens the real Vite-built Settings dialog and captures its navigation.            | Extend this test with About/Archive geometry and a task-scoped screenshot. |

## Fix Plan

1. Remove the About-only auto margin so DOM order remains the single layout
   source and About follows Archive in the same vertical flow.
2. Add a source regression that rejects a future About-specific auto margin.
3. Extend the real browser test to prove About is directly adjacent to Archive,
   stays within the tablist/sidebar bounds at the reference desktop height, and
   capture the repaired sidebar. Shorter viewports continue to use the existing
   sidebar scroll container rather than compressing every navigation row.
4. Run focused unit, browser, build/type, and documentation-health checks, then
   visually inspect the new screenshot.

## Acceptance

- About follows Archive without a viewport-sized spacer.
- About remains within the Settings tablist and the reference-height sidebar;
  shorter desktop windows retain normal sidebar scrolling.
- Search filtering still finds About and selects its real panel.
- No spacer element, duplicate menu source, or fallback layout is introduced.
- A real rendered screenshot shows the repaired menu flow.
