# Skill supporting-file read boundary repair

Date: 2026-07-25

Status: Implemented and verified

## Recall

### User requirement

Determine why Codex Task session `ses_06bca4392ffe5F15SmIlXjEQ9G` resumed briefly after an
OpenCorvus restart and then stopped, and repair the root cause rather than restarting the same
failed execution again.

### Acceptance criteria

- A projected package Skill can load a required supporting text file such as
  `references/system-project-contract.md` through the exact turn-owned Skill tool.
- The generic `read` tool continues to reject arbitrary
  `Global.Path.cache/projected-skills/**` paths outside the project boundary.
- Supporting-file access is constrained to the selected mounted Skill and rejects absolute paths,
  parent traversal, Windows absolute paths, missing files, directories, and symlink escapes.
- Large text resources support line pagination without relying on an unreadable truncation file.
- Images and Portable Document Format files retain typed tool-result attachments; other binary
  supporting files fail visibly.
- Production `skill` and Mission-only `mission_skill` use the same implementation and security
  boundary.
- The failed Task is not represented as resumable. A fresh Task must resolve a fresh immutable
  projection after the runtime and package correction is deployed.

### Hard constraints

- Do not broaden `external_directory` permission or add a cache-root bypass to `read`.
- Do not duplicate reference contracts into multiple `SKILL.md` files.
- Do not add fallback lookup, aliases, a second resource index, a workflow gate, or hidden
  messages.
- Preserve the exact turn-resolved Skill surface and content-addressed bundle as the only runtime
  authority.
- Do not restart or disturb the running OpenCorvus or Overlay process.
- Preserve the unrelated untracked `expert-squads/.DS_Store`.
- Commit subjects use `dsw-33987` and push through normal hooks to `myhexin/v0.0.18beta`.

### Evidence read

- The original queue Task completed; Mission-created Task
  `tsk_f947eb238001f5MtDau0piQb1m` reached terminal `failed`, and both Task status and conversation
  endpoints remained responsive.
- Its terminal error records that both the worker and Orchestrator were denied while trying to
  read
  `~/.cache/opencorvus/projected-skills/<digest>/references/system-project-contract.md`.
- `Skill.installBundle()` intentionally materializes immutable package directories under
  `Global.Path.cache/projected-skills/<bundle-key>`.
- `createSkillLoaderTool()` lists those materialized supporting files and tells the model their
  relative paths use that directory, but offers no operation for reading a listed resource.
- `ReadTool` correctly routes the resulting absolute cache path through
  `assertExternalDirectory()`, whose real-path check admits only the current project directory or
  worktree.
- The Mission's later Prism commit copied reference contracts into nine `SKILL.md` files. That
  avoids the immediate read but creates nine competing copies and cannot alter the immutable
  projection of the already failed Task.

### Full-repository call-site inventory

