# Skill expiry and duplicate surfacing

## Requirement

- `.agents`, `.codex`, `.claude`, and `.opencorvus` skill discovery must skip expired skills by time.
- The Skills panel must show when a loaded skill name is duplicated.
- The duplicate tooltip must list the duplicate locations.

## Existing call points checked

| Surface              | Grep evidence                                                                                                        | Decision                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Discovery source     | `packages/opencorvus/src/skill/skill.ts` owns `Skill.Info`, external scanning, `.opencorvus` scanning, `Skill.all()` | Add `expires_at` filtering and duplicate metadata at the discovery source.                             |
| Installed API        | `packages/opencorvus/src/skill/manager.ts` owns `SkillManager.Installed` and `/skill/installed` payload shaping      | Mirror new metadata in `Installed` so the overlay can use server evidence directly.                    |
| Routes               | `packages/opencorvus/src/server/routes/skill.ts` exposes `/skill` and `/skill/installed` schemas                     | No route split; schemas pick up the updated zod objects.                                               |
| Agent/tool consumers | `src/tool/skill.ts`, `src/session/system.ts`, `src/command/index.ts` consume `Skill.all()`                           | Expired skills disappear from every consumer through the single source. Duplicate metadata is passive. |
| Overlay data load    | `packages/overlay/src/services/extensions.ts` loads `skill/installed` into `appStore.skills`                         | No second fetch or client-side duplicate inference.                                                    |
| Skills panel         | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` renders `.extension-row` rows                        | Render a duplicate badge and use `title` for locations from `duplicate_locations`.                     |
| Locale checks        | `packages/overlay/src/i18n/*.json`, `packages/overlay/test/i18n-discipline-round2.test.ts`                           | Add matching locale keys in both catalogs.                                                             |

## Frontmatter contract

`expires_at` is an optional ISO-compatible timestamp in `SKILL.md` frontmatter. A skill is expired when `Date.parse(expires_at) <= Date.now()`. Missing `expires_at` means the skill does not expire.

## Tests

- Skill unit tests cover expired filtering and duplicate location metadata across discovered paths.
- Skill route tests cover `/skill/installed` duplicate metadata.
- Overlay unit tests cover badge rendering and tooltip source.
