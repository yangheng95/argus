# Global Composer Mission Reference Routing

## Recall

### User requirements

- Explain and repair why Code and Work do not reliably route explicit Agent Squad and Mission Skill references to Mission.
- In both Code and Work, an exact visible `@squad("<manifest-id>")` or `@mission("<exact-name>")` reference must start Mission directly.
- Preserve semantic Chat/Work-to-Mission recommendation for ordinary natural-language requests; do not add a Host keyword classifier.

### Acceptance criteria

- The directory-free New Chat launcher discovers built-in and user-global Agent Squads and Mission Skills without creating a Project, Session, or Chat.
- A project/session Composer keeps using its canonical project-aware catalog.
- Exact `@squad` and `@mission` references resolve before Chat/Work persistence and call the existing `POST /mission/wake` path exactly once.
- Mission Skill-only submission leaves the Mission Squad recommendation catalog unrestricted; an explicit Squad submits only that exact manifest ID.
- The original visible message, attachments, selected model, and Mission Session navigation are preserved.
- Ordinary Code and Work messages continue through their current conversation routes.
- Explicit natural-language requests to use Mission are treated as sufficient authority by the Chat and Work prompts and continue through the existing visible `panel.wake_mission` confirmation.
- No Project or database row is created merely by opening New Chat or loading the global reference catalog.
- Positive backend/service contracts, typecheck/build, isolated real-page interaction, screenshots, and a second review pass succeed.

### Hard constraints

- Preserve all unrelated staged and unstaged worktree changes.
- Do not restart, refresh, close, or operate the running OpenCorvus process or its live Overlay.
- Do not create a fallback catalog, temporary Project, hidden message, synthetic route, keyword gate, second active Squad field, or inferred identity.
- `prompt_profile.active` remains the only Task Expert Squad identity. Mission itself has no active Expert Squad.
- Do not add, modify, update, or run UI automation tests. Delete the directly encountered obsolete Composer/Mission UI tests and use isolated real-page interaction plus manual screenshot review.
- New commits use the `dsw-33987` prefix and push through normal hooks to `legacy-remote`.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-25-mission-directive-syntax.md`
- `specs/records/2026-07/2026-07-29-code-work-composer-and-grouped-references.md`
- `specs/records/2026-07/2026-07-29-global-new-chat-lazy-project-persistence.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/{composer-mention,composer-expert-squad-catalog,expert-squad-scope,expert-squad,mission-skill,mission}.ts`
- `packages/opencorvus/src/server/routes/{global,mission,mission-skill,expert-squad}.ts`
- `packages/opencorvus/src/{mission-skill/catalog,mission-skill/roots,expert-squad/registry,expert-squad/prompt-profile-resolver}.ts`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/opencorvus/src/work/harness.ts`
- Read-only live process, SQLite Session/Message/Part evidence, and packaged-runtime timestamps.

### Full-repository grep

| Surface                              | Findings                                                                                                                                                                 | Decision                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `resolveComposerMentionDirectives`   | Exact Mission Skill and Squad directives parse correctly and validate against the current Composer catalog.                                                              | Keep the strict visible syntax and identity validation.                                                                 |
| `ChatComposer.onSubmit` / `main.tsx` | Structured Mission references are checked before the Chat/Work creation branch and call `wakeMission`.                                                                   | Preserve this ordering; supply a real global catalog so the branch becomes reachable from New Chat.                     |
| `expertSquadCatalogScope`            | Returns `unavailable` when the directory-free launcher has no `activeDirectory`; the reactive loader therefore exposes an empty catalog.                                 | Add an explicit global Composer catalog scope rather than creating a Project early.                                     |
| Expert Squad discovery               | `ExpertSquadRegistry` already merges global and project locations; `PromptProfileResolver.recommendationCatalog` already produces the canonical Mission-visible summary. | Factor the existing discovery owner so the global route reads built-in plus user-global locations only.                 |
| Mission Skill discovery              | `MissionSkillCatalog` currently scans built-in, global, and `Instance.directory` project roots through one instance state.                                               | Reuse one parser/duplicate-isolation implementation with an explicit root set; add a built-in plus global summary path. |
| `GlobalRoutes`                       | Owns directory-free Chat/Work creation, configuration, providers, and other no-project control-plane reads, but has no Composer reference catalog.                       | Add one read-only global Composer reference endpoint returning the two canonical catalogs together.                     |
| `wakeMission` / `/mission/wake`      | Preserves text, attachments, model, exact visible Squad IDs, Mission identity, and real Mission Session wake.                                                            | Reuse unchanged.                                                                                                        |
| `panel.wake_mission`                 | Owns semantic Chat/Work recommendation, visible confirmation, caller lineage, attachment replay, and handoff.                                                            | Keep as the only natural-language/inferred routing mutation; strengthen explicit-user-intent prompt wording.            |
| UI automated tests encountered       | Composer mention, Expert Squad selector, Mission launcher, global New Chat, and project New Chat suites assert rendered/source UI behavior.                              | Delete them without running them, per the repository-wide UI automation prohibition.                                    |

