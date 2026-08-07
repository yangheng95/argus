# Mission Skill orchestration implementation

Status: implemented, locally verified, and independently accepted.

## Recall

### User request

- “设计一个mission skills，他使用独立的mission skills目录，但是服用skills逻辑。”
- Mission Skill is used by Mission to coordinate multiple Expert Squad workflows.
- Exact `@mission-skill` and `@squad` references bypass Chat routing and go directly to the Mission agent.
- Chat cannot access Mission Skills.
- Investigate first, refine the design, obtain an independent Agent review, then implement only after the user explicitly says “开始实施”.

### Acceptance

- Project and user-global Mission Skills use only `.opencorvus/mission-skills/<package>/SKILL.md` and
  `Global.Path.config/mission-skills/<package>/SKILL.md`.
- Mission Skill and ordinary Skill share definition parsing, strict identity, expiry, platform/tool/permission eligibility,
  search, exact loading, supporting-file materialization, and result rendering.
- Ordinary Skill discovery excludes every `mission-skills` path, including broad configured parent paths.
- Only native `agent="mission"` on a `kind="mission"` session receives the deferred `mission_skill` surface.
- Composer publishes Expert Squad and Mission Skill catalogs as one atomic scope-keyed snapshot.
- Exact `@mission-skill` and `@squad` directives call `POST /mission/wake` before all Chat/session/task submission paths.
- Mission-Skill-only requests omit `promptProfile`; an exact `@squad` supplies the existing `promptProfile`.
- The original visible text is the Mission user message; Mission loads every selected Skill with a visible
  `mission_skill` call and stores durable workflow commitments only in existing Mission state files.
- `mirror-prism-cluster` moves out of the Mirror PRD package into the independent built-in Mission Skill payload with no
  compatibility copy or alias.

### Constraints

- No fallback, dual source, hidden message, workflow engine, persisted Mission Skill selection, state machine, host routing
  by prose keywords, or Task-local squad switching.
- No restart or refresh of the user's running OpenCorvus/Overlay.
- Visual acceptance uses an isolated target and Node-started Playwright.
- Preserve the unrelated unstaged edit in
  `specs/records/2026-07/2026-07-22-mirror-prism-full-workflow-distillation.md`.

### Sources and repository audit

- Design and full call-site inventory:
  `specs/records/2026-07/2026-07-23-mission-skill-orchestration-surface.md`.
- Current architecture: `specs/current/architecture/04-extensions.md`,
  `specs/current/architecture/08-agent-tool-adapter.md`, and `specs/current/architecture/99-principles.md`.
- Runtime owners: Skill catalog/mount/tool, SessionLoop/SystemPrompt, tool registry/pools, Mission prompt/session, server routes,
  SDK/OpenAPI generation, Composer catalog/parser/menu/router, Mirror PRD package, collaboration definitions, and generated
  artifact closure.
- The independent design review first reported five blockers: deferred provider closure, one consumed Skill-family finalizer,
  explicit Composer precedence, generated payload closure, and per-row eligibility instead of a surface gate. The revised
  design received `ACCEPT`; the implementation follows those corrections.

## Implemented contract

- Added a shared discriminated Skill surface and shared eligibility helpers.
- Added strict built-in/global/project `MissionSkillCatalog`, dedicated generated payload/cache, and exact roots.
- Added one shared canonical-root owner classifier; non-canonical directories named `mission-skills` remain ordinary
  Skill sources instead of falling into an unowned path class.
- Refactored one Skill loader factory into `skill` and `mission_skill`; both remain deferred until SessionLoop binds their exact
  turn-resolved surface.
- Added Mission-only role ownership and one SessionLoop finalizer that selects native Mission Skill, projected production
  Skill, or no Skill surface.
- Native Mission resolution refreshes the strict catalog every turn so filesystem drift fails at the execution surface.
- Added Mission system policy requiring visible exact loads before planning/state writes/Task creation.
- Added `GET /mission-skill/catalog`, generated OpenAPI/SDK types, and API reference documentation.
- Added Composer Mission Skill category, atomic directive parsing/editing, atomic dual-catalog snapshot, visible catalog
  failure, and direct Mission routing with explicit directive precedence.
- Moved `mirror-prism-cluster` and its full supporting-file closure to the built-in Mission Skill author source; removed its
  Mirror PRD package projection and regenerated both payloads.

## Verification evidence

- Focused backend catalog, payload, runtime, tool-family, role/template isolation, Session system prompt, server route,
  Mirror package, generated-document health, and SDK collaboration tests pass.
- A native Mission integration test runs real `SessionLoop.resolveTools()`, repeats the shared finalizer after a
  Structured Output tool is attached, and executes the resolved `mission_skill` tool to obtain its real load result.
- Focused Overlay parser, catalog snapshot, UI source contract, and scope identity tests pass.
- Backend and Overlay TypeScript checks pass.
- SDK/OpenAPI generation and bilingual API docs generation pass.
- Node browser command:
  `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/composer-mention-browser.test.ts`.
- Browser assertions cover three categories, keyboard/pointer/atomic edits, bounded/no-typing-network behavior, exact Squad
  Mission wake, Mission-Skill-only Mission wake while Expert Squad mode is selected, combined Mission Skill + Squad
  routing, exact/omitted `promptProfile`, zero Chat submission requests, and zero direct Task creation requests.
- The Node browser acceptance uses the real built Composer against an isolated HTTP fixture and hydrates a canonical visible
  Mission transcript containing the `mission_skill` tool call/result. It is UI/routing evidence, not a claim of a live
  provider-backed end-to-end Mission run; the real tool-resolution/execution evidence is the backend integration test.
- Visual proof:
  `.scratch/composer-mentions/category-light.png`, `.scratch/composer-mentions/placeholder-light.png`,
  `.scratch/composer-mentions/mission-skill-transcript-dark.png`, and
  `.scratch/composer-mentions/mission-skill-transcript-light.png`.
- The generic Codex `skill-creator` validator rejects OpenCorvus's existing `required_tools` extension as an unknown
  frontmatter key. The package is therefore validated by OpenCorvus's canonical `Skill.Definition` schema, catalog/runtime
  tests, generator freshness test, and actual `panel` eligibility instead of weakening or duplicating the product schema.

## Independent implementation review

The first read-only implementation review reported four blockers:

1. Mission turn resolution used the cached catalog.
2. ordinary Skill exclusion matched any path segment named `mission-skills` instead of the two canonical roots.
3. generated payload discovery did not use `Skill.Definition` or prove unsafe/incomplete supporting-file rejection.
4. verification lacked a native Mission SessionLoop execution and visible combined routing/transcript coverage.

All four findings are repaired with focused regression tests and browser evidence. The read-only revision review returned
`ACCEPT` with no remaining blocker and independently inspected both Mission transcript screenshots.

## Remaining closure

- None. Repository generation drift, API route, docs, i18n, type checks, focused backend/Overlay tests, Node browser
  acceptance, and independent review are complete.
- The task-owned commit excludes the unrelated pre-existing edit in
  `specs/records/2026-07/2026-07-22-mirror-prism-full-workflow-distillation.md`.
