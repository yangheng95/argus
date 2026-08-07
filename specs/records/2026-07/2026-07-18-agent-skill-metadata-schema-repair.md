# Agent Skill Metadata Schema Repair

Date: 2026-07-18
Status: Active repair record
Owner: Codex

> Superseded on 2026-07-20 for unknown frontmatter only: the current product contract ignores unsupported Skill
> fields through the canonical strip-unknown schemas. The same current record also supersedes strict rejection of
> non-string entries inside `metadata`: supported string entries are preserved and unsupported value shapes are
> omitted. See `2026-07-20-skill-unknown-frontmatter-ignore.md`.

## Recall

### User request

- Diagnose the Expert Squads Details failure shown for `C:/Users/chuan/myhexin-local/demos/economy/crypto-e2e-20260716-projection-fixed`.
- Repair the systemic Skill/MCP presentation failure and independently review the completed repair.

### Acceptance criteria

- The current Codex system Skills `skill-creator` and `skill-installer`, whose `SKILL.md` files contain standard `metadata.short-description`, load through the real global external-Skill discovery path.
- `GET /skill` and `GET /expert-squad/catalog` return 200 for the affected project through an isolated post-fix OpenCorvus process.
- `GET /mcp` remains independently healthy; the repair must not couple MCP server lifecycle to Skill parsing.
- Agent Skills descriptive frontmatter is preserved in `Skill.Info`, imports and HTTP output rather than accepted and silently stripped.
- The ordinary Skill frontmatter boundary remains strict: `agents`, `mounted_agents`, `arbitrary_unknown_key`, invalid metadata value types and the unsupported experimental `allowed-tools` field still fail through `SkillInvalidError`.
- Focused Skill, import and expert-squad route tests, documentation health, typecheck, API route inventory and generated-document checks pass; the exact diff receives a second review.

### Hard constraints

- Keep `Skill.Definition` as the only strict ordinary frontmatter schema. Do not add a parser fallback, skip invalid Skills, catch catalog failures, or maintain a second Codex-only schema.
- Preserve the Agent Skills stable descriptive fields `license`, `compatibility` and `metadata` as data. `metadata` is exactly a string-to-string map.
- Do not accept `allowed-tools`: it is experimental permission-bearing metadata, while OpenCorvus tool grants and permission policy have separate canonical owners. Silent acceptance would advertise semantics OpenCorvus does not implement.
- Do not modify, restart, refresh or stop the running development backend, packaged Overlay sidecar, Overlay window or MCP processes. Real validation uses a new isolated backend and temporary data root.
- Preserve all unrelated staged and unstaged worktree changes. Do not create a worktree or use Git reset.

### Sources read before implementation

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-debug-evidence/SKILL.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-16-platform-legacy-debt-cleanup.md`, especially item 8's strict-frontmatter Recall
- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md`
- Agent Skills specification: `https://agentskills.io/specification`
- Current OpenAI `skill-creator` and `skill-installer` `SKILL.md` sources under `https://github.com/openai/skills`

### Runtime evidence and causal chain

- Snapshot backend identities: development backend `http://127.0.0.1:7878`, process 12464, started 11:41; packaged `0.0.9-beta` sidecar `http://127.0.0.1:7879`, process 17584, started 12:35. Both reported `C:/Users/chuan/.local/share/opencorvus/opencorvus.db` through `/global/health`.
- The current `skill-creator/SKILL.md` was updated at 12:03 and contains `metadata.short-description`; `skill-installer/SKILL.md` contains the same field.
- Packaged sidecar: `/skill` and `/expert-squad/catalog` returned 500 `SkillInvalidError` with `unrecognized_keys: metadata`; `/mcp` returned 200 with Browser MCP connected.
- Development backend: the same routes returned 200 because its Instance-scoped Skill inventory was created before the system Skill update. This is cache/start-time evidence, not proof that the current parser accepts the files.
- Direct trigger: `Skill.Definition` is strict but omits the standards-defined `metadata` field.
- Propagation: global discovery scans `~/.codex/skills/**/SKILL.md`; `PromptProfileResolver.catalog` awaits `Skill.all()`, so one rejected external Skill aborts both the Skill list and the combined expert-squad Skill/MCP projection response.
- There is no scheduler task/session persistence transition in this failure; database task rows are not causal. The failing boundary is configuration discovery before catalog construction.

### Repository-wide search inventory

