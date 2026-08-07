# Composer Reference Selector And Model Search

## Recall

### User requirements

- Add one icon-and-text button beside the Composer Code / Work mode selector.
- The button must open a multi-select surface for Skills and Agent Squads and support fuzzy name search.
- Remove the model Popover title, add fuzzy name search, and reduce model-row height.
- While a conversation is active, keep showing the active Agent Squad when one exists; otherwise show the
  same reference-selector icon.
- Clicking the active-conversation affordance must show the Skills and Agent Squads selected before that
  conversation started, but the active surface must be strictly read-only.
- The supplied reference image is
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-0af1e306-0a13-416f-85b7-79f7fc9f192d.png`.

### Acceptance criteria

- A new Code / Work / Mission launch exposes one compact `Skills & Agent Squads` control beside the existing
  mode selector; the control uses the shared Icon, Button, Popover, SearchField, and Checkbox primitives.
- The selectable surface supports multiple ordinary Skills, Mission Skills, and Agent Squads.
- Search uses the existing `fuzzysort` dependency over displayed Skill and Agent Squad names; it is not a
  hand-written keyword or substring gate.
- Selection remains visible conversation content: the control reads and writes the existing
  `@skill("...")`, `@mission("...")`, and `@squad("...")` directives in the Composer text. No hidden
  message, shadow selection field, or second runtime capability source is introduced.
- Multiple Agent Squad directives route one Mission wake with the exact ordered, unique manifest IDs.
- An active conversation keeps the current active-Squad label when one is available and otherwise renders
  the same selector icon. Both forms open the same launch-reference presentation in read-only mode.
- The read-only content is projected from the first user-authored visible message of the active Session; it
  does not infer from the title, current global configuration, or mutable catalog state.
- The model Popover has no title/hint header, begins with a fuzzy-search field, filters by full model ID and
  Provider identity, clearly reports no matches, and retains the canonical Configure Provider terminal action.
- Model rows use a compact control rhythm without reducing their readable label, selected check, keyboard
  navigation, focus treatment, or pointer target below the shared compact-density contract.
- A real desktop page is opened and the new-request selection, fuzzy Skill/Squad search, multi-selection,
  model fuzzy search, compact model rows, active-Squad read-only view, and no-active-Squad icon view are
  interacted with, captured, and personally inspected. No User Interface (UI) automated test is added,
  modified, updated, or run.

### Hard constraints

- Root `AGENTS.md` applies.
- `prompt_profile.active` remains the only active Task Agent Squad identity. Mission-visible Agent Squad IDs
  remain recommendation scope, not a second active profile.
- Preserve the visible-reference protocol and the current structured-reference-first Mission routing.
- Reuse mature primitives and the repository-owned `fuzzysort` dependency.
- Do not add a Host route gate, state machine, hidden message, synthetic message, compatibility path,
  fallback catalog, or parallel selection persistence.
- Do not modify the unrelated dirty benchmark catalog already present in the worktree.
- Do not create a worktree. Browser acceptance must use Node.js, never Bun.
- Delete directly encountered UI automation tests that assert the changed model Popover or Composer
  reference-selection presentation, without running them.
- New commit subjects begin with `dsw-33987`; push each task checkpoint and the completed delivery to
  `myhexin`.

### Hard-disk sources read

- `AGENTS.md`
- the user-supplied screenshot
- `specs/current/architecture/17-code-work-agent-platform.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-27-chat-explicit-skill-mention.md`
- `specs/records/2026-07/2026-07-29-global-composer-mission-reference-routing.md`
- `specs/records/2026-07/2026-07-29-composer-conversation-context-flags.md`
- `specs/records/2026-07/2026-07-29-composer-model-selection-and-multica-import.md`
- `specs/records/2026-07/2026-07-30-composer-mention-pill-atomic-editing.md`
- `packages/transport-protocol/src/index.ts`
- `packages/overlay/src/components/{ChatComposer,ComposerModelSelector,ComposerMentionMenu}.tsx`
- `packages/overlay/src/components/ui/{Button,Checkbox,Icon,Listbox,Popover,SearchField}.tsx`
- `packages/overlay/src/services/{composer-mention,composer-submit-route,composer-expert-squad-catalog}.ts`
- `packages/overlay/src/{main,store/board,store/conversation-session}.ts`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/opencorvus/src/{chat/identity,chat/session,mission/schema,mission/session,session/loop}.ts`
- `packages/opencorvus/src/server/routes/{global,mission,right-sidebar-conversation,session}.ts`
- `packages/opencorvus/src/engine/model.ts`

### Whole-repository grep result

