# Composer Skill and Expert-Squad Mentions

## Recall

### User request

- The shared composer must support `@skill` and `@squad` entity completion.
- Typing `@` or the corresponding entity keyword must list selectable options; Arrow Up / Arrow Down must move the active option.
- Selecting `@skill` must force the exact Skill to be loaded.
- Selecting `@squad` must route the request into a new Mission started with the exact expert squad.
- Explicit mentions are additive entry points: they must not prohibit the runtime from using other Skills or later expert-squad routing when the task needs them.
- Resource use and responsiveness must remain balanced.
- The mention surface must use the existing Composer visual language and design philosophy.
- After selection, each exact Skill or Squad directive is one atomic Composer entity: caret navigation skips its interior and Backspace / Delete removes the complete entity rather than corrupting its identity.

### Acceptance criteria

- `@` offers Skill and Expert Squad categories; `@skill` and `@squad` offer exact current-scope entities with name/description rows.
- Suggestions come from the current-scope expert-squad catalog: Squad rows use `squads`, while Skill rows use the same response's Resolver-owned `active_skill_projection.production_grants`. A project/session scope change refreshes that one catalog once; typing and keyboard navigation perform no network request.
- Matching precomputes normalized option text, renders a bounded result set, and performs no timer-driven or per-character background work while the popup is closed.
- Arrow Up / Arrow Down wrap through options; Enter and Tab select; Escape closes; Enter keeps its existing send behavior when no suggestion is open; Input Method Editor (IME) composition remains uninterrupted.
- Selection inserts visible, exact, parseable directives: `@skill("<exact-name>")` and `@squad("<manifest-id>")`. No hidden message, synthetic prefix, alias, fuzzy identity guess, or metadata-only instruction is created.
- The visible directive text is also the sole atomic-editing source. Arrow Left / Arrow Right skip a directive, mouse/caret placement snaps to a boundary, and Backspace / Delete or a partially intersecting selection removes the complete directive in one edit. No parallel chip model or hidden token state is introduced.
- A submitted Skill directive must name a current projected production Skill. The generated Skill policy requires the receiving agent to load each explicitly named Skill before planning or execution, while still allowing additional relevant Skills.
- A submitted Squad directive must name exactly one catalog manifest `id`. It starts a new Mission through the existing `mission.wake` contract with that `promptProfile`, even when the composer currently shows an existing Task or Session. `prompt_profile.active` remains the sole active expert-squad source and `PromptProfileResolver` remains the sole projection source.
- Multiple explicit Skill directives are allowed. Multiple distinct Squad directives are rejected as contradictory because one Mission has one active `prompt_profile.active`; the UI must not guess an order.
- The popup reuses Kobalte Listbox semantics and existing Composer material, typography, spacing, radius, hover, selected, focus, and elevation tokens. It must not introduce a command-palette or branded visual island.
- Focused parser/ranking/routing/prompt tests, Overlay typecheck/i18n/build, Node-started real browser keyboard interaction, Mission request evidence, screenshot inspection in light and dark themes, docs health, `git diff --check`, and a second review pass all pass.
- Do not restart, refresh, close, or otherwise alter the user's running OpenCorvus / Overlay process; visual acceptance uses an isolated browser target.

### Hard constraints

- Follow root `AGENTS.md`: no fallback or compatibility branch, no double source, no gate used to hide routing defects, no blind patch, no Git reset, tests for every code change, real screenshot review, and post-test second review.
- Skill selection behavior is a prompt-level execution contract over the real visible directive, not a host-side workflow state machine or an invisible pre-executed tool call.
- Expert-squad identity comes only from manifest `id`; package directory, namespace, display label, selector name, and similar names never determine routing.
- Non-`general` squads remain project packages; no built-in profile, alias, second active field, inactive package scan, or UI-only filter is added.
- Playwright on Windows is started by Node, never Bun. Browser waits use activity-reset inactivity timeout through the repository runner.
- Existing unrelated auth/plugin modifications and the dashboard draft remain untouched.
- Commit subjects use the `dsw-33987` prefix and delivery targets `legacy-remote/v0.0.4beta` without bypassing hooks.