- `rg` across Skill parsing, `Skill.Info`, `Skill.Definition`, `Skill.all()`, route schemas, expert-squad catalog consumers and Overlay consumers found 110 relevant call-site lines.
- Single parse owner: `packages/opencorvus/src/skill/skill.ts::parseDefinition`; filesystem, built-in and bundle loading all converge there.
- Import validation owner: `packages/opencorvus/src/skill/manager.ts::validateSkillDirectory` and `parseSkillRoots`, both call `Skill.parseDefinition`.
- HTTP readers: `/skill` exposes `Skill.Info[]`; `/expert-squad/catalog` obtains the same inventory through `PromptProfileResolver.catalog`; `/mcp` calls `MCP.status()` independently.
- Runtime propagation sites in `skill.ts` construct built-in and external `Skill.Info` objects explicitly and therefore must copy every newly declared descriptive field.
- Existing strict regressions cover `agents`, `mounted_agents` and `arbitrary_unknown_key`; no regression covers standard `metadata`, its value type, or the two real Codex system Skill shapes.
- Global/repository Skill scan found only the two current Codex system files using these optional standard fields, both using `metadata.short-description`.

### Independent-agent feedback

- None. The user requested a repair and review but did not request multiple independent Agents; current collaboration policy does not authorize delegation. Codex owns the second exact-diff review.

## Plan

1. Extend the single strict `Skill.Info`/`Definition` schema with stable Agent Skills descriptive fields and propagate them without loss into built-in and external runtime inventory.
2. Add table-driven schema tests for valid descriptive metadata and invalid metadata/unknown/permission-bearing fields; add real route coverage for global Codex system Skill-shaped fixtures and the combined catalog projection.
3. Run focused tests under the repository inactivity timeout runner, then typecheck and required document/API health checks.
4. Start a new isolated backend without touching existing processes, query `/global/health`, `/skill`, `/expert-squad/catalog` and `/mcp`, and stop only that owned process after evidence is captured.
5. Review the exact diff and test evidence, update this record, commit with `dsw-33987`, and push `v0.0.9beta` to `myhexin`.

## Implementation and verification

- `Skill.Info` and the strict `Skill.Definition` now declare and preserve `license`, `compatibility` and `metadata`. `metadata` is a string-to-string record; compatibility enforces the specification's 1–500 character boundary; license remains an unmodified string because the specification defines no stronger validation.
- Both explicit runtime inventory constructors copy all three fields for built-in and external Skills. `Skill.Definition.strict()` remains the only ordinary frontmatter boundary; no exception, skipped file, Codex-specific parser or catalog catch was added.
- Unit regressions prove the descriptive fields survive parsing and global `.codex/skills` discovery. They also prove non-string metadata values fail and `agents`, `mounted_agents`, `arbitrary_unknown_key` and experimental `allowed-tools` remain uniform unknown-key failures.
- Skill route regression imports a dropped multi-file Skill carrying the three descriptive fields and proves `/skill/installed` returns them unchanged. The expert-squad route regression creates current `skill-creator` and `skill-installer` system-Skill shapes below `.codex/skills/.system`, then proves `/skill` returns both metadata maps and `/expert-squad/catalog` returns a schema-valid 200 response.
- Final focused matrix after review: 70 pass, 0 fail, 306 assertions across `skill.test.ts`, `skill-routes.test.ts` and `historical-docs-links.test.ts`. The isolated expert-squad route regression passes 1/1 with 5 assertions.
- OpenCorvus typecheck passes under a 120-second inactivity timeout. An earlier parallel invocation reached a real 60-second no-output timeout while another repository-wide typecheck competed for the same tree; its child cleanup received Windows access denied. The competing process later exited naturally, and the isolated rerun completed with exit 0.
- Formal `bun script/generate.ts` updates only `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/types.gen.ts` for the new response fields. `api:routes-check` passes all 6 rules across 31 route files, `docs:check` passes all 274 operations across 24 groups, and `git diff --check` passes.
- After the new record entered the Git index, document health passed 62/62 with 1,262 assertions, including tracked monthly-record links and the retained single strict Skill frontmatter owner.
- Real post-fix chain: a newly owned backend on `http://127.0.0.1:7891` used isolated `OPENCORVUS_HOME` data while scanning the real user home. `/global/health` reported its isolated database; `/skill` returned 26 Skills and the exact current `skill-creator`/`skill-installer` short descriptions; `/expert-squad/catalog` returned active `general` with two squads; `/mcp` returned 200 with Browser MCP `connecting`. The owned backend then handled SIGINT with zero task/run/session/tool-part records to settle. Existing 7878/7879/Overlay processes were untouched.
- The host safety layer refused recursive deletion of the verified workspace-local `.scratch/agent-skill-metadata-e2e` directory. No bypass was attempted. The ignored directory contains only the stopped isolated runtime's data and is not part of the Git delivery.
- Second exact-diff review rejected the first implementation's `trim().min(1)` license validator and `trim()` compatibility validator because they exceeded the standard and silently transformed descriptive data. The final schema removes those transforms, regenerates the contract and reruns all final validation above. No known code or contract issue remains before tracked-document health, commit and push.
