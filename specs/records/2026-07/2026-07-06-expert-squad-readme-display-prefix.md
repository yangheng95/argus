# Expert Squad README Display Prefix

Date: 2026-07-06
Status: Implemented

Supersession note: the README-owned display-prefix protocol was removed on
2026-08-03. Current catalog display omits the canonical `builtin` namespace and
uses exact `namespace/label` for every other package.

## Recall

| Item | Details |
| --- | --- |
| User request | Add `Builtin/` before preset expert squads, and allow third-party expert squads to read their display prefix from `README.md`. The screenshot shows the composer expert-squad selector currently listing plain labels such as `General`, `Algorithm`, `Backend`, and `Frontend Replica`. |
| Acceptance criteria | Preset shipped expert squads show a `Builtin/` prefix in the overlay selector/settings display; third-party packages can declare the same display prefix through README metadata; prefix is display-only and must not affect manifest ID, package identity, active selection, selector skill names, package roots, import/export identity, or runtime projection. |
| Hard constraints | No fallback or compatibility alias; no folder/name guessing; no second active expert-squad source; `prompt_profile.active` remains the only active selection source; manifest `id` remains identity; catalog/resolver remains the backend projection source; no UI-only source-kind inference; update tests with code changes; preserve unrelated dirty worktree changes. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/current/architecture/04-extensions.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`; `specs/records/2026-07/2026-07-05-expert-squad-payload-seeding-and-skill-refresh.md`; `specs/records/2026-07/2026-07-05-overlay-expert-squad-settings-redesign.md`; `specs/records/2026-07/2026-07-06-expert-squad-decoupling-agents-rule.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`. |
| Repository search | `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`; `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test`; `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test`; `rg -n "readmeContent|readme\\.content|display_label|displayPrefix|display_prefix|Built.?in|builtin|built_in|ExpertSquadCatalogSummary|squad\\.label|option\\.label|profile\\.label|activeSquadLabel|expertSquads\\(|setExpertSquads|data-expert-squad" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test .opencorvus/expert-squads packages/opencorvus/src/expert-squad/builtin -g "*.ts" -g "*.tsx" -g "*.json" -g "*.jsonc" -g "*.md"`. |
| Findings | `ExpertSquadRegistry` is the single package read path for filesystem and embedded packages; catalog summaries are built through `catalogSummaryFromPackage`; overlay composer and settings page consume `ExpertSquadOption.label`; selector browser tests already screenshot and inspect selector options; preset non-general squads are payload-released into project packages, so source kind alone cannot identify them without guessing. |
| Independent agent feedback | Not used. The change is narrow, and prior expert-squad records already establish the package identity/projection boundaries. |

## Design

Use README front matter as the package-owned display metadata source:

```yaml
---
expert_squad_display_prefix: Builtin
---
```

The registry parses README with the existing mature `gray-matter` parser and exposes:

- `readmeContent`: README body without front matter, used for the Orchestrator append prompt and catalog README preview.
- `displayPrefix`: optional, validated README metadata.

The catalog layer derives:

- `display_prefix`: optional string copied from `displayPrefix`.
- `display_label`: `display_prefix + "/" + label` when a prefix exists, otherwise the manifest label.

The overlay must render `display_label` for selector, overview active labels, list rows, and detail headers. It must keep `label` as the manifest label for identity-inspection contexts and never infer a prefix from `source.kind`, path, id, or built-in status.

Preset packages declare `expert_squad_display_prefix: Builtin` in their README. Third-party packages can use the same field. Missing prefix means no prefix; malformed prefix fails package loading because the README metadata was present but invalid.

## Implementation Plan

1. Extend `ExpertSquadRegistry` package types and README parsing with validated optional `displayPrefix`.
2. Extend `ExpertSquadCatalogSummarySchema` and overlay `ExpertSquadOption` with `display_prefix` and `display_label`.
3. Update shipped README files for `general` and repository payload expert squads to declare `Builtin`.
4. Update overlay composer/settings display to use `display_label`.
5. Update registry, resolver/catalog route, overlay service, and browser selector tests.
6. Validate with focused expert-squad tests, overlay tests, Node-launched browser test screenshots, docs link health, typecheck, and `git diff --check`.

## Implementation

- `ExpertSquadRegistry` now parses README front matter with `gray-matter`, validates optional `expert_squad_display_prefix`, strips front matter from prompt/catalog README content, and fails package loading on malformed prefix metadata.
- Catalog summaries now expose `display_prefix` and derived `display_label`; the overlay service contract treats `display_label` as required display text.
- Composer selector and settings expert-squad panel render `display_label` instead of deriving display names from `label`, source kind, package path, or built-in status.
- Preset shipped expert squad README files declare `expert_squad_display_prefix: Builtin`.
- SDK/OpenAPI generated artifacts were regenerated from the route schema.

## Validation

- `bun test packages/opencorvus/test/expert-squad/registry.test.ts`: passed.
- `bun test packages/opencorvus/test/expert-squad/catalog-display-prefix.test.ts`: passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "loads project package profiles into the catalog"`: passed.
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts`: passed.
- `bun test --timeout 30000 packages/opencorvus/test/server/config-routes.test.ts -t "GET /expert-squad/catalog returns full active expert-squad catalog"`: passed.
- `bun test packages/opencorvus/test/agent/prompt-profile.test.ts -t "built-in prompt-profile source contains only general while payloads seed project catalog"`: passed.
- `bun test --timeout 30000 packages/opencorvus/test/agent/prompt-profile.test.ts -t "profile catalog exposes built-in default and project package-backed definitions"`: passed.
- `bun test packages/overlay/test/expert-squad-settings-surface.test.ts packages/overlay/test/expert-squad-scope.test.ts packages/overlay/test/expert-squad-lifecycle-service.test.ts`: passed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: passed.
- `bun run api:routes-check`: passed after SDK/OpenAPI regeneration.
- `bun run docs:check`: passed.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts`: passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-selector-browser.test.ts packages/overlay/test/browser/expert-squad-panel.test.ts`: passed and produced `.scratch/expert-squad-selector-runtime-highlighted-en-US.png`, `.scratch/expert-squad-selector-runtime-highlighted-zh-CN.png`, `.scratch/expert-squad-settings-panel.png`, and `.scratch/expert-squad-settings-agent-overlays.png`.
- Manual screenshot review: English and Chinese selector options show `Builtin/...`; settings panel project/effective active labels, list rows, and detail header show `Builtin/...`; README body does not show README front matter.
- `git diff --check`: passed.

## Residual Notes

- Full `bun test packages/opencorvus/test/agent/prompt-profile.test.ts` is still blocked by existing dirty frontend-replica overlay content exceeding the unrelated prompt overlay length guard (`frontend-replica.architect` length 1510 > 1400). The filtered catalog tests covering this change pass.
- Full `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` hit several existing 5 second MCP-heavy test timeouts when run as a whole; the display-prefix catalog summary test passes in isolation.
