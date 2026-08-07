# Remove Built-in Superpowers

## Recall

| Item | Evidence |
| --- | --- |
| User request | “superpowers 内置的skill去掉” — remove the Superpowers Skills that OpenCorvus ships as built-ins. |
| Acceptance criteria | No `superpowers:*` identity is present in the generated built-in Skill payload or General scheduler projection; the complete bundled Superpowers source collection and its obsolete scratch-directory ignore are deleted; ordinary external Skills remain discoverable through the canonical Skill catalog; focused non-UI contracts assert the removed built-ins do not return. |
| Hard constraints | Remove the old path outright without fallback, alias, compatibility projection, hidden source, or second catalog. Preserve historical records as history and update only the living architecture claim. Do not create a worktree, reset the repository, bypass hooks, add or run UI automation tests, or modify unrelated files. Commit subjects use `dsw-33987`; delivery pushes to `legacy-remote`. |
| Sources read | Root `AGENTS.md`; `specs/README.md`; `specs/current/architecture/04-extensions.md`; `specs/records/2026-07/2026-07-15-superpowers-grill-me-builtin-mission-publish.md`; `packages/opencorvus/script/generate-builtin-skill-payload.ts`; `packages/opencorvus/src/skill/skill.ts`; General's `expert-squad.jsonc`; built-in Skill and General-projection tests. |
| Whole-repository grep | Exact-case and case-insensitive searches for `superpowers` found the bundled collection, generated payload, General's 14 default references, `.superpowers` ignore, focused Skill/tool/projection tests, the living extension architecture, historical records, and the pre-June deleted-document guard. `builtinSkillSources` consumers are generic except the focused Superpowers tests and one exact built-in tool materialization fixture. The generated payload is owned by `packages/opencorvus/script/generate-builtin-skill-payload.ts` and regenerated through `generate-build-artifacts.ts`. |
| Independent feedback | The user did not request independent agents, and active collaboration policy forbids unsolicited delegation. The primary agent owns the required second review. |
| Baseline/version evidence | The worktree was clean on `work-v0.0.24beta-yr-0729`. After `git fetch legacy-remote`, local `HEAD` and `legacy-remote/work-v0.0.24beta-yr-0729` both resolved to `9c6d917dc8`. |

## Call-site disposition

| Owner / consumer | Disposition |
| --- | --- |
| `src/skill/builtin/superpowers/**` | Delete the complete collection, including shared license/provenance, supporting references, prompts, examples, and scripts. |
| `src/skill/builtin-payload.ts` | Regenerate from the remaining canonical built-in source tree; do not hand-edit the generated module. |
| General `default_skill_refs` | Delete all 14 `default/skill/superpowers:*` refs and preserve the remaining ordinary built-ins. |
| `test/skill/builtin-skills.test.ts` | Replace positive Superpowers shipping/materialization/risk assertions with an explicit no-Superpowers built-in regression while retaining coverage for the remaining built-ins and generic supporting-file risk behavior. |
| `test/tool/skill.test.ts` | Use a remaining built-in with supporting files for the generic exact built-in materialization contract. |
| `test/expert-squad/multica-general-projection.test.ts` | Remove the 14 expected refs and assert no General scheduler Skill ref names Superpowers. |
| `.gitignore` | Delete `.superpowers`; only removed bundled scripts used that project scratch path. |
| `specs/current/architecture/04-extensions.md` | Replace the living claim that General projects Superpowers with the new remaining built-in inventory. |
| Historical specs and pre-June guard | Preserve unchanged. They describe historical delivery or prevent restoration of deleted documents, not current runtime authority. |

## Implementation and verification plan

1. Commit and push this Recall and removal plan before product implementation.
2. Delete the canonical bundled collection and its General projection, regenerate
   the built-in payload, and update the focused non-UI contracts.
3. Update living architecture and remove the obsolete scratch ignore.
4. Run payload generation tests, built-in Skill tests, Skill tool tests, General
   projection tests, typecheck, historical-document links, document health,
   product-doc single-source validation, and repository-required checks.
5. Inspect the complete diff, scan again for surviving runtime Superpowers
   references, rerun focused verification as the required second review, commit,
   fetch/merge the current remote branch if necessary, and push to `legacy-remote`.

## Status

- [x] Recall, call-site audit, baseline fetch, and implementation plan recorded.
- [x] Plan committed and pushed.
- [x] Built-in Superpowers source and projection removed.
- [x] Verification and second review complete.
- [x] Final changes committed and pushed.

## Codex review feedback

The second diff review found that removing General's default Skill projection
also changes the bundled General package contract. Its manifest version was
therefore advanced from `2026.07.28.1` to `2026.07.29.1`; leaving the old
version would make the available-version metadata describe two different
projection contracts with the same version.

The complete `skill.test.ts` run also exposed an existing incomplete binary
supporting-file fixture. Reading a PNG invokes the production inline-attachment
materializer, but the fixture supplied no registered project context. The test
now executes that one read inside the canonical temporary `Instance` boundary
and disposes it in the same callback. No production behavior changed.

## Verification evidence

| Surface | Result |
| --- | --- |
| Built-in source and payload | The complete tracked `src/skill/builtin/superpowers/**` collection and its empty directory tree are absent. `generate-builtin-skill-payload.ts` regenerated the payload from the remaining source tree, and the freshness/generator plus built-in inventory suites passed `7/7`. |
| Runtime projection | General's scheduler retains only `expert-squad-authoring`, `grill-me`, and `multica-import`; exact scheduler/worker projection tests passed `2/2` in a standalone run. A deliberately combined high-load run hit the file's existing five-second timeout while concurrent repository scans were active, then the unchanged original command passed without that artificial contention. |
| Exact Skill tool | The full exact Skill tool suite passed `9/9`, including real built-in materialization from `work-presentations`, supporting-file enumeration, binary-safe package materialization, and the repaired registered-project attachment context. |
| Documentation | Historical links, document health, and product documentation single-source suites passed `84/84`; living architecture names only the remaining current built-ins, while historical Superpowers records remain unchanged. |
| Type and API contracts | OpenCorvus `tsc --noEmit`, `api:routes-check`, and `docs:check` passed. |
| Second review | The runtime scan found no Superpowers source, generated payload entry, manifest grant, or non-historical architecture claim. Remaining live-text matches are explicit negative regressions and this removal record/index. Unrelated Overlay and July-record work stayed outside this task's edits. |
| Delivery | Plan commit `c32a82368e` and implementation commit `50f84c9205` were pushed to `legacy-remote/work-v0.0.24beta-yr-0729` through the normal hooks. The implementation push passed full workspace typecheck, route inventory, generated API documentation, Overlay internationalization, and secret scanning. |