### Independent-agent feedback

- No sub-agent was requested or used.

## Causal chain

The direct Mission submission branch is present and the exact directive parser is
correct. The failure begins earlier: New Chat intentionally has no active
directory until the first valid submission, while the Composer reference loader
requires an active project/session directory. It therefore publishes an empty
Squad and Mission Skill catalog. The mention menu cannot offer those objects, and
manually typed exact directives fail strict validation as unknown before
`main.tsx` can reach `wakeMission`.

The later `createGlobalMissionProject()` call cannot repair this because it is
correctly placed at the first real Mission submission boundary, after directive
resolution. Creating that Project while opening New Chat or typing `@` would
reintroduce the empty-project persistence defect.

## Implementation plan

1. Factor Expert Squad discovery so one canonical implementation can enumerate
   built-in plus user-global packages without a project location.
2. Factor Mission Skill catalog loading so the same strict parser and duplicate
   isolation can produce built-in plus user-global summaries without
   `Instance.directory`.
3. Add one read-only `/global/composer-references` endpoint with a strict response
   containing both canonical catalogs and their isolated issues.
4. Add the Overlay global reference loader and make the directory-free Composer
   use it; retain the existing project/session catalog path everywhere else.
5. Preserve structured-reference-first submission and strengthen Chat/Work
   prompts for explicit natural-language Mission requests.
6. Delete the directly encountered UI automation files without running them.
7. Add positive non-UI service/route contracts, regenerate SDK/OpenAPI/docs,
   run typecheck/build, then inspect Code and Work reference routing in an
   isolated real page with screenshots.
8. Review the exact diff and staged-path ownership, commit only this task through
   a current-HEAD temporary index, push normally to `legacy-remote`, and verify remote
   convergence.

## Implemented

- `ExpertSquadRegistry` and `PromptProfileResolver` now expose one global-only
  discovery projection built from the canonical built-in and user-global roots.
- `MissionSkillCatalog` now reuses one strict loader for project-aware and
  global-only summaries.
- `GET /global/composer-references` returns both catalogs without project input.
- The Overlay selects that global catalog only for the connected,
  directory-free Composer; project and Session contexts keep their existing
  project-aware catalog.
- One pure submit-route resolver maps exact Agent Squad and Mission Skill
  references to Mission before the Code/Work conversation branch. Mission
  Skill-only submission omits a Squad filter; an exact Squad carries only that
  identity.
- Chat and Work prompts now treat the user's explicit Mission request as
  authority to invoke the existing visible `panel.wake_mission` confirmation.
- The encountered Composer/Mission UI automation suites were removed without
  running them.
- SDK, OpenAPI, public API docs, and the current Panel architecture were updated
  to the new single-source contract.

## Verification

- Positive contracts:
  `bun test packages/opencorvus/test/agent/mission-handoff-prompt.test.ts packages/opencorvus/test/server/global-composer-references.test.ts packages/overlay/test/composer-submit-route.test.ts`
  — 6 passed, 0 failed.
- Type checks: OpenCorvus, Overlay, and JavaScript SDK all passed.
- Build and generated contracts: Overlay Vite build, SDK build,
  `api:routes-check`, `docs:check`, and Overlay i18n check all passed.
- Documentation health: historical links passed. The document-health suite had
  62 passing checks and one expected pre-commit index check because this record
  was not yet tracked; it must pass after the task commit stages this file.
- Real-page acceptance used the source server and production Vite bundle against
  a disposable `OPENCORVUS_HOME` and database on port 7889. After opening the
  directory-free New Chat, both Code and Work displayed
  `mirror-prism-cluster` under Mission Skill and `Builtin/General` under Agent
  Squad. Selecting the Mission Skill inserted the complete
  `@mission("mirror-prism-cluster")` reference. Screenshots were inspected
  manually; the menu hierarchy, labels, selection state, and Code/Work pressed
  state were clear, and the inspected tab reported no console errors.

## 2026-07-30 regression addendum

### Recall

- User evidence shows the directory-free `@` menu contains only Mission Skill
  and Agent Squad rows; ordinary Skills are absent.
- User evidence also shows a submitted `@squad("general”)` request continuing
  as a Chat turn instead of opening Mission.
- Read-only persisted evidence identifies the exact submitted text as
  `@squad("general”) ...`: the opening quote is ASCII while the closing quote
  is the typographic right quote `”`.
- Acceptance now requires the directory-free catalog to expose built-in and
  user-global ordinary Skills alongside Mission Skills and Agent Squads.
