# Skill Panel Refresh Cache Invalidation

Date: 2026-06-25
Status: implementation plan

## User Report

Overlay panel skill refresh cannot load newly added skills.

## Recall

| Source                                                    | Constraint                                                                                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                               | No fallback, no double source, inspect existing plans before edits, test every code change.                                                                                      |
| `2026-06-10-overlay-skill-mcp-empty-directory-display.md` | Skill and MCP panel requests are project-scoped and must use the active directory explicitly.                                                                                    |
| `2026-06-23-agent-skill-mount-matrix.md`                  | `/skill/mounts` is the single overlay projection for the skill pool and agent matrix. `/skill/installed` must not race it for normal panel reloads.                              |
| Current overlay implementation                            | `SkillMarketPanel.refreshSkillMounts()` calls `loadSkillMountMatrix()`; `loadExtensions()` also uses `/skill/mounts` as the single skill projection.                             |
| Current backend implementation                            | `Skill.all()` is cached through `lazyInstanceState`; API writes such as import/remove/mount reset `Skill.state`, but a manual disk change is invisible until the cache is reset. |

## Call Points Checked

| Call point                         | Evidence                                                                              | Decision                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Overlay initial/project reload     | `packages/overlay/src/services/extensions.ts::loadExtensions()`                       | Keep normal load on `/skill/mounts` without forcing a rescan.                                             |
| Overlay skill panel refresh button | `packages/overlay/src/components/settings/SkillMarketPanel.tsx::handleReloadSkills()` | Manual refresh should request a backend rescan before reading `/skill/mounts`.                            |
| Overlay skill matrix loader        | `packages/overlay/src/services/extensions.ts::loadSkillMountMatrix()`                 | Extend the typed loader with an explicit `refresh` option; keep `/skill/mounts` as the single projection. |
| Backend matrix route               | `packages/opencorvus/src/server/routes/skill.ts`                                      | Accept `refresh=true` as an explicit query flag.                                                          |
| Backend matrix projection          | `packages/opencorvus/src/skill/mounts.ts::matrix()`                                   | When `refresh` is true, reset config and skill discovery state before computing the matrix.               |
| Skill install path                 | `packages/opencorvus/src/skill/manager.ts::install()`                                 | Reset skill discovery after path/url/git install so UI installs do not require a separate refresh.        |
| Existing installed route           | `/skill/installed`                                                                    | Keep as the partial-failure reconciliation route only; do not reintroduce it into normal panel reload.    |

## Root Cause

The refresh button only repeated the matrix request. The matrix request recomputed the projection from `SkillManager.installed()`, but `SkillManager.installed()` reads `Skill.all()`, and `Skill.all()` returns the cached instance discovery result. Manual `SKILL.md` additions on disk do not pass through `SkillManager.importFile()`, `Skill.writeMountedAgents()`, or `SkillManager.remove()`, so no existing mutation path invalidates that cache.

The install path has the same cache boundary: `SkillManager.install()` writes global skill sources but did not reset `Skill.state`, so installing after the skill list had already been loaded could still show the stale pool.

## Design

1. Add an explicit refresh option to the `/skill/mounts` query contract: `GET /skill/mounts?refresh=true`.
2. On that explicit flag, reset `Config.state` and `Skill.state`, then compute the same `/skill/mounts` matrix.
3. Make the overlay refresh button call `loadSkillMountMatrix({ refresh: true })`.
4. Keep automatic panel activation and project reloads as normal `/skill/mounts` reads to avoid turning every render into a disk rescan.
5. Reset `Skill.state` after successful path/url/git install so install actions update the pool immediately.

## Tests

- Backend route test: initialize `/skill/mounts`, write a new `.opencorvus/skill/.../SKILL.md` on disk, then assert `/skill/mounts?refresh=true` includes it.
- Backend route test: initialize skill cache, install a new path skill, then assert `/skill/mounts` includes it without a second refresh.
- Overlay service test: `loadSkillMountMatrix({ refresh: true })` sends `refresh=true` while preserving explicit directory injection.
- Overlay browser test: clicking the shared skill panel reload button sends `refresh=true`, renders a skill that appears only in the refreshed response, and the left compact skill panel reload button sends the same cache-invalidation query.
