# Chat Explicit Skill Mention

Date: 2026-07-27
Status: Implemented and verified; delivery pending commit
Owner: Codex

## Recall

### User Request

The user corrected the current Chat Skill behavior: Skills assigned by default should remain automatically available, while any installed Skill that is not assigned by default must still be selectable with `@skill` and must be loaded when explicitly mentioned. The concrete failing example is `@skill("grill-me")`.

### Acceptance Criteria

- Native Chat keeps `primary_assistant_capabilities.chat.skill_refs` as the only project-owned default Skill assignment.
- The Chat composer `@skill` catalog includes every installed Skill, including `grill-me`, rather than only the active expert-squad production grants.
- A visible exact `@skill("<name>")` directive augments only that Chat turn's resolved Skill surface with the named installed Skill.
- The explicit Skill is available to the real `skill` tool and the existing system instruction continues to require loading it before planning or execution.
- An unassigned and unmentioned installed Skill remains unavailable to Chat automatic discovery and cannot be loaded.
- Explicit mention does not mutate project config, create a session override, activate an expert squad, or persist a second default assignment.
- Unknown or malformed exact mentions fail visibly before model execution.
- Focused backend, Overlay unit, real Vite browser, screenshot, typecheck, document health, diff review, commit, and git-cc push complete successfully.

### Hard Constraints

- Preserve all concurrent work and stage only task-owned files.
- Do not create a worktree, reset, stash, restart, refresh, or otherwise interfere with the running OpenCorvus/Overlay processes.
- Keep the visible user-authored directive as the authority. Do not synthesize a hidden message or introduce keyword-based automatic routing.
- Do not make the full installed catalog automatically loadable. Default assignment and exact per-turn mention have distinct authority and must converge into one turn-owned Skill surface.
- Do not write explicit mention state back to `primary_assistant_capabilities`, session config, or another persistent field.
- Do not add fallback, compatibility aliases, gates, state machines, or name guessing.
- Playwright browser acceptance runs under Node and uses an isolated Vite fixture.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-15-superpowers-grill-me-builtin-mission-publish.md`
- `packages/opencorvus/src/chat/capability.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/session/system.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/session/prompt/parts.ts`
- `packages/opencorvus/src/tool/skill.ts`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/composer-mention.ts`
- `packages/overlay/src/services/composer-expert-squad-catalog.ts`
- `packages/overlay/src/services/chat.ts`
- `packages/overlay/src/main.tsx`
- `packages/opencorvus/test/chat/capability-session-loop.test.ts`
- `packages/opencorvus/test/session/system-skill-directive.test.ts`
- `packages/overlay/test/composer-expert-squad-catalog.test.ts`
- `packages/overlay/test/composer-mention.test.ts`
- `packages/overlay/test/browser/composer-mention-browser.test.ts`

### Whole-Repository Search Evidence

- `rg -n "@skill|skill mention|mention.*skill|kind: \"skill\"|type: \"skill\"|skill_refs|assigned_refs|ChatCapability" packages/overlay/src packages/opencorvus/src packages/overlay/test packages/opencorvus/test`
  - The composer already renders exact `@skill("<name>")` directives and validates them against its catalog.
  - The Chat capability independently owns default `skill_refs`.
- `rg -n "panelMessage\\(|function panelMessage|export.*panelMessage" packages/overlay/src`
  - `main.tsx` has the only interactive composer calls; `services/dialog.ts` is a separate task-targeted caller and must remain unchanged.
- `rg -n "resolveSkillSurface\\(" packages/opencorvus/src packages/opencorvus/test`
  - `SessionLoop.resolveTools` is the single production caller of native `ChatCapability.resolveSkillSurface`; the focused Chat test is its direct regression surface.
- `rg -n "createComposerExpertSquadCatalogSnapshot\\(" packages/overlay/src packages/overlay/test`
  - `main.tsx` is the only production constructor call; the existing catalog tests cover its projection behavior.
