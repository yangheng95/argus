# Settings and extension runtime repairs

## Recall

### User requirements

1. Repair the reported Skill loading failure where `GET /skill/mounts` returned a Zod error because `name` and `description` were missing.
2. Separate Provider catalog refresh from live model refresh. Opening the Providers settings page must refresh each once. Missing Hexin model metadata must be ignored rather than failing the refresh.
3. Prevent the native Browser preview layer from covering the Settings page.
4. Make Providers search functional.
5. Make an installed Expert Squad appear immediately.
6. When Multica preview returns blockers, repair them and finish the import by default; do not show a repair-or-cancel dialog.

### Acceptance criteria

- The canonical Skill parser continues to retain required `name` and `description`, strips unsupported frontmatter and non-string `metadata` entries, and a real `GET /skill/mounts` route regression returns 200 for the reported shape.
- Provider catalog refresh and configured live-model refresh have different methods, routes, UI controls, loading/error timestamps, and generated API contracts. Neither endpoint calls the other.
- Entering Providers settings invokes both refreshes exactly once for that mounted directory scope and reloads Provider information after they settle. A failure in one refresh remains visible without suppressing the other.
- A `/models` identity that has no matching `/model/info` row receives the existing canonical default limits. Invalid reported limits and conflicting duplicate metadata remain errors.
- Opening Settings first occludes every registered native child surface; closing it restores the Browser preview only after no overlapping Settings or app-dialog owner remains.
- Provider search filters configured and catalog entries by provider identity/name, API, environment variable, model identity, source, and status; clear and no-result behavior work in the rendered page.
- UI-owned Expert Squad mutations keep their direct invalidation. Task-owned installs such as Multica invalidate the catalog from the authoritative task-list terminal event, so Composer and an open Expert Squad panel reload without depending on a sampled busy transition.
- The Multica Task repairs preview blockers within its authority. Evidence-backed Browser MCP replacement is written directly to `mcp_replacements`, previewed again, and imported without a repair/cancel Question. The host still validates exact identities and never infers semantics from command keywords.
- Focused backend/Overlay tests, generated SDK/API/docs checks, typechecks, Node-launched browser tests, task-scoped screenshots, documentation-health tests, and a second diff review pass.

### Hard constraints

- Preserve one canonical Skill parser, Provider catalog, live-model refresh path, native-surface occlusion owner, Expert Squad catalog token, and Multica adapter. Do not add compatibility routes, fallback catalogs, host-side semantic gates, a second search implementation, hidden messages, or another import state machine.
- Provider page refresh is explicit page-entry behavior, not runtime startup or lookup-time network access.
- Missing Hexin metadata means an absent enrichment row only. HTTP failures, malformed response bodies, non-positive limits, and conflicting duplicates stay visible failures and preserve the previous catalog.
- Multica repair remains Agent-led. Safe source evidence can produce an explicit mapping; credentials, external authority, and unproven semantic equivalence are not guessed or silently dropped.
- Do not restart, stop, refresh, or reuse the running OpenCorvus/Overlay as a mutable test target. Browser validation uses an isolated Node runner, never Bun-launched Playwright.
- Preserve and exclude unrelated user changes. No new worktree. Commit subjects use `dsw-33987` and the current delivery branch is pushed to `myhexin`.

### Sources read

