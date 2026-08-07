# Multica Artifact Contract Calibration

Status: Implemented; scoped verification passed
Date: 2026-07-26
Owner: Codex

## Recall

### User request

The user asked whether the code and Skills imported from Multica need updating
after the refactor, then explicitly requested a repository check and
calibration.

### Acceptance criteria

1. A freshly imported Multica package conforms to the current Expert Squad
   package writer, Registry, runtime-template, Goal-concurrency, binding
   workflow, and Task Artifact contracts.
2. Imported source Agent instructions, source Skill directories, and remote MCP
   declarations remain immutable source snapshots; calibration must not rewrite
   or flatten them.
3. `artifact_search`, `artifact_read`, and `artifact_select` remain Core-owned
   scheduler/worker capabilities, while `artifact_snapshot` and
   `artifact_publish` remain Core-owned and worker-only.
   A Multica package must neither declare nor shadow these tool identifiers.
4. The built-in `multica-import` Skill teaches the same Artifact ownership and
   exact-read boundary as the runtime and JavaScript software development kit
   authoring contract.
5. Generated Multica package provenance exposes both the source snapshot digest
   and the mapping digest used to materialize it.
6. Existing import safety remains unchanged: installed Multica packages remain
   visible but non-selectable, and ordinary Multica import never replaces an
   installed package or modifies `prompt_profile.active`.
7. Focused Multica adapter, Skill, generated-payload, Registry/Resolver, docs,
   typecheck, and diff checks pass.

### Hard constraints

- Do not add a fourth Multica tool, a source synchronization loop, a compatibility
  reader, a fallback loader, a hidden message, a host scheduling gate, or
  keyword-based mapping.
- Do not convert `multica_import` into an update operation or weaken its
  `replace: false` guarantee. A future source-refresh product surface requires a
  separate explicit design with exact installed-package ownership.
- Do not copy Artifact bodies into package prompts, workflow edges, dispatch
  outcomes, or source Skills. Workflow `depends_on` remains semantic evidence
  topology, not payload transport.
- Preserve every unrelated dirty-worktree change. Do not reset, restore, stash,
  delete, or create a worktree.
- Do not restart, refresh, close, or otherwise interfere with the running
  OpenCorvus or Overlay.
- Commit subjects use the `dsw-33987` prefix and delivery targets the current
  `v0.0.19beta` branch on the `legacy-remote` remote.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
- `specs/records/2026-07/2026-07-22-multica-import-runtime-adapter-planning-closure-repair.md`
- `specs/records/2026-07/2026-07-22-multica-simple-squad-import-stability.md`
- `specs/records/2026-07/2026-07-22-universal-scheduler-build-capability.md`
- `packages/opencorvus/src/expert-squad/multica-import.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/orchestrator/multica-import-tools.ts`
- `packages/opencorvus/src/skill/builtin/multica-import.md`
- `packages/sdk/js/src/expert-squad-authoring.ts`
- Matching Multica, Skill, Registry/Resolver, Manager, route, Overlay, SDK, and
  generated-payload tests.

### Whole-repository grep result

Repository-wide `rg` covered `multica-import`, `multica_import`,
`multica_preview`, `MulticaExpertSquadImport`, `sourceDigest`,
`mappingDigest`, Multica routes and Mission launch copy, package update and
replace paths, `artifact_search`, `artifact_read`, `artifact_select`,
`artifact_snapshot`, `artifact_publish`,
platform Artifact tool constants, Resolver projection, authoring SDK, and all
matching tests and records.

