# MirrorTest Exact-Case Name Normalization

Date: 2026-07-29
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | Replace every occurrence of the legacy exact-case name with `MirrorTest` specifically in version 0.0.23. |
| Acceptance criteria | On branch `v0.0.23beta`, every tracked legacy exact-case occurrence becomes `MirrorTest`; lowercase machine identity `opentest`, manifest IDs, agent IDs, paths, workflow references, and artifact paths remain unchanged; exact-case TypeScript symbols, protocol labels, human-readable text, and test expectations are renamed consistently; generated payloads are regenerated from canonical authoring sources; focused and repository document tests pass; the completed commit is pushed to `legacy-remote/v0.0.23beta`. |
| Hard constraints | Work only in the existing `/private/tmp/opencorvus-v0023-code-work.xWEE8h` worktree; do not create a worktree; preserve exact lowercase identity; do not add aliases, fallback, migration, or a second identity; do not restart or refresh a running OpenCorvus/Overlay; use the `dsw-33987` commit prefix; preserve unrelated work in the 0.0.1beta worktree. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/04-extensions.md`; canonical expert-squad authoring trees; `packages/opencorvus/script/generate-expert-squad-payload.ts`; `packages/opencorvus/script/generate-builtin-mission-skill-payload.ts`; generated payload headers; relevant tests discovered by the whole-repository search. |
| Repository search | A split-pattern `git grep` found 1,491 legacy exact-case occurrences across 170 tracked text files. A filename search found no legacy exact-case filename. The full per-file count inventory was captured before implementation and grouped below. |
| Independent agent feedback | Not requested; current instructions prohibit unsolicited sub-agent delegation. |

## Exhaustive Call-Site Inventory

| Surface | Files | Exact display occurrences | Action |
| --- | ---: | ---: | --- |
| `AGENTS.md` | 1 | 2 | Rename human-readable expert-squad references. |
| `expert-squads/builtin/review-debug/**` | 8 | 18 | Rename collaboration and audit-owner display text. |
| `expert-squads/mirror/prism/**` | 32 | 152 | Rename exact-case symbols and text in prompts, skills, manifests, harness output, protocol code, and messages; preserve lowercase IDs and paths. |
| `expert-squads/wujiang/opentest/**` | 26 | 161 | Rename exact-case symbols and text; preserve namespace, package ID, agent IDs, paths, and lowercase protocol keys. |
| `packages/opencorvus/generated/expert-squad-payload.ts` | 1 | 331 | Do not hand-edit; regenerate from canonical expert-squad sources. |
| `packages/opencorvus/src/mission-skill/**` | 7 | 40 | Rename Mission Skill display text, then regenerate `builtin-payload.ts`. |
| `packages/opencorvus/test/**` | 15 | 126 | Update exact-case symbol, message, and label expectations while retaining lowercase identity assertions. |
| `packages/overlay/test/**` | 4 | 17 | Update visible label expectations only. |
| `packages/sdk/js/test/**` | 2 | 4 | Update human-readable collaboration expectations only. |
| `specs/current/**` | 1 | 5 | Update current architecture display terminology. |
| `specs/records/**` | 69 | 613 | Normalize historical prose and recorded display strings without renaming lowercase paths or filenames. |
| `specs/artifacts/**` | 3 | 19 | Normalize human-readable artifact content. |
| `specs/README.md` | 1 | 3 | Normalize index prose while keeping existing lowercase links. |
| **Total** | **170** | **1,491** | Exact tracked-text replacement plus canonical regeneration. |

## Implementation

1. Replace the legacy exact-case name across every tracked text authoring source and test, excluding the two generated payload modules.
2. Regenerate:
   - `packages/opencorvus/generated/expert-squad-payload.ts`
   - `packages/opencorvus/src/mission-skill/builtin-payload.ts`
3. Confirm no exact-case filename changed and no lowercase identity/path migration occurred.

## Verification

Run:

```bash
git grep -I -n 'O[p]enTest'
git grep -I -o 'MirrorTest' | wc -l
bun packages/opencorvus/script/generate-expert-squad-payload.ts
bun packages/opencorvus/script/generate-builtin-mission-skill-payload.ts
bun test packages/opencorvus/test/expert-squad packages/sdk/js/test/review-debug-collaboration.test.ts packages/sdk/js/test/mirror-prism-collaboration.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
git diff --check
```

## Observed Results

- The legacy exact-case name has zero matches in tracked and non-ignored 0.0.23 source.
- The 1,491 original occurrences across 170 tracked files were replaced. The new task record adds its own `MirrorTest` terminology without reintroducing the legacy name.
- Lowercase `opentest` package identity, namespace paths, manifest IDs, workflow IDs, agent IDs, tool refs, artifact directories, and filenames remain lowercase and unchanged.
- Both official payload generators completed, and the payload-generation contract test confirmed the checked-in expert-squad payload matches canonical repository sources.
- Focused expert-squad rename suite: 27 passed, 0 failed.
- SDK collaboration tests: 7 passed, 0 failed.
- Historical docs links: 22 passed, 0 failed.
- Document health: 63 passed, 0 failed.
- Root typecheck: 8 packages passed.
- `api:routes-check` passed across 33 route files; `docs:check` passed for 307 operations in 24 groups.
- Node-launched Overlay browser acceptance rendered the real 0.0.23 Squad Market. The inspected screenshot at `.scratch/mirrortest-market-current.png` visibly shows `MirrorTest` with unchanged `wujiang/opentest` identity.
- The same browser run exposed pre-existing fixture drift after that screenshot: stale `Market` / `Expert Squads` expectations and unhandled `/chat/capability` requests. Composer and Mission Skill browser tests passed; no production source was changed to hide the unrelated fixture failures.
- A broad expert-squad suite run reached 456 passes and exposed unrelated pre-existing timeouts/config/prompt-expectation drift. The two rename-caused SHA-256 Skill parity failures were repaired, and the focused parity/payload rerun passed.