- `AGENTS.md`
- User screenshots for `/skill/mounts`, Providers `missing metadata`, and the Providers page
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/06-provider.md`
- `specs/records/2026-07/2026-07-18-agent-skill-metadata-schema-repair.md`
- `specs/records/2026-07/2026-07-19-multica-installed-catalog-visibility.md`
- `specs/records/2026-07/2026-07-20-skill-unknown-frontmatter-ignore.md`
- `specs/records/2026-07/2026-07-20-multica-import-repair-dialog.md`
- `specs/records/2026-07/2026-07-20-stale-expert-squad-self-repair.md`
- Current Skill parser/manager/mount routes, Provider registry/Hexin discovery/routes/CLI, Providers settings, config/app-dialog/native Browser preview, Expert Squad service/panel/SSE router, Multica adapter/tools/Skill/generated payload, and their focused tests
- `browser:control-in-app-browser` Skill for the mandatory rendered-page validation contract

### Whole-repository search evidence

- `rg -n "skill/mounts|SkillMount.matrix|DefinitionFields|projectDescriptiveMetadata" packages specs`
- `rg -n "refreshCatalog|refreshHexin|/hexin/refresh|provider/refresh|providers/refresh" packages specs`
- `rg -n "parseHexinModelInfoLimits|missing metadata" packages specs`
- `rg -n "openConfigDialog|closeConfigDialog|registerAppDialogSurfaceHooks|nativeDialogSurfaceSuspended" packages/overlay`
- `rg -n "providerSearch|providerMatchesSearch|provider-search-input|provider.search" packages/overlay`
- `rg -n "markExpertSquadCatalogStale|expertSquadCatalogRefreshToken|task.completed|task.failed|task.cancelled" packages/overlay`
- `rg -n "mcp_replacements|mcpRepairCandidates|repair-and-import|cancel-import|user-approved" packages specs`
- Generated OpenAPI/SDK and bilingual API documentation route searches for every Provider refresh route

### Independent agent feedback

No sub-agent was used. The user did not request delegation, and the active collaboration constraint prohibits unsolicited sub-agents. The primary Agent owns implementation and the required second review.

## Root-cause chains

### Skill loading

The screenshot matches a pre-repair parser path in which unsupported external frontmatter could contaminate the Skill definition before `PoolSkill` serialization, leaving required descriptive fields absent. The current branch already contains the canonical input projection: unsupported top-level fields are stripped and non-string metadata entries are removed before the required definition is parsed. The existing real route regression for object-valued metadata returns 200. This task retains that single fix and verifies it in the final build rather than creating a second normalization layer.

### Provider and model refresh

The UI exposes one Provider refresh action, while `Provider.refreshCatalog()` first refreshes models.dev and then conditionally calls `refreshHexin()`. Consequently a missing `/model/info` row changes an otherwise successful Provider catalog refresh into the screenshot's red error. The two independent authorities are coupled in one backend method and one UI signal.

The repair keeps one durable catalog file but splits its explicit writers: Provider catalog refresh updates the registry declaration; configured-model refresh enriches live Provider model identities. Page entry runs both independent operations. `parseHexinModelInfoLimits()` treats `/models` as identity authority and `/model/info` as optional limit enrichment, so an absent row uses the established default while malformed reported data still fails.

### Native Browser layer over Settings

Browser preview uses an operating-system child WebView whose z-order is above host HTML. `BrowserPreviewPanel` registers hide/restore hooks only with `app-dialog.ts`; `openConfigDialog()` directly opens Settings without entering that lifecycle. Settings therefore cannot occlude the child surface.

The repair extracts the existing robust hide/restore transition into one owner-aware native-surface occlusion service. App dialogs and Settings acquire different owners. Registered surfaces are restored only after the final owner releases, which also prevents an app dialog opened over Settings from briefly restoring the Browser preview underneath either overlay.

### Expert Squad visibility

Direct UI imports/install/update operations already call `markExpertSquadCatalogStale()`. Multica writes from a Task, so the Overlay relies on a `busy -> idle` effect derived from selected UI state. A fast Task or a non-selected importing Task can complete without that sampled edge, leaving the canonical catalog request key unchanged.

The task-list SSE stream already carries authoritative terminal lifecycle events for all project Tasks. It becomes the single Task-owned invalidation point. The sampled busy effect retains follow-up suggestion behavior but no longer owns catalog freshness.

### Multica repair dialog

The adapter already has a strict digest-bound `mcp_replacements` mapping and the built-in Skill already owns technical repair. A previous record added an explicit repair/cancel Question for safe local Browser MCP candidates. The new requirement supersedes only that decision policy: the Agent now applies the evidence-backed mapping directly, re-previews, and imports. Backend identity/digest validation stays strict and no UI-specific Multica modal exists.

## Call-point disposition

| Call point | Disposition |
| --- | --- |
| `skill/skill.ts`, `skill/manager.ts`, `skill/mounts.ts`, `/skill/mounts` | Retain the current canonical metadata projection; add/run the exact real-route regression and do not normalize again at serialization. |
| `provider/provider.ts` | Make Provider registry refresh and configured live-model refresh independent public operations; remove the combined result and retired Hexin-only public refresh entry. |
| `provider/hexin-discovery.ts` | Default missing enrichment rows; retain strict response, integer, and duplicate-conflict validation. |
| Project/global Provider routes | Replace Hexin-specific model-refresh routes with canonical `/models/refresh` routes and independent schemas; keep directory/global configuration ownership. |
| `cli/cmd/models.ts` | Keep `models --refresh` on Provider registry refresh only; it must not implicitly call configured live models. |
| OpenAPI, generated JavaScript SDK, English/Chinese API docs | Regenerate and replace the retired routes; no compatibility aliases. |
| `ProvidersPanel.tsx` | Use separate signals/actions/errors/timestamps; page-entry `Promise.allSettled` equivalent runs both once and reloads once; API-key save uses model refresh only. |
| Provider i18n and CSS/tests | Add distinct Provider/model action copy and preserve the existing mature Button/SearchField primitives. |
| Provider search | Retain the existing single implementation and strengthen real rendered coverage across configured/catalog and non-name fields. |
| New native-surface occlusion service | Own hook registration, serialized hide/restore transitions, overlap owners, failure rollback, and final-owner restoration. |
| `app-dialog.ts` / `config-dialog-control.ts` | Acquire/release separate owners and order Settings restoration before app-dialog owner release. |
| `BrowserPreviewPanel.tsx` | Register the same native surface with the generic occlusion owner; keep lease release/resync behavior unchanged. |
| App/config/browser tests | Move hook lifecycle tests to the generic owner and add overlapping Settings/app-dialog plus Browser-preview rendered evidence. |
| `services/events.ts` | Invalidate the Expert Squad catalog on authoritative global task-list terminal notifications. |
| `main.tsx` | Remove catalog invalidation from the sampled selected-task busy edge; preserve follow-up suggestion behavior. |
| Expert Squad service/panels | Retain the existing refresh token/request key and direct mutation invalidation. |
| Multica adapter/tool descriptions | Replace user-approval/cancellation wording with explicit evidence-backed Agent-applied mapping; keep strict identity/digest validation. |
| `skill/builtin/multica-import.md` | Remove the repair/cancel Question and require automatic diagnose-map-preview-import behavior within task authority. |
| `skill/builtin-payload.ts` | Regenerate from the canonical Skill source. |
| Multica Skill/adapter/browser tests | Prove no repair/cancel option remains, mapping is re-previewed, dialog is absent, and completed Task reporting is visible. |
| Architecture chapters and this record | Replace the combined refresh and user-approved Multica decision contracts, then record final verification and second-review corrections. |

## Verification plan

1. Focused Skill route, Hexin parser/Provider route, Provider UI/service, native occlusion, SSE catalog invalidation, Expert Squad, and Multica adapter/Skill/payload tests.
2. Regenerate the built-in Skill payload, OpenAPI, JavaScript SDK, and bilingual API references with repository scripts; run freshness and route checks.
3. Run Overlay/OpenCorvus/SDK typechecks, i18n validation, historical links, product-doc single source, document health, and `git diff --check`.
4. Launch the existing Provider and Settings/Browser Node browser fixtures. Verify Provider/model auto-refresh request counts, search by provider/model/API/environment, clear/no-results, overlapping Browser surface occlusion, no Multica repair dialog, pointer/keyboard paths, and focus behavior.
5. Inspect task-scoped screenshots personally, correct visual or stacking defects, rerun, and record exact artifacts here.
6. Perform a second complete call-point/diff review. Record corrections, commit with `dsw-33987`, and push the current delivery branch to `myhexin` without staging unrelated user work.

## Verification results

### Automated checks

- `bun test packages/opencorvus/test/provider/hexin-discovery.test.ts`: 23 passed.
- `bun test packages/opencorvus/test/expert-squad/multica-import.test.ts --timeout 30000`: 24 passed.
- The focused real `GET /skill/mounts` unsupported object-metadata route regression passed.
- Focused Multica Skill/payload, Provider route/UI, native-surface occlusion, app/config dialog,
  task terminal-event invalidation, Expert Squad scope, Browser preview, Button primitive, and static
  Settings contract tests passed.
- `bun run typecheck`: all 9 workspace tasks passed.
- `bun run api:routes-check`, `bun run docs:check`, and `bun run overlay:i18n-check`: passed.
- `bun run --cwd packages/sdk/js build` and the Overlay Vite build: passed; generated OpenAPI,
  JavaScript SDK, and bilingual API references contain only the new split Provider routes.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed.

### Rendered browser verification

All browser fixtures were launched through the repository Node runner; no Bun-launched Playwright or
running OpenCorvus/Overlay process was used. The Provider configuration, Composer model selector,
Provider/model sync, Browser-preview/Settings overlap, and Multica automatic-repair fixtures passed.

The following task-scoped screenshots were inspected directly:

- `.scratch/config-provider-dark.png`: Provider and model refresh controls are separate, timestamps no
  longer squeeze the header, search is visible, and the API-key input/save control heights align.
- `packages/overlay/.scratch/browser-preview-settings-occlusion.png`: Settings is fully visible and the
  native Browser child surface is absent until the final dialog owner releases it.
- `.scratch/multica-import-automatic-repair-completed.png`: import reaches a completed Task with no
  repair/cancel Question.

### Second review corrections

The second call-point and rendered diff review found and corrected seven issues before delivery:

1. Native-surface hook registration now respects an already-active occlusion owner, including the late
   registration failure latch, rather than depending on Browser panel mount order.
2. The Browser test follows the newly restored native lease after Settings closes instead of navigating
   a released lease.
3. Provider refresh timestamps use a dedicated full-width row, preventing header/stat compression.
4. API-key save uses the shared Button primitive's density-backed `control` size instead of a local
   hard-coded height.
5. The empty-workspace Provider fixture now covers the global auth request made by the real page.
6. The Settings browser test uses the current segmented-control primitive selector.
7. The Multica browser test clicks the accessible checkbox label, matching rendered primitive geometry.

The final source review also confirmed that the old Hexin refresh routes and repair/cancel wording remain
only in negative assertions or historical evidence, while Task-owned catalog invalidation has one
authoritative terminal SSE edge.