### Hard-disk sources read before implementation

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-05-expert-squad-skill-projection-completeness.md`
- `specs/records/2026-07/2026-07-08-chat-default-mission-forwarding-receipt.md`
- `specs/records/2026-07/2026-07-12-composer-runtime-controls-redesign.md`
- `specs/records/2026-07/2026-07-14-overlay-composer-ime-interruption-root-repair.md`
- `specs/records/2026-07/2026-07-15-composer-authority-and-goal-vertical-fill.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/{extensions,expert-squad,expert-squad-scope,chat,mission}.ts`
- `packages/opencorvus/src/server/routes/{skill,expert-squad,mission,session}.ts`
- `packages/opencorvus/src/skill/{skill,mounts,name}.ts`
- `packages/opencorvus/src/tool/skill.ts`
- `packages/opencorvus/src/session/system.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- Focused Overlay and OpenCorvus unit/browser tests named below.
- `opencorvus-expert-squad-creator` Skill and its required expert-squad checklist.
- `browser:control-in-app-browser` Skill for the later isolated visual review.

### Whole-repository search evidence

Commands:

- `rg -n "ChatComposer|onSubmit|onKeyDown|prompt_profile|promptProfile|ExpertSquad|expert-squad|Skill\\.list|skill/mounts|mission/wake" packages/overlay/src packages/opencorvus/src packages/overlay/test packages/opencorvus/test`
- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
- `rg -n "SkillTool|SystemPrompt\\.skills|available_skills|load.*skill|production_skill_names|projected_skill_names" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "missionSubmitActive|wakeMission|panelMessage|prompt_async|TaskMessageInput|promptProfile" packages/overlay/src packages/opencorvus/src packages/overlay/test packages/opencorvus/test`
- `rg -n "@kobalte/core/(combobox|listbox|popover)|Listbox\\.|Popover\\.|composer-intent|composer-attachment-menu" packages/overlay/src packages/overlay/test`
- `rg -n "@skill|@squad|mention|forced.*skill|required.*skill" specs packages/overlay packages/opencorvus`

Findings and call-site dispositions:

| Owner / call site | Current evidence | Decision |
| --- | --- | --- |
| `ChatComposer.tsx` | One shared `AutoGrowTextarea` owns Chat, Task, Session, and Mission-launch input; its key handler already protects IME and Enter-to-send. | Add one mention query/selection surface around the same textarea; preserve draft, attachment, resize, selector, and IME owners. Treat exact visible directive ranges as atomic at the existing keyboard/selection seam, without adding a second chip state. |
| `composer-routing-prefix.test.ts` | Rejects hidden `@team` / `@agent` prefill and synthetic routing prefixes. | Preserve prefix-free drafts; distinguish user-authored, visible entity directives from hidden routing text. |
| `loadExpertSquadCatalog` + main composer signals | Catalog loading is already scope-keyed, in-flight deduplicated, and manifest-ID based; the same Resolver-owned response contains `squads` and `active_skill_projection.production_grants`. | Reuse that one response for both entity kinds; do not add a `/skill/mounts` request, scan package directories, or create another catalog. |
| `main.tsx` composer submit | Mission launch currently depends on toolbar mode and only starts when no Task/Session is selected. | An exact Squad directive is an explicit new-Mission request and invokes the same `wakeMission`/`openMissionSession` path regardless of the currently displayed conversation. |
| `mission.wake` | Validates `promptProfile`, writes the session config overlay, and wakes the real Mission session. | Keep this route and `prompt_profile.active` as the only Squad activation path; no new Squad field or route. |
| `SystemPrompt.skills` + `SkillTool` | The runtime already publishes mounted Skills and loads exact names through the visible `skill` tool. | Add the explicit visible-directive policy: load every named current Skill first, then retain ordinary search/additional-Skill discretion. |
| `SkillMount.matrix` | Resolver-owned matrix remains the Settings/operator mount surface, but Composer catalog loading already has the exact active production grants. | Leave it unchanged; autocomplete must not add a second request or scan/import/mount inactive package Skills. |
| Composer CSS and Kobalte primitives | Existing dropdowns use the shared menu material, radius, hover wash, type scale, focus ring, and Listbox behavior. | Build the mention popup with Kobalte Listbox semantics and those tokens; no bespoke visual system. |
| Overlay browser runner | Node starts Playwright and already records task-scoped composer screenshots. | Add one isolated real-page test for category/entity completion, keyboard selection, exact inserted text, `mission.wake` body, and light/dark screenshots. |

### Independent-agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids spawning one otherwise.

### Baseline delivery evidence

