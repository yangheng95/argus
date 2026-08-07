# Remove mirror-prism-cluster Mission Skill

## Recall

### User request

- 删除 `mirror-prism-cluster` 技能。

### Acceptance criteria

- The built-in Mission Skill author package is deleted completely.
- Generated built-in Mission Skill payloads, Mission catalog/runtime/API expectations, and current architecture no longer publish or require that Skill.
- Mirror Prism remains one independently selectable Expert Squad package with its package-owned generic and AInvest virtual workflows; deleting the Mission launcher does not delete the Squad.
- Current source-capability evidence has no dangling collaboration-definition path owned by the deleted Skill.
- Historical records remain append-only evidence; current indexes point to this removal record.
- No unrelated worktree change is staged, committed, restored, or deleted.

### Hard constraints

- Preserve the existing unrelated image deletions and untracked platform-architecture image.
- Do not add compatibility aliases, fallback discovery, a replacement launcher, or a Host routing gate.
- Do not add, modify, update, or run UI automation tests. The three existing Overlay UI automation files reached by the exhaustive search must be deleted under the repository-wide UI-test prohibition.
- Pure deletion does not receive a negative regression test. Retained non-UI tests must assert the current positive catalog, runtime, route, package, and source-capability contracts.
- Regenerate the canonical payload with the repository generator rather than editing generated content by hand.
- Commit subjects use the required `dsw-33987` prefix and push only to `myhexin` on `v0.0.27beta`.

### Existing records and architecture read

- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-23-mission-skill-orchestration-surface.md`
- `specs/records/2026-07/2026-07-23-mission-skill-orchestration-implementation.md`
- `specs/records/2026-07/2026-07-23-mirror-prism-single-squad-cutover.md`
- `specs/records/2026-07/2026-07-29-remove-builtin-superpowers.md`
- `specs/records/2026-07/2026-07-30-mission-automatic-expert-squad-production-phase.md`

### Whole-repository search

The pre-change search used the exact identity plus directory-name variants, excluded generated distribution copies only when enumerating author call sites, and separately inspected the generator and all source-capability validators. Historical records are not runtime callers and remain unchanged.

| Current caller or owner                                                                                | Disposition                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/mission-skill/builtin/mirror-prism-cluster/**`                                | Delete the complete author package and all references.                                                                                                  |
| `packages/opencorvus/src/mission-skill/builtin-payload.ts`                                             | Regenerate from the now-empty built-in Mission Skill author root.                                                                                       |
| `packages/opencorvus/test/mission-skill/{builtin-payload-generation,catalog,runtime}.test.ts`          | Remove cluster-specific assertions; retain positive generator, external-root catalog, and project Mission Skill runtime contracts.                      |
| `packages/opencorvus/test/server/{mission-skill-routes,global-composer-references}.test.ts`            | Use a real project Mission Skill for positive route coverage and retain the other global catalog families.                                              |
| `packages/opencorvus/test/expert-squad/prism-bootstrap-evidence-boundary.test.ts`                      | Remove deleted Mission Skill inputs; retain package-owned Prism directory-boundary assertions.                                                          |
| `packages/sdk/js/test/mirror-prism-collaboration.test.ts`                                              | Remove deleted collaboration-definition coverage; retain package/source-capability authoring validation with the current zero-collaboration contract.   |
| `packages/sdk/js/test/review-debug-collaboration.test.ts`                                              | Remove only the deleted launcher's recovery-definition case; retain Review & Debug package and prompt-boundary coverage.                                |
| `packages/opencorvus/test/expert-squad/mirror-prism-source-capability.test.ts`                         | Replace deleted Mission collaboration graph coverage with positive package-owned workflow coverage.                                                     |
| `specs/artifacts/mirror-prism/source-capability-contract.json`                                         | Remove deleted definition paths, collaboration owners, and stage bindings; keep package and platform owners as the current source-capability authority. |
| `expert-squads/mirror/prism/{README.md,selector.md,agents/orchestrator/system.md}`                     | Remove obsolete cross-squad launcher disclaimers; preserve the fixed package workflows and directory ownership.                                         |
| `specs/current/architecture/04-extensions.md`                                                          | Remove the obsolete paragraph that declares the Skill as shipped built-in behavior; retain the generic Mission Skill architecture.                      |
| `packages/overlay/test/{composer-expert-squad-catalog,composer-mention,composer-submit-route}.test.ts` | Delete because the exhaustive task search touched existing UI automation tests and repository policy forbids retaining or running them.                 |
| Historical `specs/records/**`, record index entries, and `AGENTS.md` product-name guidance             | Retain as historical evidence or general naming guidance; they are not runtime sources.                                                                 |

### Independent agent feedback

- No independent agent was requested by the user, so none was started.

## Implementation plan

1. Add this record and both canonical indexes before product edits.
2. Delete the built-in package and touched UI automation tests.
3. Regenerate the built-in Mission Skill payload.
4. Rewrite only current non-UI contracts and documentation that directly referenced the deleted package.
5. Run focused non-UI tests, generated-artifact checks, document health, repository typecheck, and a second diff/reference review.
6. Stage only task-owned paths, commit with `dsw-33987`, and push `v0.0.27beta` to `myhexin` without bypassing hooks.

## Verification target

- Built-in Mission Skill payload generation test.
- Mission Skill catalog/runtime/server route tests.
- Mirror Prism package, bootstrap boundary, source-capability, and Software Development Kit authoring tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` plus the current architecture/document-health checks selected by the repository scripts.
- Package typecheck and the pre-push hook's route/docs checks.
- Final exact-identity search outside historical records and generated distribution copies.
