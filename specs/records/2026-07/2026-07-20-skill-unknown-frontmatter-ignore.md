# Skill Unknown Frontmatter Ignore Semantics

Date: 2026-07-20
Status: Complete
Owner: Codex

## Recall

### User request

- Repair the Expert Squads catalog failure shown for a project containing
  `.agents/skills/next-best-practices/SKILL.md` with unsupported frontmatter field `user-invocable`.
- Unsupported Skill fields must be ignored instead of rejecting the Skill.
- Follow-up correction: unsupported entries inside the declared `metadata` bag, including an object-valued
  `metadata.openclaw`, must likewise be omitted instead of aborting Skill discovery and `/skill/mounts`.

### Acceptance criteria

- A valid Skill with `user-invocable` or another unknown frontmatter key loads through the canonical Skill parser.
- Unknown fields are stripped from the typed Skill definition and never projected as supported runtime semantics.
- Known fields remain validated: an invalid value for a supported field still raises `SkillInvalidError`.
- Supported string-valued metadata entries remain projected; non-string metadata entries are absent from the typed
  definition and do not prevent the Skill or mount matrix from loading.
- Managed folder and ZIP imports accept Skills with unknown fields and persist only the original package bytes plus supported typed metadata.
- Package-owned Expert Squad Skills use the same ignore-unknown frontmatter policy.
- The real Skill and Expert Squad catalog route paths remain healthy with an external Skill containing `user-invocable`.

### Hard constraints

- Change the single Zod Skill frontmatter schemas; do not add a key allowlist, parser fallback, catalog catch, skipped-Skill path, or UI workaround.
- Metadata filtering must be value-shape based and generic; do not add an `openclaw` special case or interpret its
  runtime requirements as OpenCorvus semantics.
- Ignoring a field does not implement its semantics. In particular, `user-invocable`, `agents`, `mounted_agents`, and `allowed-tools` remain absent from `Skill.Definition` and runtime projection.
- Preserve validation for every declared field and preserve `SkillInvalidError` path/cause evidence.
- Preserve unrelated worktree changes and do not touch running OpenCorvus or Overlay processes.
- This current user decision supersedes the strict-unknown-field acceptance criterion recorded in
  `2026-07-18-agent-skill-metadata-schema-repair.md` and item 8 of
  `2026-07-16-platform-legacy-debt-cleanup.md`.

### Sources read before implementation

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-18-agent-skill-metadata-schema-repair.md`
- `specs/records/2026-07/2026-07-16-platform-legacy-debt-cleanup.md`, item 8
- `packages/opencorvus/src/skill/skill.ts`
- `packages/opencorvus/src/skill/manager.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- Skill, Skill Manager, Skill route, Expert Squad Registry, and document-health tests.

### Repository-wide search inventory

- `Skill.parseDefinition` in `packages/opencorvus/src/skill/skill.ts` is the only ordinary Skill frontmatter parse owner.
- Filesystem discovery, built-in Skill parsing, bundled Skill parsing, managed-directory validation, and dropped folder/ZIP import all converge on `Skill.Definition` through `Skill.parseDefinition`.
- `Skill.PackageDefinition` is the package-owned Expert Squad Skill parse owner and is passed into
  `collectPackageResources` by `ExpertSquadRegistry.loadPackage`.
- Existing strict-unknown behavior tests are in `test/skill/skill.test.ts`, `test/skill/manager.test.ts`,
  `test/server/skill-routes.test.ts`, and `test/script/document-health.test.ts`.
- `Skill.Info.shape.metadata` is the sole metadata value-shape owner. Built-in, bundle, filesystem discovery,
  managed import, `SkillMount`, and package-definition parsing all consume the resulting `Definition` projection;
  no consumer requires object-valued metadata.
- The observed `/expert-squad/catalog` failure is propagated by external Skill discovery before catalog assembly;
  no Overlay component or HTTP response schema owns the defect.
- `rg` found unrelated `unrecognized_keys` assertions in Goal input, Build result compatibility handling, and
  task-session tests; those schemas are not Skill frontmatter and remain unchanged.

### Independent-agent feedback

- None. The user did not request sub-agents; Codex will perform the required second exact-diff review.

## Plan

1. Change `Skill.Definition` and `Skill.PackageDefinition` from strict rejection to Zod's canonical strip-unknown
   object behavior, retaining all declared-field validators and the single `parseDefinition` error wrapper.
2. Replace strict-unknown regressions with table-driven strip assertions, retain invalid-known-field regressions,
   and cover external discovery plus managed folder and ZIP imports.
3. Add real Expert Squad Registry/catalog route coverage for `user-invocable` so the screenshot's propagation path
   is tested, not only the schema helper.
4. Update document-health invariants and the superseded historical decision text/indexes without creating a second
   policy source.