- `rg -n "ComposerSubmitDirectives|resolveComposerMentionDirectives\\(" packages/overlay/src packages/overlay/test`
  - `ChatComposer` parses `skillNames`, but `ComposerSubmitDirectives` currently drops them before `main.tsx` submits the message.
- `rg -n "lastUser\\.metadata|info\\.metadata|metadata.*lastUser" packages/opencorvus/src/session packages/opencorvus/test/session`
  - Text-part metadata is persisted, but the session loop does not currently consume Skill mentions from it.

### Independent Agent Feedback

No independent agent was requested, and current execution rules do not authorize spawning one. The primary agent will perform the required second review against the exact diff and test evidence before delivery.

## Root-Cause Analysis

The observable failure is not that `grill-me` is absent. The live `/chat/capability` response proves it is installed. The failure is a broken authority handoff across three existing layers:

1. `createComposerExpertSquadCatalogSnapshot` builds the composer Skill list only from the active expert squad's `production_grants`, although native Chat does not use that projection for its Skill surface.
2. `resolveComposerMentionDirectives` correctly returns `skillNames`, but `ChatComposer` omits them from `ComposerSubmitDirectives`, so the structured exact selection is discarded.
3. `ChatCapability.resolveSkillSurface` mounts only persistent default `skill_refs`. The system prompt can tell the model that an explicit directive is mandatory, but the named Skill is absent from the real tool surface.

The repair must preserve the intended distinction: persistent default assignments enable automatic use, while visible exact mentions add only named installed Skills to one turn.

## Design

### Composer catalog

- Read the native Chat capability settings alongside the expert-squad and Mission Skill catalogs.
- Use `skills.installed` as the Chat `@skill` entity catalog. Expert-squad production grants remain the Mission/Task runtime projection and do not define native Chat mentions.
- Preserve exact Skill identities and descriptions; do not infer aliases.

### Visible directive transport

- Move exact visible-directive parsing into `@opencorvus-ai/transport-protocol` so Overlay editing and server runtime resolution use one parser.
- Keep the persisted visible `@skill("<name>")` text as the only authority. Do not add submit metadata, hidden messages, or a second transport field.
- At tool-resolution time, parse only user-authored text parts on the latest user message. Ignore system/task-tool text.

### Turn-owned Chat surface

- Resolve the union of persistent Chat `skill_refs` and validated explicit names for the current user turn.
- Deduplicate by exact Skill identity.
- Preserve existing eligibility checks for required tools, platform, permission, and Skill-tool availability.
- Do not persist explicit names. The next user turn returns to default assignments unless it contains its own visible directive.

## Call-Point Inventory and Disposition

| Call point | Disposition |
| --- | --- |
| `overlay/src/services/composer-expert-squad-catalog.ts::createComposerExpertSquadCatalogSnapshot` | Accept native Chat capability data and expose installed Skills for `@skill`; keep squad and Mission Skill behavior unchanged. |
| `overlay/src/main.tsx::refreshExpertSquads` | Load Chat capability in the existing parallel catalog refresh and pass it to the snapshot constructor. |
| `transport-protocol/src/index.ts::visibleMentionDirectiveRanges` | Provide the single exact parser used by Overlay editing and server runtime resolution. |
| `overlay/src/services/composer-mention.ts::composerMentionDirectiveRanges` | Delegate to the transport-owned exact parser; retain existing autocomplete/editing semantics. |
| `overlay/src/components/ChatComposer.tsx::ComposerSubmitDirectives/handleSubmit` | Keep existing visible text submission unchanged; do not create hidden Skill metadata. |
| `overlay/src/main.tsx::ChatComposer.onSubmit` | Keep Chat and Mission routing unchanged apart from mode-specific catalog selection. |
| `overlay/src/services/chat.ts::sessionPromptParts/panelMessage` | No change; visible user text remains the only transported authority. |
| `opencorvus/src/session/loop.ts::resolveTools/finalizeSkillSurface` | Read and validate current visible user-turn Skill mention facts and pass them to native Chat resolution only. |
| `opencorvus/src/chat/capability.ts::resolveSkillSurface` | Merge default assignments with exact current-turn explicit names, then run the existing eligibility path. |
| `opencorvus/src/session/system.ts::skills` | Keep the current mandatory explicit-directive policy; update only if wording must distinguish default and explicit turn grants. |
| `overlay/test/composer-expert-squad-catalog.test.ts` | Prove unassigned installed Skills appear in the Chat mention catalog. |
| `overlay/test/composer-mention.test.ts` | Prove exact parsed Skill names survive the composer directive result. |
| `opencorvus/test/chat/capability-session-loop.test.ts` | Prove default automatic use, exact explicit augmentation, absence of unrelated installed Skills, unknown-name rejection, and no config mutation. |
| `overlay/test/browser/composer-mention-browser.test.ts` | Use Node + Vite to select `grill-me`, inspect the exact directive, submit metadata, and visually review the current goal/region screenshot. |
| `specs/current/architecture/04-extensions.md` | Clarify native Chat default assignment versus exact turn-scoped `@skill` authority. |

