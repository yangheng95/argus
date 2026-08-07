# Skill Platform Token Portability Repair

Date: 2026-07-21
Status: Implemented and verified
Owner: Codex

## Recall

### User request

- Repair the Expert Squads Settings failure shown in the supplied screenshot.
- The visible failure is a `GET /expert-squad/catalog` HTTP 500 whose Zod issues reject
  `platforms[1]` and `platforms[2]` while advertising `win32 | darwin | linux` as the allowed values.

### Acceptance criteria

- A Hermes-format Skill declaring `platforms: [linux, macos, windows]` loads through the canonical
  ordinary Skill parser and the package-owned Expert Squad Skill parser.
- `GET /skill` and `GET /expert-squad/catalog` return schema-valid HTTP 200 responses for a real
  project containing that external Skill shape.
- Platform eligibility still hides a Skill on an incompatible host and accepts it on its declared
  host; omitted or empty `platforms` still means all supported hosts.
- The public Skill/OpenAPI/Software Development Kit contract and English/Chinese Skill docs expose
  only `windows | macos | linux`.
- Repository-owned Hermes package sources and generated payloads use those portable values; the
  retired Node.js runtime tokens do not remain as accepted Skill metadata.
- Focused Skill, Registry, route, documentation, generated-artifact, typecheck and API checks pass.
- The Expert Squads Settings surface is rendered in an isolated Node/Playwright browser fixture,
  inspected through a screenshot, and no longer shows the catalog failure for this input.

### Hard constraints

- `Skill.Definition` and `Skill.PackageDefinition` remain the only frontmatter schema owners.
- Do not add aliases, a dual-value schema, parser fallback, skipped-Skill catch, catalog catch, UI
  workaround or keyword-specific repair.
- External Skill metadata uses portable ecosystem tokens. Node.js `process.platform` values remain
  internal and are translated exactly once at the Skill eligibility boundary.
- Preserve validation of declared fields and the existing strip-unknown behavior for unsupported
  fields.
- Do not restart, refresh, stop or otherwise modify the user's running OpenCorvus/Overlay process.
  Runtime and visual verification must use separately owned isolated processes.
- Do not create a worktree or edit the Windows Subsystem for Linux mirror. Commit subjects use the
  required `dsw-33987` prefix and pushes go to `myhexin`.

### Sources read