Repository-wide searches covered `ChatComposer`, `ComposerModelSelector`, `model_selector`,
`composerModel`, `visibleMentionDirectiveRanges`, `resolveComposerMentionDirectives`,
`resolveComposerSubmitRoute`, `expertSquadIDs`, `missionSkillNames`, `prompt_profile.active`,
`SessionConversationHydration`, `SessionBoardEnvelope`, `createConversationSession`,
`createGlobalConversationSession`, `wakeMission`, `missionVisibleExpertSquadIDs`, every current
Composer context flag, the shared search/checkbox/listbox/popover primitives, all `fuzzysort` imports,
and the directly relevant UI tests.

| Owner / call site | Evidence | Disposition |
| --- | --- | --- |
| `transport-protocol:visibleMentionDirectiveRanges` | One shared parser already recognizes visible Skill, Mission Skill, and Agent Squad directives. | Add one ordered, deduplicated launch-reference projection beside the parser so frontend and backend consume the same visible facts. |
| `composer-mention.ts` | Mention autocomplete already validates exact catalog identity, supports multiple Skills, and currently rejects more than one Squad. | Keep strict validation and visible syntax; return an ordered `squadIDs` list instead of a single ID. |
| `ChatComposer.tsx` | The new-request row owns mode choice; the active row owns mode and active-Squad flags; submission clears the same text draft after persistence. | Mount one shared reference Popover in selectable mode for new requests and read-only mode for active conversations; selection edits the current text directives. |
| `composer-submit-route.ts` | Explicit Squad and Mission Skill references route before Chat/Work creation, but the route type admits only one Squad tuple. | Preserve routing order and carry the complete ordered Squad list to the existing Mission wake input. |
| `main.tsx` | The reference catalog, active Squad, selected source, Session hydration board, and Mission wake are already assembled here. | Pass the projected launch references to the Composer and forward all explicit Squad IDs through `wakeMission`. |
| `session.ts` conversation hydration | The server already loads the complete visible Session transcript and creates one strict `SessionBoardEnvelope`. | Project the first user message's visible launch references into the board envelope; do not persist a duplicate metadata field. |
| task board | A Task already carries its canonical request text and metadata. | For an active Task, derive the same launch-reference projection from `board.task.request`; add no new Task field. |
| `ComposerModelSelector.tsx` | One Popover owns Provider groups, model rows, selection, and Configure Provider. Its decorative header consumes the requested excess vertical space. | Replace the header with the shared compact SearchField and fuzzy-filtered Provider groups; keep selection and terminal action ownership unchanged. |
| `composer.css` | Model rows have a fixed 44-pixel scaled minimum plus 24-pixel icon tiles and a large decorative header. | Use the shared compact-density rhythm, smaller icon tile, compact group padding, and dedicated reference-Popover styles. |
| `fuzzysort` | Version `3.1.0` is already a root workspace dependency and used by backend catalog/search owners. | Add one small typed Overlay adapter reused by model-ID/Provider search and displayed reference-name search; do not add another dependency or hand-written matcher. |
| directly encountered UI tests | Static source/CSS assertions and browser fixtures cover the model Popover title, model-row presentation, and Composer Squad selection flow. | Delete the directly affected UI test files without running them, per the UI automation prohibition. Preserve and update only pure service/protocol positive tests. |

### Independent-agent feedback

- No sub-agent was requested, so no sub-agent was used.

## Causal chain

The Composer already has a complete visible reference protocol, but it is exposed only through text
autocomplete. The toolbar has no discoverable multi-select owner, so users must know and type the
syntax. Adding a second selected-items store would make the toolbar and visible message disagree.
The correct boundary is therefore a graphical editor over the existing text directives.

The one-Squad limit is not a Mission limitation: `MissionVisibleExpertSquadIDs` and
`POST /mission/wake` already accept an ordered unique array. The restriction exists only in the
Overlay directive resolver and submit-route tuple, so it must be removed there rather than adding a
new route.

The active Composer currently knows only the mutable effective Squad catalog. It can display the
active Squad but cannot answer what was selected before the conversation began. The persisted first
user message is the durable visible source for that fact. Projecting its references into the existing
Session hydration board makes the UI reload-safe without another database field.

The model Popover height comes from two independent layout choices: a decorative title/hint header
and 44-pixel rows with 24-pixel icon tiles. Removing the requested header alone does not fix row
density; the row and group metrics must also converge on the shared compact rhythm. Search belongs in
the freed header area and can reuse the existing SearchField and `fuzzysort`.

## Implementation plan

1. Add the shared visible launch-reference projection and one reusable typed `fuzzysort` adapter.
2. Extend strict Composer directive resolution and Mission routing to ordered multi-Squad input.
3. Implement one `ComposerReferenceSelector` using shared primitives: selectable mode edits visible
   directives; read-only mode renders the projected launch references without interactive controls.
