# Expert Squad Built-in Update Version Recovery

Date: 2026-07-23

Status: Implemented and verified

## Recall

### User requirement

Explain and repair why `Update from built-in` appeared ineffective while a newly opened Prism task still loaded stale expert-squad manifests.

### Acceptance criteria

- Preserve explicit package ownership: installing or releasing payload packages must not silently overwrite an existing project or global package.
- Make the bundled available version and the actually installed manifest version separately visible in the Market contract and Overlay.
- Mark an installed bundled package as update-available when those versions differ or the installed manifest has no valid version.
- Keep Market and the explicit built-in update action reachable when strict catalog loading fails.
- Show exact repair actions in the catalog-error surface and refresh both Market and catalog after a successful update.
- Cover Manager, server route, generated SDK, Overlay contract, and browser-visible recovery behavior.

### Hard constraints

- Do not weaken Registry validation, auto-update packages, infer package identity from names, or add a fallback loader.
- `prompt_profile.active` remains unchanged by package update.
- Package replacement continues through the atomic Manager update path and exact installation scope.
- Preserve the unrelated user edit in `2026-07-22-mirror-prism-full-workflow-distillation.md`.
- Do not restart the running OpenCorvus or Overlay process.

### Sources read

- `packages/opencorvus/src/expert-squad/{manager,registry}.ts`
- `packages/opencorvus/src/server/{project-route-context,server}.ts`
- `packages/opencorvus/src/server/routes/expert-squad.ts`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/services/expert-squad.ts`
- `packages/opencorvus/test/{expert-squad/package-manager,server/expert-squad-routes}.test.ts`
- `packages/overlay/test/browser/expert-squad-panel.test.ts`
- OpenCorvus server logs for 2026-07-22 16:08Z and the Prism package/catalog evidence captured in this task.

### Whole-repository search evidence

| Search | Finding and disposition |
| --- | --- |
| `rg -n "releasePayloadPackages|installPayloadPackage|updatePackage" packages/opencorvus` | Install/release intentionally preserve an existing package; explicit `updatePackage(source: "builtin")` is the only bundled replacement path and must remain so. |
| `rg -n "PayloadMarketItem|installation_scope" packages` | Market publishes the embedded payload version and installation scope but no installed version, so UI cannot detect drift. Update Manager, route schema, generated SDK, tests, and Overlay consumers. |
| `rg -n "catalogError|catalog_recovery" packages/overlay` | The details-page recovery card contains guidance only. Market is loaded independently and remains reachable, so the same card can expose exact stale-package update actions without parsing an error string. |
| Server request log inspection | Prism sent successful update requests at 16:08Z from a `0.0.15-beta` process, so it faithfully reinstalled that process's old payload. No later update POST accompanied the v0.0.16 catalog failure. |

### Independent agent feedback

No sub-agent was requested or used. The primary agent will perform the required second review.

## Causal chain

`Update from built-in` means “replace from the payload embedded in the currently running application,” not “download the newest repository package.” Prism's requests succeeded while the serving process was v0.0.15, so old payload bytes were installed. After v0.0.16 introduced stricter valid Task-scoped packages, project ownership correctly prevented automatic replacement. The Market then hid the drift because its `version` field came only from the available embedded payload, while `installation_scope` merely proved that some same-ID package existed. Catalog failure removed the installed-squad detail surface, leaving no visible exact update candidate. The update engine is correct; version observability and recovery UI are incomplete.

## Implementation plan

1. Extend identity-only installed package discovery with a nullable, strictly parsed manifest version without invoking full package validation.
2. Extend Manager Market items and the API schema with `installed_version` and `update_available`, retaining `version` as the bundled available version.
3. Regenerate the SDK and update Manager/server contract tests for absent, current, stale, and malformed installed versions.
4. Show available and installed versions in Market and expose only exact `update_available` package buttons in the catalog-error recovery card.
5. Extend the browser test to prove a catalog failure still exposes and executes the built-in update, then restores the catalog.
6. Run focused Manager/route/Overlay tests, generated-artifact checks, typecheck, docs/routes/i18n checks, second diff review, commit, and push to `myhexin/v0.0.16beta`.

## Implementation result

- Identity-only discovery now reports a nullable, strictly parsed installed manifest version without weakening full Registry validation.
- Market reports `version` as the available embedded version, `installed_version` as the project/global package version, and `update_available` as their structured drift signal.
- The details-page catalog recovery surface remains usable when strict catalog loading fails and exposes only exact installed bundled packages whose versions differ.
- A successful explicit update refreshes Market and catalog; package activation, installation scope, and explicit ownership semantics remain unchanged.
- The recovery action was grouped with its explanatory content after visual review so it no longer renders in the icon column.

## Validation record

- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 120000` — passed, including absent/current/stale installed versions and explicit built-in replacement.
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 120000` — passed, including malformed stale package recovery before full project bootstrap.
- `bun test packages/overlay/test/expert-squad-lifecycle-service.test.ts --timeout 120000` — passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-panel.test.ts` — passed all four browser cases; the failure surface exposed the exact version-drift update, executed it, and restored catalog loading.
- `.scratch/expert-squad-catalog-error-recovery.png` — visually reviewed after the layout correction.
- `bun run typecheck`, `bun run docs:check`, `bun run api:routes-check`, and `bun run --cwd packages/overlay check:i18n` — passed.
- Historical docs, product-doc single-source, document-health, Overlay settings-surface, and SDK build-format contract tests — passed.
- Second review found no automatic overwrite, Registry fallback, error-text parsing, active-squad mutation, or scope inference path.