| Call point / owner                                          | Disposition                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expert-squad/multica-import.ts` source and mapping digests | Retain the complete source/MCP and mapping freshness authorities; expose both in generated package provenance.                                    |
| `expert-squad/multica-import.ts` package files              | Preserve exact source `SKILL.md` plus supporting files and source Agent prompts; calibrate only the OpenCorvus-owned README portability boundary. |
| `expert-squad/multica-import.ts` writer and Registry calls  | Retain the single SDK writer and canonical pre-write Registry validation.                                                                         |
| `expert-squad/multica-import.ts` final Manager import       | Retain global scope, `replace: false`, and no activation mutation.                                                                                |
| `skill/builtin/multica-import.md`                           | Teach platform-owned Task Artifact discovery/read/publish and prohibit package declaration, shadowing, or handoff-body copying.                   |
| generated `skill/builtin-payload.ts`                        | Regenerate from the canonical Skill source; never edit manually.                                                                                  |
| `prompt-profile-resolver.ts`                                | Retain canonical injection of discovery tools to schedulers/workers and publish to workers only; do not add a Multica branch.                     |
| SDK authoring platform Artifact constants                   | Retain as the public authoring contract; Multica uses the same writer and must agree with it.                                                     |
| generic `/expert-squad/update`                              | Retain builtin/server ownership. Do not mislabel it as a Multica source refresh.                                                                  |
| Work Ledger Multica Mission copy                            | Retain installed-row visibility, disabled selection, one General Task per selected uninstalled Squad, and zero replacement.                       |
| tests                                                       | Extend the focused Skill and real imported-package Resolver cases; do not rely on string-only contract evidence.                                  |

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration policy
does not authorize sub-agents. The primary Codex agent owns the required second
review.

## Causal assessment

The platform refactor did not make imported source code or Skill bytes
structurally stale. Every Multica package is already rendered through the
current SDK writer, validated through the current Registry, and receives
platform capabilities through `PromptProfileResolver`. The missing calibration
is explanatory and evidentiary: the Multica Skill predates the new universal
Task Artifact protocol, the generated package README records only the source
digest even though mapping identity is independently digest-bound, and the
focused Multica test does not prove the imported package receives the platform
tools without declaring them.

Existing imported packages remain immutable snapshots. The current import
contract intentionally does not overwrite them, and there is no Multica-source
refresh surface. This task will not disguise that product boundary as automatic
synchronization or weaken zero-replacement safety.

## Implementation plan

1. Add the platform Task Artifact ownership and exact-read boundary to the
   canonical Multica Skill.
2. Add the mapping digest and runtime-owned Artifact boundary to generated
   Multica package provenance without rewriting imported source resources.
3. Extend focused tests to prove exact Skill language, generated payload
   freshness, package-manifest non-declaration, scheduler discovery/read
   projection, worker discovery/read/publish projection, and prompt protocol
   composition.
4. Update current architecture and record indexes, run focused and repository
   checks, perform an exact-diff second review, then commit and push only
   task-owned files.

## Verification plan

- `bun packages/opencorvus/script/generate-builtin-skill-payload.ts`
- `bun test packages/opencorvus/test/skill/multica-import-skill.test.ts packages/opencorvus/test/skill/builtin-payload-generation.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/expert-squad/multica-import.test.ts packages/opencorvus/test/expert-squad/virtual-workflow-protocol.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`
- `bun run docs:check`
- `git diff --check`

## Result

- The canonical `multica-import` Skill now states the runtime-owned Task
  Artifact contract: schedulers and workers discover/read exact Task evidence,
  only workers publish package evidence, and Multica mapping/manifests never
  declare or shadow those tool identifiers or copy Artifact bodies.
- Generated Multica package provenance now records both the complete source
  digest and exact mapping digest. Its OpenCorvus-owned portability section
  truthfully identifies Agent instructions, complete Skill directories, remote
  MCP declarations, and approved Browser replacements as immutable import-time
  snapshots rather than a synchronization loop.
- Imported source Agent prompts, Skill bytes, supporting files, MCP declarations,
  manifest identity, global installation scope, inactive selection, and
  `replace: false` behavior remain unchanged.
- The generated built-in Skill payload was refreshed from the canonical Skill
  source.
- The real import regression materializes a package, proves none of the three
  platform Artifact tool IDs appears in its manifest, resolves the installed
  scheduler and worker through `PromptProfileResolver`, and proves exact
  scheduler discovery/read versus worker discovery/read/publish projection and
  composed catalog instructions.

### Verification

- Focused Skill, generated-payload, Multica import, and virtual-workflow suites:
  40 passed, 0 failed, 457 expectations.
- Historical links, document health, and product-doc single-source suites:
  92 passed, 0 failed, 1,446 expectations after staging the new indexed record.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- Root `bun run typecheck`: 8 package tasks passed.
- Overlay i18n check: passed.
- `git diff --cached --check`: passed.
- `docs:check` and `api:routes-check` currently expose unrelated concurrent
  route-generation drift: the unstaged Panel change removes the gateway
  `selection` field, while the unstaged Project/transport changes make the
  worktree response strict. This task does not regenerate or stage those
  parallel-owned OpenAPI/API-reference files.
- An additional manual dead-code audit reports unrelated
  `TerminalPanel.tsx`, `services/terminal.ts`, the channel-runtime util
  dependency, and the `ps` binary. None is touched or owned by this Multica
  calibration.

## Codex review feedback

The exact staged-diff review rejected three tempting but incorrect expansions:

1. Do not make `multica_import` overwrite an installed package merely to close
   source freshness. That would collapse import and update ownership and violate
   the existing exact-ID zero-replacement contract.
2. Do not add platform Artifact IDs to the Multica mapping, manifest, or Skill
   `required_tools`; Resolver already projects the canonical transport and
   rejects package shadowing.
3. Do not rewrite source Agent instructions or source Skills to teach
   OpenCorvus transport. The base-role/runtime prompt owns that protocol and the
   imported source closure must remain byte-preserving.

The first runtime-prompt assertion used wording not present in the canonical
catalog contract. It was corrected to assert the actual exact-locator sentence,
and the complete focused suite then passed. Final review found no new tool,
fallback, package overwrite, activation mutation, source-resource rewrite,
platform-tool declaration, or unrelated staged file.