| Surface                                                                                             | Disposition                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/tool/skill.ts`                                                             | Extend the shared production/Mission loader with exact supporting-file reads, safe resolution, pagination, typed media, and relative sampled paths.                                          |
| `packages/opencorvus/src/skill/skill.ts`                                                            | Export the existing bundled-path validator as the single supporting-file relative-path invariant; keep bundle installation on the same invariant.                                            |
| `packages/opencorvus/src/tool/read.ts`                                                              | Keep project-boundary authorization unchanged; share only text-page and binary classification mechanics.                                                                                     |
| `packages/opencorvus/src/tool/text-file.ts`                                                         | Own text pagination/byte limits and binary classification used by both `read` and Skill supporting-file reads.                                                                               |
| `packages/opencorvus/src/session/system.ts`                                                         | Tell the model to use `skill(name, file)` or `mission_skill(name, file)` for relative supporting files and never project-read materialized cache paths.                                      |
| `packages/opencorvus/test/tool/skill.test.ts`                                                       | Cover real frozen-bundle reads, pagination, unsafe paths, symlink escape, binary behavior, and exact Skill isolation.                                                                        |
| `packages/opencorvus/test/expert-squad/skill-supporting-file-projection.test.ts`                    | Resolve the repository Prism package, load the exact researcher contract through Skill, and prove generic project `read` still rejects the materialized cache path.                          |
| `packages/opencorvus/test/tool/read.test.ts`                                                        | Retain existing project/external-directory and binary regressions after the shared text-reader extraction.                                                                                   |
| `packages/opencorvus/test/session/system-skill-directive.test.ts`                                   | Pin the supporting-file tool instruction for both Skill families.                                                                                                                            |
| `packages/opencorvus/test/tool/schema-snapshot.test.ts`                                             | Update the canonical tool schema snapshot for `file`, `offset`, and `limit`.                                                                                                                 |
| `specs/current/architecture/04-extensions.md`                                                       | Record exact Skill-tool resource reads as part of supporting-file materialization.                                                                                                           |
| `specs/README.md`, `specs/records/2026-07/README.md`                                                | Index this repair.                                                                                                                                                                           |
| `packages/opencorvus/src/tool/external-directory.ts`, `packages/opencorvus/src/project/instance.ts` | Retain unchanged; their project/worktree real-path boundary is correct.                                                                                                                      |
| Prism package commit `14cf7ce` in `/Users/yangheng/Documents/OpenCorvus-Demos/prism`                | Replace the duplicated inlined contracts with single reference files only after the runtime protocol is available; it is a separate repository and is not silently rewritten by this repair. |

### Independent agent feedback

No independent Agent was requested or used. The diagnosis is based on persisted Task/session/tool
evidence, current runtime code, package history, and repository-wide call-site searches.

## Causal chain

The visible “briefly resumed and died” state was not a deadlock. Restart released the earlier
directory-switch blockage, Mission created a fresh Task, and that Task then failed at its first
worker node. The direct trigger was a generic project-file read of a projected Skill cache path.
The deeper protocol defect is that the Skill loader owns and materializes the immutable supporting
file closure but returns only filesystem addresses; the only advertised consumer is the generic
`read` tool, whose project boundary correctly excludes those addresses. The subsequent retry
question was dismissed, so Mission emitted `finish: stop`.

## Implementation plan

1. Reuse the existing bundle path validator as the exact relative supporting-file validator.
2. Add an optional `file` operation to the shared Skill-family tool. Resolve it only after exact
   name authorization and materialization, then enforce real-path containment in that Skill root.
3. Share the existing text pagination and binary detection mechanics with `read`, without sharing
   any authority decision or adding a cache bypass.
4. Update the system Skill policy and sampled file output so the supported call is explicit.
5. Add focused regressions, run package typecheck and documentation health, then perform a final
   diff review before committing and pushing.

## Validation ledger

- `bun test packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/tool/read.test.ts packages/opencorvus/test/tool/schema-snapshot.test.ts packages/opencorvus/test/session/system-skill-directive.test.ts packages/opencorvus/test/expert-squad/skill-mount-projection.test.ts packages/opencorvus/test/expert-squad/skill-supporting-file-projection.test.ts`: 38 passed. This includes exact production/Mission Skill reads, text pagination, image attachment, binary rejection, missing/directory/unsafe-path rejection, symlink escape rejection, unchanged generic `read` external-directory behavior, and the real Prism researcher contract.
- The Prism regression imports the repository package through `ExpertSquadPackageManager`, resolves the active worker and Skill grant through `PromptProfileResolver`, constructs the exact turn surface through `SkillMount.resolve`, reads `references/system-project-contract.md` through `SkillTool`, then proves `ReadTool` still requests and receives denial for the materialized cache path.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run typecheck`: 9 repository package typechecks passed; Software Development Kit import and Artificial Intelligence runtime checks passed.
- `bun run docs:check`: passed with 283 operations across 23 groups.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 82 passed after the new record and both canonical indexes were staged.
- `git diff --check`: passed.
- Final review confirms `packages/opencorvus/src/tool/external-directory.ts` and the project/worktree boundary remain unchanged, the failed Task is not mutated or relaunched, the running application is not restarted, and the unrelated `expert-squads/.DS_Store` remains untracked and untouched.