- `AGENTS.md`
- Browser control Skill instructions
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-18-agent-skill-metadata-schema-repair.md`
- `specs/records/2026-07/2026-07-20-skill-unknown-frontmatter-ignore.md`
- `packages/opencorvus/src/skill/{skill,mounts,manager}.ts`
- `packages/opencorvus/src/expert-squad/{registry,prompt-profile-resolver}.ts`
- `packages/opencorvus/src/server/routes/{skill,expert-squad}.ts`
- Skill, Expert Squad Registry/resolver, route and Overlay browser tests.
- Hermes Agent's current `SKILL.md` format documentation and Obsidian Skill source, which define the
  extension values as `macos | linux | windows`.
- The current Agent Skills specification and Claude Skill authoring documentation. They do not
  declare a standard `platforms` field, so this field's value contract comes from the Hermes
  extension that supplies the affected Skill packages.

### Whole-repository search evidence

- `rg "platforms"` found one schema owner in `packages/opencorvus/src/skill/skill.ts`, one runtime
  compatibility consumer in `packages/opencorvus/src/skill/mounts.ts`, projection/copy-only consumers
  in `manager.ts` and `prompt-profile-resolver.ts`, and one rendered tool consumer in
  `packages/opencorvus/src/tool/skill.ts`.
- `PromptProfileResolver.catalog` obtains its default inventory from `Skill.all()`. A declared-field
  parse failure therefore aborts `/expert-squad/catalog` before catalog assembly; the Overlay error
  is propagation, not the source defect.
- Checked-in public contract copies are `packages/sdk/openapi.json` and four generated JavaScript SDK
  type locations. They must be regenerated from the production schema rather than hand-edited.
- Human documentation copies are `packages/web/src/content/docs/{skills,zh-cn/skills}.mdx`.
- Repository package content has one relevant declaration:
  `expert-squads/hermes/mirror-prism/skills/popular-web-designs/SKILL.md`; its generated payload copy
  is owned by the root generator.
- Existing tests cover unknown frontmatter and metadata shapes, but no test covers the portable
  platform value set or the runtime host mapping. No current route regression reproduces the exact
  Hermes three-platform failure.
- Unrelated `process.platform === "win32"`, path parsing, PTY, release artifact, gateway and channel
  occurrences are internal host/runtime behavior and remain unchanged.

### Independent agent feedback

- None. The user did not request multiple agents or parallel audit; collaboration policy does not
  authorize delegation. Codex owns the required second exact-diff review.

## Evidence-backed causal chain

1. Observable symptom: the screenshot shows `/expert-squad/catalog` failing with exactly two
   `invalid_value` issues at `platforms[1]` and `platforms[2]`.
2. Direct reproduction: parsing `{ platforms: ["linux", "macos", "windows"] }` through the current
   `Skill.Definition` produces byte-for-byte the same issue structure: index 0 passes, while indices 1
   and 2 are rejected against `win32 | darwin | linux`.
3. Source contract: Hermes documents and ships `linux | macos | windows`; OpenCorvus imported a
   Hermes extension but replaced its portable operating-system names with Node.js runtime constants.
4. Propagation: `Skill.all()` fails before `PromptProfileResolver.catalog` can assemble the active
   Expert Squad projection, so the settings page receives HTTP 500 and presents catalog recovery UI.
5. Why prior repairs did not fix it: the July 18/20 repairs addressed unknown fields and unsupported
   metadata value shapes. `platforms` is a declared field, so its enum remained strict and the leaked
   internal vocabulary continued to reject valid Hermes Skills.

## Plan

1. Introduce one Skill-platform module whose canonical schema is `windows | macos | linux`, whose
   Node.js-to-Skill mapping is the only runtime translation, and whose pure compatibility predicate is
   consumed by Skill mounts.
2. Make both canonical Skill frontmatter schemas reuse that schema; replace the inline cast/filter in
   Skill mounts and add table-driven schema, mapping and compatibility tests, including negative
   rejection of retired `win32` and `darwin` metadata.
3. Add production-shaped external-Skill route coverage for `/skill` and `/expert-squad/catalog`, plus
   package-owned Registry coverage, using `[linux, macos, windows]`.
4. Update current architecture, English/Chinese Skill docs and the repository-owned Hermes package
   source; regenerate payload, OpenAPI and SDK artifacts through their existing generators.
5. Run focused tests first, then required spec/document health, typecheck, API route/docs checks and
   generated-artifact verification. Review the exact diff and correct any missed call point.
6. Run an isolated real OpenCorvus backend and Overlay with Node/Playwright against the repaired
   input, inspect the task-scoped screenshot and rerun after any visual discrepancy.
7. Record verification evidence here, commit the completed repair with `dsw-33987`, push the current
   delivery branch to `myhexin`, and confirm the remote branch contains the commit.

## Implementation

- Added `SkillPlatform` as the single owner of the portable `windows | macos | linux` schema, the
  exact Node.js host-token translation, and the mount-support predicate.
- Replaced the leaked Node.js enum in `Skill.Definition`; `Skill.PackageDefinition` continues to
  derive from that same schema owner.
- Replaced the mount-layer cast and direct comparison with `SkillPlatform.supports`, preserving an
  empty declaration as all-host support and strict failure for unsupported Node.js hosts.
- Updated the repository Hermes source and regenerated its embedded payload plus OpenAPI and the
  JavaScript Software Development Kit types.
- Updated current architecture and the English/Chinese Skill reference to publish only the portable
  external contract.
- Added parser, negative retired-token, host mapping, mount disablement, Registry and real route
  regressions. The route regression executes both `/skill` and `/expert-squad/catalog` with the exact
  affected `[linux, macos, windows]` shape.

## Verification evidence

- `bun test --timeout=0 packages/opencorvus/test/skill/skill.test.ts packages/opencorvus/test/expert-squad/skill-mount-projection.test.ts packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts`
  — 94 passed, 0 failed.
- `OPENCORVUS_EXPERT_SQUAD_ROUTES_ISOLATED_CASES=1 bun test --timeout=0 packages/opencorvus/test/server/expert-squad-routes.test.ts -t "portable external Skill metadata"`
  — 1 passed, 0 failed; 7 assertions cover both live routes.
- `bun test --timeout=0 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  — 87 passed, 0 failed.
- `bun script/generate.ts`, root `bun run typecheck`, `bun run api:routes-check`, `bun run
  docs:check`, package typechecks and `git diff --check` all passed.
- An isolated backend on port 17971 used a real Git project containing
  `.agents/skills/hermes-portable/SKILL.md` with `platforms: [linux, macos, windows]`. The real
  Overlay Expert Squads Install panel rendered 5 catalog packages; scoped DOM inspection found
  neither `Catalog unavailable` nor `Failed to load expert squads`, and browser error logs were
  empty. Visual evidence: `.scratch/skill-platform-expert-squads-repaired.jpg`.
- The isolated browser tab and separately owned backend were finalized after capture. Graceful
  shutdown reported zero live tasks, runs, goal runs, ownerships, sessions and tool parts aborted;
  the user's running OpenCorvus/Overlay process was not touched.

## Codex second review

- Repeated the whole-repository retired-token searches after generation; no Skill frontmatter,
  production schema, public documentation, OpenAPI or generated JavaScript Software Development Kit
  type still publishes `win32` or `darwin` as Skill metadata.
- Reviewed the exact production/test/document/generated diff. The remaining Node.js platform tokens
  are confined to `SkillPlatform`'s internal translation and unrelated host-runtime behavior.
- Confirmed the screenshot matches the reported Install surface and removes the large catalog error
  block without introducing a UI workaround; the fix remains at the metadata/runtime boundary.