- ASCII and typographic double quotes are both first-class delimiters for the
  same structured `@skill`, `@mission`, and `@squad` grammar. A malformed
  reserved reference must return an explicit Composer error instead of silently
  becoming ordinary Chat text.
- Real-page acceptance must select and submit an ordinary Skill, a Mission
  Skill, and an Agent Squad through the production Composer. Mission Skill and
  Agent Squad submissions must produce real Mission sessions; ordinary Skill
  submission must remain a Code/Work conversation with its exact visible
  directive.
- Preserve the currently dirty interactive-artifact, attachment-store, locale,
  Panel architecture, and spec-index changes owned by parallel work. Do not
  restart or operate the live Overlay.

### Updated whole-repository call-point audit

| Surface                                        | Evidence                                                                                                                                                             | Decision                                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createGlobalComposerReferenceCatalogSnapshot` | The global branch writes both `skills` and `chatSkills` as empty arrays.                                                                                             | Return the same canonical built-in and user-global Skill summaries from `/global/composer-references` and project them into both Code and Work reference lists.                                           |
| `Skill.state` / `SkillManager.installed`       | The parser and duplicate isolation are canonical, but the instance state merges project discovery and therefore cannot be called directly by a directory-free route. | Factor the existing loader around an explicit optional project scope; global loading keeps built-in, home-level, global config, configured path, and configured URL sources while omitting project roots. |
| `visibleMentionDirectiveRanges`                | The shared grammar accepts only ASCII JSON quotes, so `@squad("general”)` yields no directive.                                                                       | Parse ASCII or typographic double-quote delimiters in the same shared structured grammar and return the canonical value.                                                                                  |
| `resolveComposerMentionDirectives`             | A reserved `@skill(`/`@mission(`/`@squad(` prefix with invalid delimiters produces zero directives and silently reaches ordinary submission.                         | Validate every reserved reference candidate against parsed ranges and raise an explicit malformed-reference error before routing.                                                                         |
| `ChatComposer.handleSubmit` → `main.tsx`       | When a directive is present, `resolveComposerSubmitRoute` correctly chooses `wakeMission`; the persisted failing turn contained no parsed directive.                 | Keep the Mission branch; repair the shared parser/catalog inputs and prove the full real submit chain rather than adding another route.                                                                   |

### Updated implementation and verification plan

1. Add a global-only Skill catalog projection by factoring the canonical Skill
   loader, not by scanning through a fabricated Project.
2. Add Skill summaries to the strict global Composer response and generated
   SDK, then project them as Code/Work mention options.
3. Extend the shared structured-reference parser for typographic double quotes
   and explicit malformed-reference errors.
4. Add positive parser, catalog, route, and submit contracts; do not add or run
   UI automation tests.
5. Regenerate SDK/OpenAPI/docs, run typecheck/build/document checks, then use an
   isolated real server, database, and page to submit all three reference types
   and manually review screenshots.

### Regression repair result

- The directory-free catalog now exposes the canonical ordinary Skill catalog
  alongside Mission Skills and Agent Squads. Global discovery includes built-in,
  home-level external, and global-config Skills without manufacturing a Project
  instance.
- Ordinary Skill discovery excludes the global Mission Skill root directly and
  consults a Project Mission Skill root only when an explicit Project scope
  exists; global loading no longer leaks through `Instance.directory`.
- The shared structured-reference parser accepts paired ASCII or typographic
  double quotes, including the observed mixed `@squad("general”)` input.
  Reserved references with invalid delimiters now return the explicit
  `malformed_reference` Composer contract instead of degrading to Chat.
- Focused positive contracts passed: 19 tests, 0 failures, covering global Skill
  discovery, the strict global route response, Overlay projection, typographic
  Squad parsing, and explicit malformed-reference errors.
- OpenCorvus, Overlay, and transport-protocol type checks passed. Overlay Vite
  build, SDK generation, API documentation generation, `api:routes-check`,
  `docs:check`, and the 22-check historical documentation suite passed.
- Real-page acceptance used the source server and production Vite bundle with a
  disposable `OPENCORVUS_HOME` and database on port 17890. The inspected `@`
  menu visibly contained ordinary built-in and home-level Skills, the built-in
  Mission Skill, and Builtin/General.
- Three real production-Composer submissions were inspected:
  `@skill("grill-me")` created a Chat and visibly loaded `grill-me`;
  `@squad("general”)` created a Mission whose persisted metadata contained
  `visibleExpertSquadIDs: ["general"]`; and
  `@mission("mirror-prism-cluster")` created a Mission that visibly loaded the
  Mission Skill. The isolated server was then shut down gracefully and its
  temporary data, including copied test credentials, was moved to Trash.
