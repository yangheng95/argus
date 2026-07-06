# Frontend Automation Debug Expert Contract

Date: 2026-07-06
Status: Implemented

Supersession note: `2026-07-06-expert-squad-namespaced-source-layout.md` supersedes this record's direct-child package path assumptions. Current `frontend-automation-debug` source is `.opencorvus/expert-squads/builtin/frontend-automation-debug/`, and selector projection now requires explicit project package installation rather than read-path payload release.

## Recall

| Item | Details |
| --- | --- |
| User request | The `frontend-automation-debug` expert squad lacks a formal definition of deep thinking and does not deserve the expert label as currently written. Define what makes debugging expert-grade. |
| Acceptance criteria | `frontend-automation-debug` must define expert-grade debugging as an evidence-backed causal discipline, not a generic "debug harder" instruction. Selector, active README prompt, and role overlays must carry the same contract through current expert-squad package loading. Tests must prove the package/payload/resolver path exposes the updated contract. |
| Hard constraints | No fallback, compatibility alias, host-side gate, routing bypass, second active expert-squad source, prompt-profile built-in regression, or process restart. Keep `prompt_profile.active` and `PromptProfileResolver` as the single runtime projection path. Preserve unrelated dirty worktree changes. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/current/architecture/04-extensions.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`; `specs/records/2026-07/2026-07-05-expert-squad-payload-seeding-and-skill-refresh.md`; `specs/records/2026-07/2026-07-06-expert-squad-decoupling-agents-rule.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`; current `frontend-automation-debug` package README, selector, manifest, and role overlays. |
| Repository search | `rg -n "frontend-automation-debug" .opencorvus packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test specs/current specs/records/2026-07 -g "*.ts" -g "*.tsx" -g "*.md" -g "*.jsonc" -g "*.html"`; `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server/expert-squad-routes.test.ts packages/overlay/test/browser/expert-squad-panel.test.ts specs/current/architecture/04-extensions.md specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md specs/records/2026-07/2026-07-05-expert-squad-payload-seeding-and-skill-refresh.md`; `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server/expert-squad-routes.test.ts`; `rg -n "deep thinking|深入|root cause|根因|causal|causality|hypothesis|反证|evidence chain|failure model|debug" .opencorvus/expert-squads/frontend-automation-debug .opencorvus/expert-squads/frontend-replica .opencorvus/expert-squads/frontend-innovate specs/records/2026-07 -g "*.md"`. |
| Findings | The current selector and role overlays require reproduction and evidence but do not formalize a debug reasoning model. They do not require an observable symptom to direct trigger to deeper cause chain, falsified alternatives, or an explanation for why previous/narrow fixes would not root-cause the failure. Payload sources import the repository `.opencorvus/expert-squads/builtin/frontend-automation-debug` files directly, so editing existing package files updates future payload releases without adding a second generated source. Existing project packages are not overwritten by payload release, so the currently open demo project package must be updated explicitly if it should reflect the same definition. |
| Independent agent feedback | Not used. This is a package prompt-contract repair with direct source, registry, payload, and resolver validation. |

## Design

A frontend debug expert is not defined by title, tool count, or willingness to retry. The expert definition is a falsifiable causal-debug contract:

1. Preserve the original failure path as the evidence anchor: command, page, interaction, selector, browser evidence, screenshot, trace, console/runtime error, network error, or preview target.
2. Reproduce the failure before repair when the path is not already proven; if direct reproduction is impossible, cite the durable evidence that proves the same path.
3. Build a layered failure model across automation harness, browser runner, preview target, fixture/state, selector/assertion, component/service/style, runtime environment, and acceptance evidence.
4. State competing hypotheses and the evidence that supports or rejects them.
5. Produce the causal chain: observable symptom -> direct trigger -> owning code/tool path -> deeper design/data-flow cause -> why prior or superficial fixes did not root-cause it.
6. Repair the proven owner without fallback, broad sleeps, selector churn, route gates, compatibility aliases, or unrelated cleanup.
7. Prove the result with the original command path, targeted regression test, browser or screenshot evidence for visible behavior, and a second review that checks the evidence cannot be a false green.

The package should express this once at package level, expose it in selector instructions before the Orchestrator chooses the profile, and reinforce it in key role overlays. It must not add host-side enforcement logic or a second workflow.

## Implementation Plan

1. Update `frontend-automation-debug` README and selector with the expert debug contract.
2. Update key role overlays so Orchestrator, Explore, Architect, Build, Visual quality assurance (Visual QA), Integrity, Fact Check, Requirements, Coding, Coding Assistant, and General preserve the same causal model.
3. Add focused tests that prove the contract is present through embedded payload package loading and general selector-skill projection after payload release.
4. Sync the currently open demo project package prompt files with the same content because payload release intentionally does not overwrite existing project packages.
5. Validate registry/package-manager/resolver/docs paths and run `git diff --check`.

## Validation Plan

```powershell
bun test packages/opencorvus/test/expert-squad/package-manager.test.ts -t "frontend automation debug payload carries the expert causal-debug contract"
bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "projects selector skills only from explicitly installed project packages"
bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "projects repository software-testing selector, scheduler tools, and worker tools"
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
```

## Implementation

- Added the Expert Debug Contract to the `frontend-automation-debug` package README and selector.
- Propagated the same causal-debug obligation into the package role overlays so Orchestrator, Explore, Architect, Build, Visual quality assurance, Integrity, Fact Check, Requirements, Coding, Coding Assistant, General, and related analysis roles preserve the failure model instead of patching symptoms.
- Added package-manager and resolver assertions proving the contract is present in embedded payload package loading and general selector-skill projection.
- Synced the currently open demo project package copy because payload release does not overwrite existing project packages.

## Validation Results

- Passed: `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts -t "frontend automation debug payload carries the expert causal-debug contract"`; 1 pass, 0 fail.
- Passed: `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "projects selector skills only from explicitly installed project packages"`; 1 pass, 0 fail.
- Passed: `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "projects repository software-testing selector, scheduler tools, and worker tools"`; 1 pass, 0 fail.
- Previous broad run without a custom timeout, `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts`, produced 105 pass, 8 fail, 5 errors in 191.28s. The contract payload test and historical-docs tests passed inside that run. One failure was the concurrent `software-testing` inventory expectation missing `test_md`; that assertion is now fixed and the focused test passes. The remaining failure class is existing MCP projection tests exceeding Bun's 5000ms per-test wall-clock timeout, which kills MCP child processes and causes connection-closed follow-on errors. That is a test-harness timeout issue, not evidence against the frontend debug contract, and it was not hidden by raising a mechanical timeout.
