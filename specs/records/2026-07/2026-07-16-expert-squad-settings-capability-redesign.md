# Expert Squad Settings Capability Redesign

## Recall

### User request

- Add an `Expert Squads` Settings group with two pages: an installation page and a detailed configuration page.
- The detailed page must make each Agent's accessible Tools, MCP (Model Context Protocol) resources, Skills, and related capability facts directly understandable.
- Research Multica's current implementation instead of inventing an isolated information architecture.
- Keep the presentation aligned with the existing OpenCorvus design language, modern and flat, without a complicated dashboard layout.
- Do not use stale screenshots as acceptance evidence.
- Follow-up correction: the installation page must work like a Market. Users must be able to browse expert squads, inspect what each squad contains, and install a chosen squad. A folder/ZIP picker is not the primary installation experience.
- Follow-up cleanup: delete the generated filler squads with manifest IDs `algorithm`, `backend`, and `frontend-automation-debug` (`frontend-debug` in the user's wording). Remove their package sources and regenerate payload/catalog artifacts; do not hide them only in the UI.

### Acceptance criteria

- Settings keeps exactly one `Expert Squads` navigation group with `Install` and `Details` children.
- Install presents a browsable expert-squad market with a simple search, flat catalog rows, selected-squad description/capability preview, installed state, and an install action for one selected package.
- Bundled payload packages are the authoritative first market source. Installing one market entry writes only that explicit package through the Manager/Registry lifecycle and does not activate it or overwrite an installed package.
- The bundled market and payload contain none of `algorithm`, `backend`, or `frontend-automation-debug`; tests and visual fixtures use retained packages.
- Folder and ZIP import remain secondary local-source actions rather than the page's primary content.
- Details keeps the existing catalog, project/session activation, export, and catalog scope behavior, but makes an `Agents and access` section visible without opening technical diagnostics.
- Every declared Agent shows its exact identity, base role, and separate Tool, Skill, and MCP groups. Each item preserves whether it comes from built-in/default/package projection and MCP items preserve server/tool/prompt/resource kind.
- When the selected squad is the effective active squad, the page reads the resolved `active_agent_projection`; inactive squads show their manifest-declared projection and label it as declared access.
- README, selector content, hashes, scheduler projection, and raw manifest diagnostics remain in a collapsed technical disclosure. They do not compete with primary capability information.
- No second catalog, active-squad field, frontend-only permission model, compatibility alias, or fake Tool/MCP mutation is added.
- Focused source tests, Overlay type checking and i18n checks, Node-launched browser interaction tests, current-build desktop screenshots, documentation health, and `git diff --check` pass.

### Hard constraints

- Preserve `prompt_profile.active` as the only active expert-squad source and `PromptProfileResolver` as the effective runtime projection owner.
- Reuse the existing `ExpertSquadPanel`, `services/expert-squad.ts`, Settings primitives, Solid/Kobalte controls, Manager/Registry package lifecycle, and `/expert-squad/**` routes.
- Desktop-only scope. Do not add tablet/mobile/responsive acceptance.
- Flat design means clear typography, dividers, quiet selected rows, restrained pills, and no nested dashboard cards or decorative gradients/shadows.
- Do not restart, refresh, close, or interfere with the user's running OpenCorvus/Overlay. Visual validation uses the isolated browser fixture and Playwright launched through Node.
- Preserve unrelated dirty worktree changes; do not create a git worktree or use a repository-wide reset.
- Historical `.scratch` screenshots dated 2026-07-13 and 2026-07-14 are obsolete and may be used only as negative evidence. New acceptance screenshots must come from the current working tree.

### Sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-overlay-expert-squad-settings-redesign.md`
- `specs/records/2026-07/2026-07-15-codex-settings-multica-expert-squad-unification.md`
- `specs/records/2026-07/2026-07-15-titlebar-worktree-expert-squad-layout.md`
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/components/settings/primitives.tsx`
- `packages/overlay/src/services/expert-squad.ts`
- `packages/overlay/src/styles/surfaces/settings.css`
- Relevant expert-squad Settings and browser tests under `packages/overlay/test/**`.
- Multica documentation for Agent creation, Skills, provider capability differences, and the current public source at commit `ea8511340e6949436c04edea00dabeeebba34233`.
- Multica `packages/views/agents/components/agent-overview-pane.tsx`, Agent Skill/MCP tabs, and `packages/views/squads/components/squad-detail-page.tsx` from the temporary read-only research checkout under `.scratch/multica-reference`.

### Multica findings and design decision

Multica's current Agent detail page groups fields by user intent: `Overview`, `Work`, `Capabilities`, and `Settings`. Inside `Capabilities`, Instructions, Skills, MCP, and Integrations are distinct surfaces. Its Squad page keeps member identity rows separate from instructions. The useful lesson is that capability information should answer “what can this Agent use?” before exposing backend fields.

OpenCorvus must not copy Multica's nested two-level tab hierarchy because the requested surface has exactly two pages and OpenCorvus capability ownership differs. The user's follow-up also rejects a file-picker-first installation page. The adopted structure is therefore:

1. `Install`: Market-style browse/search, flat results, selected expert-squad preview, and per-package install; local folder/ZIP import is secondary.
2. `Details`: flat squad directory, selected squad identity/actions, then visible per-Agent Tool/Skill/MCP access groups.
3. `Technical details`: collapsed raw package and scheduler evidence.

### Whole-repository search evidence

| Search / call-point cluster | Evidence and decision |
| --- | --- |
| `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records` | Registry owns package identity/discovery, Manager owns import/export, Resolver owns runtime projection, routes expose the catalog, and Overlay consumes that catalog. Keep all owners unchanged. |
| `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test` | Payload and import/export lifecycle already flow through Manager/Registry. This UI task must not add a package loader or release path. |
| `rg -n "CONFIG_SECTIONS|ConfigDialogTab|expert-squad-install|ExpertSquadPanel|expert-squad-toolbar|expert-squad-overview|expert-squad-layout|expert-squad-detail" packages/overlay/src packages/overlay/test specs/records/2026-07` | `store/dialog.ts` is the single section registry, `ConfigDialogHost` owns grouped navigation, one `ExpertSquadPanel` projects both pages, and `settings.css` owns the visual contract. Retain this topology. |
| `rg -n "loadExpertSquadCatalog|setProjectExpertSquadActive|setSessionExpertSquadActive|clearSessionExpertSquadOverride|importExpertSquadFolder|importExpertSquadArchive|exportExpertSquadArchive" packages/overlay/src packages/overlay/test` | `services/expert-squad.ts` remains the only Overlay catalog/action client. All existing lifecycle actions stay on it. |
| `rg -n "active_agent_projection|default_skill_refs|package_skill_refs|built_in_tool_ids|default_tool_refs|package_tool_refs|default_mcp_|package_mcp_" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test` | The catalog already carries exact resolved active-Agent arrays and manifest-declared arrays. The UI can present them without a backend contract change or a second capability source. |
| `rg -n "expert-squad" packages/overlay/test/browser/expert-squad-panel.test.ts packages/overlay/test/expert-squad-settings-surface.test.ts packages/overlay/test/expert-squad-settings-navigation.test.ts` | Existing tests pin Install/Details isolation, scope/error paths, lifecycle writes, and collapsed diagnostics. Update them to pin visible Agent access groups and current screenshots. |
| `rg -n -i "skill market|skill-market|marketplace|install.*skill" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test` | The existing Skill Market establishes the local flat market interaction: browse rows, descriptive metadata, installed state, and an explicit install action. Reuse its primitives and visual rhythm, not its Skill-specific contract. |
| `rg -n "release-payload|releasePayloadPackages|payloadPackageSources|import-folder|import-file" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test` | Bundled expert squads already have one generated payload source and an explicit Manager release path, but the current route releases all packages at once. Add a typed read-only market projection and a single-ID Manager install operation; do not install all entries when the user selected one. |
| `rg -n '"(algorithm|backend|frontend-automation-debug)"|expert-squads/builtin/(algorithm|backend|frontend-automation-debug)' packages/opencorvus packages/overlay specs/current` plus exact package-path status/diff | The three source packages live only under root `.opencorvus/expert-squads/builtin/**` and feed the generated payload. Their manifests had unrelated uncommitted `refine` removals; the user's explicit deletion supersedes those package-local edits. Update package inventories, projection/config/skill tests, current architecture examples, and Overlay fixtures that treated these IDs as shipped packages. Generic uses of the word “backend” outside expert-squad identity are unrelated and remain. |

### Independent agent feedback

- None. The user did not request sub-agents, and this task has one tightly coupled UI/data-contract owner.

## Implementation plan

1. Delete the three explicitly rejected source packages and regenerate the single payload artifact; update package inventories and retained-package fixtures rather than adding UI filtering.
2. Add one market projection sourced from `payloadPackageSources`, with installed state proven against Registry discovery, plus one explicit Manager operation that installs only the selected payload package without activation or overwrite.
3. Expose the market projection and single-package install through typed `/expert-squad/**` routes and the existing Overlay expert-squad service.
4. Replace the file-picker-first Install surface with Market-style browse/search, flat result rows, selected-squad preview, installed/install action, and secondary local import actions.
5. Preserve the visible per-Agent Tool/Skill/MCP access work on Details and keep raw README/selector/scheduler evidence in the collapsed disclosure.
6. Update backend, service, UI, i18n, focused source tests, and the existing Node Playwright browser fixture.
7. Build and test, capture fresh Market/Details/Agent-access screenshots from the current worktree, inspect them, correct visual defects, and repeat until accepted.

## Result

- Settings now keeps one `Expert Squads` group with exactly `Install` and `Details` pages.
- `Install` is a bundled-package Market: it loads the payload catalog for the viewed project, supports search and selected-package inspection, shows Agent and capability counts, installs one explicit package, and reflects installed state without activating or overwriting it. Folder/ZIP import is retained only in the collapsed local-package disclosure.
- `Details` presents each Agent's effective or declared Tool, Skill, and MCP access directly. Raw README, selector, scheduler, hashes, and manifest evidence remain under `Technical details`.
- The package sources with manifest IDs `algorithm`, `backend`, and `frontend-automation-debug` were deleted. The task-scoped generated payload retains `frontend-innovate`, `frontend-replica`, `goal-development`, `mirror-watch`, and `opentest`; no UI filter or compatibility alias was added. Unrelated in-progress removal of `goal-development` and `refine` remains outside this task's staged delivery.
- The Market and install endpoints are Manager-owned and project-scoped. Generated OpenAPI and JavaScript SDK artifacts expose the typed contracts.

## Verification

- `bun run --cwd packages/overlay typecheck` — passed.
- `bun run --cwd packages/overlay check:i18n` — passed.
- Focused Overlay Settings, lifecycle, service, and project-directory tests — 102 passed, 0 failed.
- `bun run api:routes-check` and `bun run --cwd packages/sdk/js typecheck` — passed.
- OpenAPI/SDK contract tests under the repository inactivity runner — 17 passed, 0 failed. The direct default-timeout invocation was discarded because its OpenAPI child exceeded Bun's five-second per-test default and was terminated with code 143; the required real inactivity timeout completed in 26.3 seconds.
- Retained expert-squad Manager, Registry, Resolver, projection, Skill, scheduler, and route coverage — 81 passed, 0 failed; the focused Market Manager and route cases also passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-panel.test.ts` — 4 passed, 0 failed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` — 74 passed, 0 failed.
- Fresh current-worktree screenshots were captured at `.scratch/expert-squad-market-current.png`, `.scratch/expert-squad-market-installed-current.png`, `.scratch/expert-squad-settings-details-current.png`, and `.scratch/expert-squad-agent-access-current.png`. They were inspected at original resolution; Market density, installed-state feedback, scroll position, and per-Agent capability readability passed visual review.
- Exact identity audit leaves no shipped source/payload IDs for the three deleted squads. The remaining lowercase word `backend` in `requirement-status.test.ts` is ordinary fixture content, not an expert-squad identity.
- `git diff --check` — passed before final staging; both staged and unstaged forms are checked again before commit.

## Second review

- Market identity comes from each validated payload manifest, installed state comes from the canonical project package tree, and activation remains exclusively `prompt_profile.active`; no second catalog or active field was introduced.
- The single-package operation reuses the existing locked Manager installation path. It neither calls payload-wide release nor replaces an existing package.
- Current screenshots contain only retained packages and use the real Node/Playwright browser runner. Historical screenshots and fixtures containing the deleted squads are not acceptance evidence.