5. Run focused tests, document health, typecheck, API/docs checks, generated-artifact verification, exact-diff
   review, then commit with the `dsw-33987` prefix and push `v0.0.12beta` to `legacy-remote`.
6. Codex review feedback: replace the earlier non-string-metadata rejection decision with one canonical metadata
   projection that preserves string entries and strips every unsupported value shape. Add both direct parser and
   real `/skill/mounts` discovery regressions for the reported `metadata.openclaw` object.

## Implementation and verification

- `Skill.Definition` and `Skill.PackageDefinition` now explicitly use Zod's `strip()` object policy. All ordinary
  discovery/import paths still converge on `Skill.parseDefinition`; Expert Squad package loading still receives
  `Skill.PackageDefinition`. No key-specific branch, fallback parser, skipped-Skill catch, or catalog/UI workaround
  was added.
- Table-driven parser tests cover `user-invocable`, `agents`, `mounted_agents`, `arbitrary_unknown_key`, and
  `allowed-tools`: every Skill parses and the unsupported key is absent from the typed definition. The follow-up
  correction supersedes the earlier non-string negative regression: the metadata projection retains supported
  string entries and strips object, array, number, boolean, and null values without interpreting them.
- Real `.agents/skills/**/SKILL.md` discovery accepts `user-invocable: false`; managed path install accepts the
  unsupported-key matrix; dropped folder and ZIP routes return 200, preserve the original `SKILL.md` bytes, apply
  the requested policy, and omit the unknown field from installed runtime metadata.
- Expert Squad Registry loads a package-owned Skill containing `user-invocable: false` and strips the field. The
  isolated real `/skill` plus `/expert-squad/catalog` route regression uses global Codex-system-shaped Skills with
  the same field and returns schema-valid 200 responses.
- Focused parser/manager/Registry verification passes 104/104 tests with 354 assertions. The two real dropped-file
  route cases pass with 10 assertions; the isolated catalog propagation case passes with 6 assertions.
- OpenCorvus typecheck, the 6-rule API route inventory, and the 276-operation docs check pass. Formal
  `bun script/generate.ts` completes successfully; this Skill schema change produces no API/SDK contract delta.
- Document and historical-link health pass 82/82 with 1,355 assertions against a temporary index containing all
  concurrently authored referenced July records. This avoids mutating the real index or treating other tasks'
  untracked records as this task's changes.
- A first diff review found that the repository's available Prettier invocation rewrote existing formatting well
  beyond this task. The affected files were proven clean at task start, precisely restored from `HEAD`, and the
  semantic patch was replayed; the final core implementation diff is two `.strict()` to `.strip()` replacements.
- Final exact-diff review accepts the 12-file staged slice: production behavior changes only the two canonical
  Skill schemas; every other staged hunk is a regression, current-architecture statement, supersession marker, or
  task record/index. No Expert Squad Market/repair hunk or unrelated dispatch-observability change is staged.
  Commit and push remain pending. The first baseline push was blocked by an unrelated in-progress Expert Squad
  Overlay change whose unused locale key failed the mandatory pre-push hook.

### Follow-up correction verification

- `projectDescriptiveMetadata` is the one input projection for ordinary and package-owned Skill definitions. It
  retains string entries, removes unsupported value shapes, and removes the metadata bag entirely when no supported
  entry remains. It has no metadata-key or OpenClaw-specific branch.
- The public `Skill.Info` schema remains `Record<string, string>` after projection. `api:routes-check`, `docs:check`,
  and formal generation prove the OpenAPI and generated JavaScript Software Development Kit contract did not widen
  to unknown or object-valued metadata.
- The direct regression covers object, array, number, boolean, and null entries plus package-owned Skill parsing.
  The real `.agents/skills/**/SKILL.md` regression carries object-valued `metadata.openclaw`, calls
  `/skill/mounts`, receives 200, retains the Skill, preserves its supported `author`, and omits the OpenClaw object.
- The stale route regression that expected unsupported top-level `mounted_agents` to cause a 500 now proves the
  field is ignored and cannot derive mount semantics; the explicit Expert Squad manifest remains the only grant
  source.
- Final isolated verification passes: Skill mount routes 25/25 with 160 assertions; Skill, manager, and Expert Squad
  Registry tests 104/104 with 354 assertions; historical/document health 82/82 with 1,356 assertions; OpenCorvus
  typecheck; the 6-rule API route inventory; docs for 281 operations in 23 groups; formal generators; and
  `git diff --check`.
- Exact-diff review found and corrected one attempted contract widening from a transform-shaped OpenAPI schema. The
  final design separates permissive frontmatter input projection from the strict typed `Skill.Info` output, with no
  generated contract delta and no unrelated file in the delivery slice.