4. Mount the selector beside Code / Work for new requests and replace the active conversation Squad
   flag/no-flag branch with the same read-only Popover trigger while retaining the active Squad label.
5. Extend Session conversation hydration with the first-user-message projection and derive Task
   launch references from the existing Task request.
6. Replace the model title/hint header with fuzzy search, filter Provider groups through the shared
   adapter, and compact the group/row metrics.
7. Add exact English and Chinese copy, delete the directly affected UI automation tests without
   running them, and add/update only pure positive protocol/service tests.
8. Regenerate OpenAPI/SDK/docs if the strict hydration schema changes, then run focused non-UI tests,
   typecheck, i18n, build, route/docs checks, and documentation-health checks.
9. Start an isolated real page, interact with every requested state, capture task-scoped screenshots,
   inspect them, and correct visual or interaction defects.
10. Re-read the final diff and screenshots, fetch/converge, commit only task-owned paths, push to
    `myhexin`, and verify local/remote convergence.

## Progress

- [x] Capture the request, screenshot, constraints, prior decisions, causal chain, and exhaustive call sites.
- [x] Implement shared visible launch-reference and fuzzy-search contracts.
- [x] Implement multi-select and read-only Composer reference surfaces.
- [x] Implement multi-Squad Mission routing and Session hydration projection.
- [x] Implement the compact searchable model Popover.
- [x] Complete focused non-UI, type, build, generated-contract, i18n, and documentation checks.
- [x] Complete real-page interaction, screenshots, and personal visual review.
- [x] Complete second source/evidence review, commit, push, and remote convergence.

## Visual acceptance evidence

The production Overlay was built and served through the real OpenCorvus server at
`http://127.0.0.1:47891/ui/` with an isolated `OPENCORVUS_HOME` and project. No User Interface (UI)
test or visual assertion script was created or run.

- `specs/artifacts/2026-07-30-composer-reference-selector.png`: selectable launch surface with shared
  primitives and visible-reference multi-selection.
- `specs/artifacts/2026-07-30-composer-reference-name-search.png`: `grl` fuzzy-name query reduces the
  catalog to `grill-me` and the fuzzy-matching `Builtin/General`, while unrelated Skills disappear.
- `specs/artifacts/2026-07-30-compact-model-search.png`: removed title/hint, compact 34-pixel model
  rows, and `g56sl` fuzzy query resolving `openai/gpt-5.6-sol`.
- `specs/artifacts/2026-07-30-conversation-launch-references-read-only.png`: an active conversation
  retains its `Builtin/General` trigger and renders the launch-time Skill and Agent Squad without
  Checkbox or SearchField controls.
- `specs/artifacts/2026-07-30-conversation-launch-references-no-active-squad.png`: the same persisted
  conversation under an isolated unresolved-active-profile condition renders the icon-only trigger;
  its Popover still reads `grill-me` and `general` from the first visible user message.

The Mission was reselected after a server restart before the read-only check, so this evidence covers
Session hydration from durable transcript content rather than only the immediate in-memory projection.
The screenshots were opened and personally inspected for hierarchy, clipping, spacing, target density,
search result integrity, and selectable versus read-only semantics.

## Verification evidence

- `bun test test/composer-mention.test.ts test/composer-submit-route.test.ts test/fuzzy-search.test.ts`
  in `packages/overlay`: 23 passed.
- `bun test test/visible-composer-references.test.ts` in `packages/transport-protocol`: 1 passed.
- `bun test test/server/conversation-launch-references.test.ts` in `packages/opencorvus`: 1 passed.
- `bun run typecheck` in `packages/overlay`, `packages/opencorvus`, and `packages/sdk/js`: passed.
- `bun run build:vite` in `packages/overlay`: passed against the final source.
- `bun run build` in `packages/sdk/js`: passed and regenerated the OpenAPI client contract.
- `bun run api:routes-check`: passed with 6 rules across 33 route files.
- `bun run docs:check`: passed with 311 operations across 24 groups.
- `bun run overlay:i18n-check`: passed.
- Historical links and product documentation single-source tests: 10 passed.
- The focused active dispatch/lifecycle document-health test: 1 passed after the initial concurrent
  five-second timeout was isolated and rerun.
- `git diff --check`: passed.

The first broad document-health run also found a stale negative test that read a deleted browser
fixture. The complete retired-executor absence test was deleted instead of retaining a missing-file
compatibility path; this follows the repository's prohibition on negative tests. Directly encountered
UI source assertions and browser fixtures were likewise deleted without running those UI tests.

The implementation commit is `c474c75a58`; it was merged with the latest `myhexin/v0.0.26beta` in
`e3740d5da0`. The pre-push hook passed full workspace typecheck, route inventory, documentation
generation consistency, Overlay internationalization, and secret scanning before the remote accepted
the branch.