- Before implementation, `v0.0.4beta` was one commit ahead of `legacy-remote/v0.0.4beta`.
- The required baseline push ran the repository pre-push hook. Typecheck passed, but `api:routes-check` rejected generated OpenAPI drift caused by pre-existing uncommitted auth/plugin changes (`Auth.ApiAuth.metadata`, `OAuth.enterpriseUrl`, and related plugin contract changes).
- Those unrelated files are preserved and excluded from this task. The failed push is not represented as successful delivery and will be retried after implementation.

## Root design

The feature is an explicit-language input contract, not a second routing engine.
The textarea inserts exact visible directives and the backend continues to use
its existing authorities:

1. The current Resolver-derived catalogs supply exact entity identities.
2. The visible Skill directive tells the receiving agent to invoke the existing
   exact-name `skill` tool before work.
3. The visible Squad directive gives the existing Mission wake call its exact
   manifest ID, which becomes the session's existing `prompt_profile.active`.
4. Ordinary Skill discovery and later LLM expert-squad decisions remain
   available; the directives add mandatory initial intent without constructing
   an exclusive allow-list.

The autocomplete performs no network work. A pure grammar module owns active
query detection, exact directive serialization/parsing, stable bounded ranking,
and contradictory-directive validation. `ChatComposer` owns only ephemeral
interaction state (open query and highlighted row), while catalogs and runtime
selection remain outside the component.

## Implementation plan

1. Add the pure mention grammar/ranking module and focused tests covering category/entity queries, exact JSON-string identity encoding, atomic directive ranges/edits, insertion, bounded ranking, unknown entities, multiple Skills, and contradictory Squads.
2. Add the Kobalte Listbox suggestion surface to the shared Composer, wire keyboard/pointer selection and atomic caret/deletion behavior without breaking IME/drafts/Enter-to-send, and add bilingual strings plus design-token CSS.
3. Project unique current production Skill metadata from the already scope-keyed expert-squad catalog response into the Composer; do not add a second catalog request.
4. Route exact Squad directives through the existing new-Mission wake path from every current center-panel context; keep the toolbar selector behavior unchanged for non-mention submissions.
5. Extend the runtime Skill policy and tests so an explicit exact Skill directive is loaded before execution without excluding other relevant Skills.
6. Run focused unit/integration tests, Overlay typecheck/i18n/build, Node browser interaction and screenshots, inspect both themes, iterate on visual defects, then run docs health and `git diff --check`.
7. Re-read this Recall, review the final diff independently, correct any discrepancy, commit only task-owned files, and retry legacy remote push without bypassing hooks.

## Progress

- [x] Read hard-disk plans, architecture, skills, and current code before edits.
- [x] Inventory the full input/catalog/Skill/Mission call chain.
- [x] Record the implementation design and acceptance criteria.
- [x] Implement pure mention contracts and tests.
- [x] Implement atomic directive editing, Composer interaction, and exact Mission routing.
- [x] Implement the explicit Skill-load prompt contract.
- [x] Complete rendered browser acceptance and screenshot review.
- [x] Complete second review, commit, and legacy remote delivery.

## Verification evidence

- `bun test` focused Composer, Mission client/session, routing-prefix, draft, shared-textarea, and Skill-policy suite: 80 passed, 0 failed.
- Overlay and OpenCorvus TypeScript checks passed; Overlay i18n health passed.
- Node-started visible browser acceptance passed with exact category/entity keyboard selection, focus retention, atomic Arrow Left / Arrow Right / Backspace behavior, unchanged catalog/mount request counts while typing, an exact `promptProfile: "frontend-replica"` Mission wake body, and successful session conversation hydration.
- Light and registered dark-theme screenshots were inspected at 1440×900. The popup follows the existing Composer menu material, token radius, typography, row density, selected accent, and elevation in both themes.
- The broader legacy `packages/opencorvus/test/mission/wake-route.test.ts` run did not provide valid additional evidence: its Windows process-supervisor Git helpers repeatedly exited before readiness and caused unrelated 500/5-second timeout failures. The task-owned browser fixture exercised the real Overlay Mission client request and successful post-wake session hydrate without mocked UI state.
- legacy remote accepted the rewritten all-`dsw-33987` incoming history after the full pre-push hook passed. Concurrent checkpoint `5982bdcfac` contains the same task-file tree as the reviewed atomic-mention commit.
