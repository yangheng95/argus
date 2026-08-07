# Mission Gemini-like icon

## Recall

| Item | Evidence |
| --- | --- |
| User request | Replace the Mission icon with an icon similar to Gemini. |
| Acceptance | Mission renders as a restrained four-point sparkle-family glyph in the real desktop Vite surface; Mission uses one semantic icon across the Work Ledger, archived rows, and Mission avatars; existing Chat and Task icons remain unchanged. |
| Hard constraints | Reuse the mature repository Icon/Lucide toolchain; do not add a bitmap, branded asset, fallback, second icon registry, temporary iframe, or local-only preview signal; preserve all parallel worktree changes; run Playwright with Node. |
| Read records | `AGENTS.md`; `specs/current/architecture/07-panel.md`; the existing shared `Icon` registry, Work Ledger kind projection, archived Work Ledger projection, Avatar role projection, and browser fixture. |
| Full-repository grep | `WorkLedger.tsx::kindIcon` was the active Mission row source and returned `goals`; the New Mission launcher also used `goals`; the Composer Mission intent used `workflow`; `ArchivePanel.tsx::kindIcon` and `Avatar.tsx::AVATAR_ICON_BY_ROLE` already referenced the semantic `mission` icon; `Icon.lucide.ts` mapped that semantic icon to `Rocket`. Tests asserted the divergent glyphs. |
| Independent agent feedback | Not requested by the user, so no sub-agent was started. |

## Decision

The shared `mission` icon remains the single semantic source and maps to Lucide
`Sparkles`, already present in the project icon dependency and visually close to
Gemini's sparkle silhouette without copying a branded asset. The active Work
Ledger must reference `mission` instead of the unrelated Goal `Target` icon.
Archived rows and Mission avatars then converge automatically through the same
registry entry.

## Call-point disposition

| Call point | Disposition |
| --- | --- |
| `components/ui/Icon.lucide.ts` | Replace the Mission `Rocket` component with `Sparkles`; remove the unused `Rocket` import. |
| `components/WorkLedger.tsx::kindIcon` and New Mission launcher | Replace both Mission `goals` aliases with the semantic `mission` name. |
| `components/ChatComposer.tsx` Mission intent | Replace the generic workflow glyph with the semantic `mission` name. |
| `components/settings/ArchivePanel.tsx::kindIcon` | Keep unchanged; it already consumes `mission`. |
| `components/Avatar.tsx::AVATAR_ICON_BY_ROLE` | Keep unchanged; it already consumes `mission`. |
| `test/focused-popup-surface.test.ts` | Assert the canonical registry mapping and Work Ledger semantic name. |
| `test/work-ledger-consolidation.test.ts` | Assert Mission no longer aliases the Goal icon. |
| `test/browser/work-ledger-conversation-row-browser.test.ts` | Assert the real rendered Mission SVG is Lucide Sparkles while Chat and Task remain unchanged; capture the Vite surface for visual review. |

## Verification

- Targeted Bun source tests for the icon registry and Work Ledger projection.
- Node-launched Playwright browser fixture with a real Vite server.
- Inspect the task-scoped Work Ledger screenshot and iterate if the icon is
  visually noisy, misaligned, or indistinguishable from adjacent entities.
