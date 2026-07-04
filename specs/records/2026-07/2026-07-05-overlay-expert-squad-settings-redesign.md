# Overlay Expert Squad Settings Redesign

## Recall

User request:

- Review the current overlay settings surface because the old Prompt tab no longer fits dynamic expert-squad loading.
- Find the present problems and design a new expert-squad configuration page.
- Think through the design first, then ask an independent agent to review it.

Retained dynamic expert-squad requirements:

- Project expert squads are loaded from `.opencorvus/expert-squads/<id>` and from ZIP archives that unpack to the same clear directory structure.
- The manifest `id` is the expert-squad identity. Folder names, archive filenames, and display labels must not become identity.
- Each expert squad owns `README.md` for Orchestrator append prompt, optional `selector.md`, per-agent `agents/<agent>/system.md`, package-local `skills`, `tools`, and `mcp` definitions.
- Active selection is still the existing `prompt_profile.active` value until the whole config contract is deliberately replaced. Do not introduce `expert_squad.active` as a second active state.
- Package-specific skills, tools, MCP prompts/resources, and tool projections are capability projections, not ordinary prompt text.

Hard constraints recalled from project rules:

- No fallback, compatibility shadow path, gate, or double-source design.
- Specs and design records live under `specs/`.
- Before implementation, reread this Recall block and the current dynamic expert-squad record.
- Frontend implementation later must be visually verified with a real page screenshot; lint, typecheck, and DOM text assertions are not enough for a UI delivery.
- Do not restart, refresh, or kill running OpenCorvus / overlay processes without explicit user approval.

Landed records and docs read before this design:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-04-architecture-issue-subagent-investigation.md`

Repository search and code inspected:

- Overlay settings entrypoint: `packages/overlay/src/components/ConfigDialogHost.tsx`, `packages/overlay/src/store/dialog.ts`.
- Existing page: `packages/overlay/src/components/settings/PromptCatalog.tsx`.
- Overlay services and scope: `packages/overlay/src/services/config.ts`, `packages/overlay/src/services/prompt-profile-scope.ts`, `packages/overlay/src/main.tsx`, `packages/overlay/src/components/ChatComposer.tsx`.
- Overlay styling and labels: `packages/overlay/src/styles/surfaces/settings.css`, `packages/overlay/src/i18n/en-US.json`, `packages/overlay/src/i18n/zh-CN.json`.
- Existing tests: `packages/overlay/test/prompt-catalog-save.test.ts`, `packages/overlay/test/prompt-profile-task-session-owner.test.ts`, `packages/overlay/test/browser/prompt-profile-panel.test.ts`, `packages/overlay/test/browser/prompt-profile-selector-browser.test.ts`.
- Backend routes and schemas: `packages/opencorvus/src/server/routes/config.ts`, `packages/opencorvus/src/server/routes/expert-squad.ts`, `packages/opencorvus/src/agent/prompt-profile.ts`.
- Dynamic package implementation: `packages/opencorvus/src/expert-squad/registry.ts`, `packages/opencorvus/src/expert-squad/manager.ts`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`, `packages/opencorvus/src/expert-squad/catalog-profile.ts`.
- Backend tests and fixtures: `packages/opencorvus/test/server/config-routes.test.ts`, `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`, `packages/opencorvus/test/expert-squad/package-manager.test.ts`, `packages/opencorvus/test/expert-squad/registry.test.ts`, `packages/opencorvus/test/fixture/expert-squad.ts`.
- Independent review feedback read on 2026-07-05 from UX, API, and test reviewers. Their blocker feedback is incorporated below.

## Current Problems

1. The settings navigation still exposes a `prompt` tab labelled "Prompts" / "提示词管理", and the component is still named `PromptCatalog`. The composer label has already moved to "Expert Squad", so settings and runtime selection now speak different product languages.

2. `PromptCatalog.tsx` presents expert squads as read-only prompt profiles. It shows only label, id, description, active badges, and per-agent prompt append previews. The data model already contains `capability_projection`, `projection_hash`, `projected_agents`, default/package skill refs, tool refs, MCP server/tool/prompt/resource refs, but the page hides them.

3. The page has no package lifecycle controls even though backend routes already exist for folder import, ZIP import, and ZIP export. Users cannot install a folder, replace a package, export a package, or inspect the canonical package root from the settings surface.

4. The page does not expose expert-squad identity. It does not distinguish manifest `id`, display label, project package root, built-in package, active project selection, and active session overlay clearly enough to prevent confusing similarly named squads.