## Verification Plan

1. Add failing focused backend and Overlay tests for installed-but-unassigned `grill-me`.
2. Implement the exact catalog and turn-surface repair.
3. Run focused Chat capability, composer catalog, composer mention, and system Skill directive tests.
4. Run the real Node-launched Vite browser test, inspect its goal-scoped screenshot, correct visual/interaction defects, and rerun.
5. Run package typechecks, document-health tests, `git diff --check`, and a second exact-diff review.
6. Commit with the required `dsw-33987` prefix and push `v0.0.20beta` to `myhexin` through normal hooks.

## Progress

- [x] Reproduce the live capability mismatch and identify the broken authority handoff.
- [x] Complete whole-repository call-point inventory.
- [x] Record the plan before implementation.
- [x] Add regressions.
- [x] Implement the repair.
- [x] Complete focused and visual verification.
- [x] Complete second review.
- [ ] Commit and push to git-cc.

## Verification Evidence

- `bun test test/chat/capability-session-loop.test.ts`: 3 passed; the real native Chat tool surface keeps the persistent default, adds only the exact current-turn Skill, loads its real `SKILL.md`, rejects an unknown name, and leaves config unchanged.
- `bun test test/composer-expert-squad-catalog.test.ts test/composer-mention-ui.test.ts test/expert-squad-scope.test.ts`: 34 passed.
- `bun test test/composer-mention.test.ts`: 14 passed against the shared parser.
- `bun run typecheck`: passed in `packages/transport-protocol`, `packages/overlay`, and `packages/opencorvus`.
- Node-launched Vite browser acceptance reached and passed the new Chat assertions: `/chat/capability` supplied installed-but-unassigned `grill-me`, autocomplete rendered it, and Tab inserted exact `@skill("grill-me")`.
- Visual review of `.scratch/composer-mentions/chat-installed-grill-me-light.png` confirmed the result popup is bounded, legible, aligned with the existing Composer primitives, and identifies `grill-me` as a Skill.
- The broader pre-existing browser scenario later failed in its unrelated Mission conversation phase while concurrent scheduled-automation changes were staged in the shared worktree; the Chat goal/region assertions and screenshot completed before that failure.

## Second Review

- Confirmed the installed catalog is used only for Chat autocomplete; Mission continues to use active expert-squad production grants.
- Confirmed unmentioned installed Skills never enter the server Skill surface.
- Confirmed explicit mentions use the same eligibility, permission, and real Skill-tool path as persistent defaults.
- Confirmed only latest-user, user-authored visible text is parsed; system/task-tool text cannot grant a Skill.
- Confirmed no config write, session override, synthetic message, compatibility alias, fallback, or second parser remains.
