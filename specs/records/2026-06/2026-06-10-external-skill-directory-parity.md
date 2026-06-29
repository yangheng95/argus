# External Skill Directory Parity

## Problem

`Skill.state` scans external skill roots from `~/.claude/skills` / `<project>/.claude/skills` and `~/.agents/skills` / `<project>/.agents/skills`, plus `.opencorvus/{skill,skills}`. Codex skills live under `.codex/skills`, but `.codex` was not in the external root list. The follow-up OverlayUI reproduction also showed `.opencorvus/skills` being treated differently from the other agent-style `skills/` roots even though the panel must load all four roots uniformly.

## Call Points

| Area                            | File                                                         | Decision                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External discovery roots        | `packages/opencorvus/src/skill/skill.ts`                     | Keep one external root list for `.claude`, `.agents`, `.codex`, and `.opencorvus`; the pattern only scans `skills/**/SKILL.md`, not `.opencorvus/runtime`.                                              |
| Installed source classification | `packages/opencorvus/src/skill/manager.ts`                   | Treat `.codex/skills` and `.opencorvus/skills` paths as `external`, same as `.claude` and `.agents`; keep native `.opencorvus/skill` local.                                                             |
| Trust classification            | `packages/opencorvus/src/skill/manager.ts`                   | Treat `.codex/skills` and `.opencorvus/skills` paths as `external`, same as `.claude` and `.agents`; keep native `.opencorvus/skill` local.                                                             |
| Discovery tests                 | `packages/opencorvus/test/skill/skill.test.ts`               | Add project and global `.codex/skills` coverage, include `.codex` and `.opencorvus/skills` in mixed-root coverage, and prove duplicate scans of `.opencorvus/skills` do not create duplicate locations. |
| Route tests                     | `packages/opencorvus/test/server/skill-routes.test.ts`       | Lock `/skill/installed` classification for `.codex/skills` and `.opencorvus/skills`.                                                                                                                    |
| OverlayUI bundle test           | `packages/opencorvus/test/server/overlay-ui-handler.test.ts` | Serve the built `/ui` bundle and assert it contains Skill/MCP/Memory panel API paths, directory header injection, duplicate metadata, and no-directory notice strings.                                  |

## Supported Layouts

- Project: `<project>/.claude/skills/<skill>/SKILL.md`
- Project: `<project>/.agents/skills/<skill>/SKILL.md`
- Project: `<project>/.codex/skills/<skill>/SKILL.md`
- Project: `<project>/.opencorvus/skill/<skill>/SKILL.md`
- Project: `<project>/.opencorvus/skills/<skill>/SKILL.md`
- Global: `~/.claude/skills/<skill>/SKILL.md`
- Global: `~/.agents/skills/<skill>/SKILL.md`
- Global: `~/.codex/skills/<skill>/SKILL.md`
- Global: `~/.opencorvus/skills/<skill>/SKILL.md`

Discovery still requires the active project directory because skill loading is instance-scoped.