5. The page does not show `README.md`, even though the active package README is appended to the Orchestrator prompt. It also does not show selector metadata / instructions, even though selector skills are projected from package selectors.

6. The current overview says "Selected profile", counts "agents" and "prompts", and then presents "Agent Guidance". This wording suggests prompt editing/configuration, while the actual runtime effect is an expert-squad capability package.

7. Existing browser and source tests intentionally assert that there is no import input, metadata block, delete button, or prompt editor. Those tests now pin an obsolete transitional surface and must be replaced with expert-squad package behavior tests.

8. Backend read and mutation surfaces are split by old names: `GET /config/prompt-profile` lists expert-squad package-backed profiles, while `/expert-squad/*` only imports/exports. If the overlay adds another independent page read model without retiring the old prompt-profile client surface, it will create a UI-level double source.

9. Inactive package behavior is nuanced and currently invisible. Catalog loading can list inactive packages without parsing every inactive MCP definition, while activation can fail when the selected package's full projection is invalid. The UI must report the exact server error instead of silently retaining or substituting another squad.

10. The current session catalog response conflates explicit session override with inherited project default. Under session scope, `session_active` is currently populated from the effective config. A new page must distinguish effective active, project active, and explicit session override or it will mislead users into thinking a session override exists when the session merely inherits the project default.

11. Catalog load failure is not just a lifecycle error. Because expert squads are plain directories, a broken manifest, missing README, blank selector, or invalid package tree can make the catalog request fail before any selected package detail renders. The settings page must show the exact catalog load error with the scope directory and still expose import / replace recovery actions.

## Design Goal

Replace the Prompt tab with an Expert Squads settings page that answers four operator questions:

- Which expert squad is effective for the project or selected session?
- What package identity and plain-file source does this squad come from?
- What prompt, skill, tool, MCP, workflow, and dynamic attributes will the squad project?
- How do I import, replace, export, and activate a package without editing hidden config blobs?

The page is a package and projection inspector plus lifecycle surface. It is not an in-app prompt editor.

## Single Source Model

Keep active state in one place:

- Project active: `opencorvus.jsonc` stores `prompt_profile.active`.
- Session active: the session config overlay stores `prompt_profile.active`.
- No `expert_squad.active`, no localStorage active id, no separate overlay-only selected active value.

Use one product catalog route and one overlay service:

- New canonical catalog route: `GET /expert-squad/catalog`.
- Retire overlay use of `GET /config/prompt-profile` in the same implementation. Do not leave a second overlay catalog caller.
- Route implementation remains backed by `PromptProfileResolver.list(...)` plus catalog-package metadata from `ExpertSquadRegistry.loadCatalogPackage(...)` / embedded built-in package metadata.
- Do not full-load inactive package tools or inactive package MCP servers just to render the catalog. The existing inactive-MCP-not-parsed contract must remain true.
- The overlay service should be named around expert squads, for example `loadExpertSquadCatalog(...)`, and the old `loadPromptProfileCatalog(...)` product API should be removed or fully renamed in the same change.

`/config/prompt-profile` should not remain as a compatibility catalog route for the overlay. If external route removal affects OpenAPI / SDK outputs, update those generated contracts and docs in the same change rather than keeping two routes.

## Catalog Data Needed By The Page

Extend the catalog view so the page does not infer package facts from strings:

```ts
interface ExpertSquadCatalog {
  active: {
    effective: string
    project: string
    session_override: string | null
  }
  default: string
  scope: { kind: "project" | "session"; directory: string; sessionID?: string }
  targets: ExpertSquadTarget[]
  squads: ExpertSquadSummary[]
  active_skill_projection: {
    active_squad_id: string
    selector_skill_names: string[]
    production_skill_names: string[]
    projected_skill_names: string[]
    projected_agent_ids: string[]
    projected_tool_ids: string[]
  }
}

interface ExpertSquadSummary {
  id: string
  label: string
  description?: string
  version?: string
  built_in: boolean
  source: {
    kind: "built_in" | "project_package"
    root?: string
    manifest_path?: string
    readme_path?: string
  }
  readme: {
    path: "README.md"
    content: string
    append_target: "orchestrator"
  }
  selector?: {
    summary: string
    selection_guidance: string
    instructions_path: "selector.md"
    instructions?: string
  }
  agents: Record<string, string>
  capability_profile_id: string
  projection_hash: string
  projected_agents: string[]
  capability_projection: PromptProfileCapabilityProjection
  dynamic_attributes: ExpertSquadRegistry.Manifest["dynamic_attributes"]
}
```

Field policy:

- `id` remains the activation id and must equal manifest id for project packages.
- `active.effective` is the runtime effective `prompt_profile.active`.
- `active.project` is the project config `prompt_profile.active`.
- `active.session_override` is non-null only when the selected root session explicitly sets `prompt_profile.active`; inherited project default must be shown as no session override.
- `source.root` is shown for project packages so users can verify the plain directory being loaded.
- `readme.content` is shown because it is runtime prompt material for Orchestrator.
- `selector.instructions` is shown when available because it explains how the general squad chooses this package.
- `capability_projection` stays structured; the frontend should not parse ref strings to decide source kind beyond display grouping.
- `active_skill_projection` is the active skill projection summary. It is needed so the page can show selector skills and production skills without reimplementing `resolveSkillProjection(...)` in the frontend.

## Page Structure

Rename the settings section:

- Tab id: `expert-squad` or a full replacement of the existing `prompt` id. Do not leave both visible.
- Label: `专家团` / `Expert Squads`.
- Component: `ExpertSquadPanel.tsx`.
- Sidebar icon: use an existing lucide-backed icon that reads as a team or network, not the message-square prompt icon.

Use a dense operational layout:

- Top status strip: directory, scope, effective active, project active, explicit session override when present, and selected squad id.
- Left list: built-in squad(s) first, project packages second. Each row shows label, manifest id, source kind, version, and active badges.
- Main detail area with tabs or segmented controls:
  - **Overview**: identity, source root, manifest path, README append target, selector summary, projection hash, dynamic attributes.
  - **Capabilities**: scheduler row plus agent rows; grouped counts and expandable lists for built-in tools, default skills, package skills, selector skills, production skills, default tools, package tools, default MCP servers/tools/prompts/resources, and package MCP servers/tools/prompts/resources.
  - **Prompts**: per-agent `agents/<agent>/system.md` prompt append previews. This replaces the current "Agent Guidance" area but is no longer the main page.
  - **Files**: canonical package structure and lifecycle actions. Project packages show open-folder and export; built-ins show read-only source metadata.
  - **Validation**: catalog load error, import / replace error, export error, and activation error details. It must show exact server errors and the scope directory used for the failing request.

When catalog loading fails, the page still renders the status strip and a recovery surface with import-folder and import-ZIP controls. It must not hide package recovery behind a successfully loaded catalog.

Catalog load failure should use one error path: the frontend catches the failed `GET /expert-squad/catalog?directory=<scope.directory>` response and renders the exact server error plus recovery actions. Do not add a partial-success catalog payload that tries to mix valid squads and broken packages into a second route contract.

Primary actions:

- `Set Project Default`: writes only `{ prompt_profile: { active: id } }` through project config.
- `Set Current Session`: writes only the session config overlay `{ prompt_profile: { active: id } }` when the current scope is session.
- `Import Folder`: uses the host directory picker when available and posts `POST /expert-squad/import-folder?directory=<scope.directory>` with `{ sourceDirectory, replace: false }`.
- `Import ZIP`: uses file input / host file picker, encodes the ZIP as base64, and posts `POST /expert-squad/import-file?directory=<scope.directory>` with `{ filename, archiveBase64, replace: false }`.
- `Replace Existing`: a separate explicit action that repeats the same selected folder/file import payload with `replace: true`; do not auto-replace on duplicate ids and do not require the user to re-pick a different source for the replace confirmation.
- `Export ZIP`: posts `POST /expert-squad/export?directory=<scope.directory>` with `{ id }`, decodes the JSON `{ id, filename, archiveBase64, fileCount }`, and downloads the returned bytes using the existing browser anchor download pattern.
- `Open Folder`: opens `source.root` through host native `open-path` where supported.

Do not add delete in this page until there is a backend delete route with explicit active-package behavior and tests. A disabled delete button is not useful; omit it.

## Interaction Rules

- Selecting a row changes only the viewed detail. It must not activate the squad.
- If a task is selected and its root session is still pending, the page stays in a pending state just like the current `promptProfileCatalogScope()` behavior. It must not query project scope in place of the unresolved session.
- Import success reloads the same catalog scope. It does not activate the package automatically.
- Import, replace, export, project activation, and session activation must all bind requests to the scope directory instead of relying on the global API directory.
- Replace success reloads the same catalog scope, keeps the replaced squad selected when that id is available, and shows the new `projection_hash` so the user can confirm the replacement took effect.
- Export success and failure notices include the scope directory used for the request.
- Activation success reloads the same catalog scope and updates composer selector data.
- Activation failure leaves the existing server state unchanged and displays the exact error. The UI must not silently switch back to `general`.
- Built-in squads are read-only and cannot be replaced or exported unless the backend provides an explicit built-in package export contract.
- The page should allow manual source path entry only as a visible "current host does not support picker" mode when host capabilities do not provide a directory picker. This is a host capability path, not a silent alternate data source.

