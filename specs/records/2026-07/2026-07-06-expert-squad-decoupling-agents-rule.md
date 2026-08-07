# Expert Squad Decoupling AGENTS Rule

Date: 2026-07-06
Status: Implemented

Supersession note: `2026-07-06-expert-squad-namespaced-source-layout.md` supersedes this record's direct-child package path wording. Current non-`general` packages live under `.opencorvus/expert-squads/<namespace>/<id>/`, with `builtin/<id>` and `wujiang/opentest` as concrete source partitions. Manifest `id`, not namespace or directory name, remains the expert-squad identity.

## Recall

| Item | Details |
| --- | --- |
| User request | "把专家团解耦规则写道agents.md中". |
| Acceptance criteria | `AGENTS.md` must contain a hard expert-squad decoupling rule that preserves the current dynamic package architecture: non-general squads are project packages/payload-released packages, identity is manifest ID, active selection is `prompt_profile.active`, projection is through `PromptProfileResolver`, and global scheduler/core prompts must not absorb domain-specific expert-squad policy. |
| Hard constraints | No fallback/compatibility aliases; no second active expert-squad source; no gate/routing bypass; preserve existing dirty worktree changes; specs stay under `specs/`; update monthly README; validate docs links. |
| Sources read | `AGENTS.md`; `specs/current/architecture/04-extensions.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`; `specs/records/2026-07/2026-07-04-communication-protocol-expert-squad-systemic-repair.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`. |
| Repository search | `rg -n "expert-squad|expert squad|专家团|decoupl|解耦|prompt_profile|frontend-replica|mounted_agents|required_tools|selector" AGENTS.md specs/current specs/records/2026-07 -g "*.md" -g "*.txt"`; focused reads of `specs/current/architecture/04-extensions.md` lines 65-90 and relevant dated records. |
| Independent agent feedback | Not requested for this rule-library update. Prior dated records already include independent-agent findings that established package identity, active-selection, and projection single-source boundaries. |

## Implemented Rule

Add `15.1（专家团解耦边界 — 2026-07-06）` to `AGENTS.md` under project-specific constraints.

The rule captures:

- Non-general expert squads are `.opencorvus/expert-squads/<namespace>/<id>` packages or payloads released into that same project package path.
- `general` remains the only built-in runtime package unless the architecture is explicitly reopened.
- Manifest `id` is the only expert-squad identity.
- `prompt_profile.active` remains the only active expert-squad source.
- `PromptProfileResolver` owns runtime projection into scheduler, workers, skills, tools, MCP, and catalog/mount surfaces.
- Domain rules live in package README, selector, agent overlays, package skills/tools/MCP, not global core prompts or obsolete built-in skill files.
- Expert squads may project capabilities and overlays, but must not create a second workflow, dispatch, context-packet, or task-manipulation system.

## Verification

Run:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000
git diff --check -- AGENTS.md specs/records/2026-07/2026-07-06-expert-squad-decoupling-agents-rule.md specs/records/2026-07/README.md
```