## Visual Design

The page should feel like a configuration console, not a marketing page:

- No card-within-card layout.
- Keep sections flat with separators, tables, compact badges, and expandable rows.
- Use icon buttons for import, export, refresh, open folder, and copy id/path.
- Use tabs or segmented controls for `Overview`, `Capabilities`, `Prompts`, `Files`, and `Validation`.
- Use stable dimensions for the left package list and capability table so long ids and refs wrap without shifting the layout.
- Long refs should wrap with `overflow-wrap: anywhere`; do not truncate the only copy of an id/ref without a copy action.
- Capability rows should show counts first and expand to full ref lists. The common view must be scannable before expansion.

## Implementation Impact

Frontend files likely to change:

- Replace `packages/overlay/src/components/settings/PromptCatalog.tsx` with `ExpertSquadPanel.tsx`.
- Replace or rename `packages/overlay/src/services/prompt-profile-scope.ts` to an expert-squad scope service while preserving current task/session ownership semantics.
- Replace prompt-profile catalog service/types in `packages/overlay/src/services/config.ts` with a single `services/expert-squad.ts` used by settings, composer, and capability/mount callers.
- Update `packages/overlay/src/components/ConfigDialogHost.tsx`, `packages/overlay/src/store/dialog.ts`, `packages/overlay/src/components/CommandPalette.tsx`, `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` via the existing `CONFIG_SECTIONS` single source.
- Keep `ChatComposer.tsx` compact selector, but rename the loaded data to expert squads and ensure it uses the same catalog service.
- Update `packages/overlay/src/components/settings/SkillMarketPanel.tsx` because it currently imports the prompt-profile scope helper for session-aware skill projection.
- Add expert-squad import/export service functions and reuse existing file/base64/download helpers where possible.
- Update settings CSS from `.prompt-profile-*` to `.expert-squad-*` selectors; remove dead prompt-profile settings selectors in the same change.
- Update `en-US.json` and `zh-CN.json` labels from prompt profile wording to expert-squad package wording.

Backend files likely to change:

- Add `GET /expert-squad/catalog` in `packages/opencorvus/src/server/routes/expert-squad.ts` and retire the overlay-facing `/config/prompt-profile` catalog contract from `packages/opencorvus/src/server/routes/config.ts`.
- Add an expert-squad catalog schema backed by `PromptProfileResolver.list(...)`, not a second active-state resolver.
- Extend `packages/opencorvus/src/expert-squad/catalog-profile.ts` and/or `prompt-profile-resolver.ts` so the catalog includes README, selector, version, source paths, and dynamic attributes.
- Derive `active_skill_projection` by calling `PromptProfileResolver.resolveSkillProjection(...)`; do not duplicate selector / production skill projection logic in the route or frontend.
- Derive `active.session_override` from the selected session's explicit config overlay / origin, not from the effective config active value.
- Keep import/export behavior in `packages/opencorvus/src/expert-squad/manager.ts`; add only page-required response fields if missing.
- Update OpenAPI, SDK, API docs, and route checks for the retired `/config/prompt-profile` route and new `/expert-squad/catalog` route in the same change.

Tests to replace or add:

- Replace `packages/overlay/test/prompt-catalog-save.test.ts` with `packages/overlay/test/expert-squad-settings-surface.test.ts`. It must reject old `PromptCatalog`, old visible Prompt tab labels, old prompt editor selectors, old prompt-profile settings CSS, `titlebar-settings-prompt`, `data-config-panel="prompt"`, `prompt.title`, `loadPromptProfileCatalog`, and `prompt-profile-scope`, while still allowing the backend storage key `prompt_profile.active`.
- Replace `packages/overlay/test/prompt-profile-task-session-owner.test.ts` with `packages/overlay/test/expert-squad-scope.test.ts` while preserving pending root-session behavior, directory-scoped request keys, and scope-directory mutation requests.
- Add `packages/overlay/test/expert-squad-lifecycle-service.test.ts` covering folder import, ZIP import, explicit replace false/true, export download base64 decode, project activation, session activation, activation failure exact error, and no fallback to `general`.
- Update `packages/overlay/test/api-directory-injection.test.ts` so `expert-squad/catalog`, `expert-squad/import-folder`, `expert-squad/import-file`, and `expert-squad/export` inject the explicit scope directory; remove `config/prompt-profile` from the expected route list.
- Update `packages/overlay/test/browser-error-collector.test.ts` to track the renamed browser tests.
- Replace `packages/overlay/test/browser/prompt-profile-panel.test.ts` with `packages/overlay/test/browser/expert-squad-settings-panel.test.ts`. It must verify:
  - settings tab label is Expert Squads / 专家团;
  - project and session active badges are correct;
  - inherited project active and explicit session override are visually different;
  - README and selector are visible;
  - capability projection rows expose scheduler and agent skill/tool/MCP refs;
  - selector skills and active production skills are visible;
  - activation patches only `prompt_profile.active`;
  - folder/ZIP import and export hit the expert-squad routes with the scope directory;
  - catalog load failure shows exact error and recovery actions;
  - no prompt editor textarea is present.
- Replace `packages/overlay/test/browser/prompt-profile-selector-browser.test.ts` with `packages/overlay/test/browser/expert-squad-selector-browser.test.ts`.
- Replace `packages/overlay/test/browser/prompt-profile-fixture.ts` with `packages/overlay/test/browser/expert-squad-fixture.ts`.
- Add `packages/opencorvus/test/server/expert-squad-catalog-routes.test.ts` for the enriched catalog fields: README content, selector metadata/instructions, dynamic attributes, source root, active effective/project/session_override semantics, no `expert_squad.active`, and inactive package MCP definitions not being parsed for catalog display.
- Keep package-manager import/export tests; extend only if overlay requires new response fields.
- Run a real browser visual test after implementation and save screenshots under `.scratch/` for overview, capabilities, files, validation error, and session-scope states. The implementer must inspect those screenshots and record the visual review result; saved screenshots alone are not sufficient.

Focused validation after implementation:

- `bun test packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `bun test packages/opencorvus/test/server/expert-squad-catalog-routes.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/skill-routes.test.ts`
- `bun test packages/overlay/test/expert-squad-scope.test.ts packages/overlay/test/expert-squad-settings-surface.test.ts packages/overlay/test/expert-squad-lifecycle-service.test.ts packages/overlay/test/api-directory-injection.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-settings-panel.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-selector-browser.test.ts`
- `bun run api:routes-check`
- OpenAPI / SDK generation or drift check required by the current API toolchain.
- Product API docs check for removing `/config/prompt-profile` and adding `/expert-squad/catalog`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- Final residue scan: `rg "PromptCatalog|config/prompt-profile|prompt-profile-fixture|titlebar-settings-prompt|data-config-panel=\\\"prompt\\\"|loadPromptProfileCatalog|prompt-profile-scope" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test`.

## Independent Review

Round 1 completed on 2026-07-05 with three read-only independent reviewers.

Blockers found and resolved in this revision:

- API reviewer: the first draft left catalog route choice as an `if`. Resolution: choose `GET /expert-squad/catalog` as the single product catalog route and require retiring overlay use of `/config/prompt-profile`.
- API reviewer: the first draft missed OpenAPI / SDK / API docs verification. Resolution: add route-check, OpenAPI / SDK drift, and product API docs validation.
- UX reviewer: `session_active` semantics conflated inherited project default with explicit session override. Resolution: replace top-level active strings with `active.effective`, `active.project`, and `active.session_override`.
- UX reviewer: import/export actions did not explicitly bind the viewed scope directory. Resolution: require all expert-squad mutations to include `?directory=<scope.directory>`.
- UX reviewer: validation covered lifecycle errors but not catalog load failure. Resolution: add catalog-load error state and recovery actions.
- Test reviewer: verification commands and filenames preserved old Prompt surface names. Resolution: rename the planned tests to expert-squad names and add source guards against old Prompt tab residue.
- Test reviewer: lifecycle coverage was too weak. Resolution: add a focused lifecycle service test covering import, replace, export, project/session activation, exact errors, and no fallback.
- Test reviewer: visual validation was too vague. Resolution: require screenshots for overview, capabilities, files, validation error, and session scope, plus explicit human review of those screenshots.

Round 2 completed on 2026-07-05 with the same three read-only reviewers.

- API reviewer: no blocker. Non-blocking advice added: source guards for old overlay callers and deriving `active_skill_projection` from `PromptProfileResolver.resolveSkillProjection(...)`.
- UX reviewer: no blocker. Non-blocking advice added: single catalog-load error path, replaced-squad selection after replace, visible manual path mode, and scope-directory notices for export.
- Test reviewer: no blocker. Non-blocking advice added: stronger residue guards, browser error collector rename, directory-injection route list update, and final `rg` scan.
