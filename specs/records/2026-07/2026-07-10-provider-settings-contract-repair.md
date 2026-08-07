# 2026-07-10 Provider Settings Contract Repair

Status: source repair, focused acceptance, and authorized live-process verification complete; clean commit and full-repository acceptance remain blocked by the preserved concurrent worktree.

## Recall

### User Request

- Diagnose and fully repair the Provider settings failure that prevents model selection across Provider, project-default, per-agent, session, composer, and executor surfaces.
- Preserve the strict no-fallback architecture: stale expert-squad manifests, retired Skill metadata, and invalid model catalogs must not be silently accepted.
- Complete the repair with focused tests, real local API evidence, a real rendered Provider page screenshot, manual second review, commit, and push to `myhexin`.

### Acceptance Criteria

1. `GET /provider` and `GET /config/providers` return 200 for a catalog containing the current models.dev `experimental.modes` object contract.
2. The canonical model schema represents `experimental.modes` explicitly. The retired boolean `experimental` shape is rejected rather than accepted through compatibility logic.
3. Explicit Provider refresh validates and atomically writes the same canonical catalog contract used by normal reads.
4. Opening Settings does not make Provider/model data depend on `config/prompt`. Provider, prompt, configuration/channel, and authentication owners commit only their own validated responses.
5. A prompt or Skill failure remains visible and explicit but does not erase a successfully loaded Provider catalog or disable unrelated model selectors.
6. The retired ordinary-Skill fields `agents` and `mounted_agents` remain rejected by OpenCorvus. Installed repository/user assets used by the real runtime contain neither field.
7. Expert-squad v1 remains strict: old `role_base` stays rejected; runtime/package sources use `base_role` plus `inherit_base_tools`; no alias or compatibility parser is added.
8. The Provider page shows a non-empty catalog and usable model controls in a real isolated desktop render. The screenshot is inspected manually after the browser benchmark passes.
9. Focused provider, Skill, expert-squad, server-route, Overlay load, browser, typecheck, documentation-health, and `git diff --check` validation pass.
10. No current OpenCorvus/Overlay process is restarted, refreshed, closed, or killed without explicit user authorization.

### Hard Constraints

- No fallback, stale-data substitution, compatibility alias, silent schema stripping, or second model/expert-squad source.
- `models.json` is the one Provider catalog read source; explicit refresh replaces that file only after the same strict schema succeeds.
- `prompt_profile.active` remains the only active expert-squad selector and `PromptProfileResolver` remains the only capability-projection owner.
- Ordinary Skill metadata cannot carry agent authorization. Qualified `skill_mounts` and expert-squad projections remain the only owners.
- Preserve unrelated dirty worktree changes. Use focused patches and focused diffs; do not use Git reset or create a worktree.
- Tests and subprocess checks use stdout/stderr inactivity supervision rather than elapsed wall-clock timeout.
- Frontend acceptance requires an isolated real page, screenshot inspection, and correction if the rendered Provider surface is not usable.
- Commit subjects use the `dsw-33987` prefix and delivery targets `myhexin/v0.0.2beta` without bypassing hooks.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/06-provider.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-09-external-expert-squad-schema-base-role.md`
- `specs/records/2026-07/2026-07-10-dynamic-expert-squad-agent-identity.md`
- `specs/records/2026-07/2026-07-10-iteration-technical-debt-remediation.md`
- Current provider, Skill, expert-squad, configuration-route, Overlay settings-load, Provider panel, model-selector, and focused-test sources.
- Live sidecar responses from `127.0.0.1:7878` and the current `https://models.dev/api.json` payload.

### Whole-Repository Search Evidence

Commands executed before this record was written:

```powershell
rg -l "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\.jsonc|prompt_profile\.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records
rg -l "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\(|loadPackage\(|loadSourcePackage\(|importDirectory\(|importArchive\(|exportArchive\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test
rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test
rg -n "ModelsDev\.(Model|Provider|Data|get|refresh|catalogPath)|experimental|providerCatalog|loadSettingsInfo|loadProviderInfo|loadConfigInfo|config/prompt|config/providers" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"
rg -n --hidden -g "SKILL.md" "^(agents|mounted_agents):" . C:/Users/chuan/.claude/skills C:/Users/chuan/.agents/skills C:/Users/chuan/.codex/skills C:/Users/chuan/.opencorvus/skills C:/Users/chuan/.opencorvus/skill
rg -n --hidden -g "!node_modules" -g "!.git" "role_base" .
```

Findings:

- Provider catalog reads and explicit refresh converge in `provider/models.ts`, but the newly strict parser validates a historical boolean `experimental` field against a live object-valued upstream contract.
- Both `/provider` and `/config/providers` consume that same failing catalog, so Provider settings, Agent Models, composer model selection, and executor model selection lose their only model inventory.
- Settings bootstrap currently groups config, channel, Provider, Provider auth, and prompt catalog in one `Promise.all` and commits nothing when any member fails.
- `config/prompt` resolves prompt-profile capability context, which loads ordinary Skills; the only installed global retired field found is `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md: mounted_agents: []`.
- Current repository expert-squad runtime/package sources contain no `role_base`; remaining matches are historical records, rejection tests, and one stale comment. The screenshot error matches the pre-`9da4495608` manifest contract, not the current source contract.
- The current dirty worktree contains concurrent provider, Skill, expert-squad, Overlay, and technical-debt refactors. This task owns only the focused Provider/settings contract increments and the exact persistent asset blocking the live runtime.

### Independent-Agent Feedback

- No sub-agent was started. Current collaboration policy permits delegation only when the user explicitly requests sub-agents or parallel agent work.

## Causal Chain

```text
models.dev experimental.modes object
  -> ModelsDev boolean schema rejects canonical catalog
  -> /provider and /config/providers return 500
  -> every model inventory consumer has no selectable models

retired installed Skill metadata or stale expert-squad package
  -> /config/prompt returns 500
  -> settings-wide atomic Promise.all rejects
  -> even unrelated successfully fetched settings data is not committed
```

The deep cause is a non-atomic contract rollout across parser, durable assets, external catalog data, packaging, and UI ownership. Strict rejection is correct; allowing one owner's failure to invalidate unrelated owners is not.

## Benchmark Definition

### Input and Output

- Input: a models.dev-shaped catalog containing object-valued `experimental.modes`, a valid current expert-squad package, a deliberately invalid legacy package/Skill fixture, and an Overlay settings bootstrap where `config/prompt` fails while Provider succeeds.
- Output: canonical model routes and model selectors succeed; invalid legacy assets fail at their authoritative boundary; Provider remains rendered and usable when Prompt fails; no stale data is silently substituted.

### Environment

- Windows host repository: `C:/Users/chuan/myhexin-local/opecorvus`.
- Unit and route tests use test-owned temporary `OPENCORVUS_HOME`, catalog files, project directories, and databases.
- Browser validation uses the existing Node-launched Overlay browser fixture or a separate isolated local service. The live user Overlay is read-only unless restart authorization is granted.

### Timeout

- Focused child processes use `packages/opencorvus/script/run-with-inactivity.ts` or the repository's equivalent stdout/stderr inactivity runner.
- Default focused inactivity interval: 120 seconds without output. Browser/build checks may use a larger documented inactivity interval when continuous output proves activity.

### Executable Acceptance Matrix

1. Provider schema unit tests accept `experimental.modes` and reject boolean `experimental`.
2. Provider read and refresh tests use the same parser and prove invalid catalogs are not written.
3. `/provider` and `/config/providers` return a non-empty catalog under a production-shaped fixture.
4. Settings-load tests prove Prompt failure cannot clear or block Provider/config/channel commits, and Provider failure cannot be misreported as an empty catalog.
5. Skill tests keep retired-field rejection; the real installed skill inventory contains no retired fields after provisioning repair.
6. Expert-squad registry/package/prompt route tests keep current v1 strictness and reject old `role_base`.
7. A real isolated Provider page screenshot shows catalog entries and usable model controls; console/network evidence contains no unexpected error.
8. Focused suites, package typechecks, docs health, API route checks as touched, and `git diff --check` pass.
9. Manual second review finds no fallback, compatibility path, stale source, or cross-owner atomic coupling in the touched surfaces.

## Planned File Disposition

| Surface | Disposition |
| --- | --- |
| `packages/opencorvus/src/provider/models.ts` | Replace the obsolete boolean experimental schema with the explicit current object contract; keep one strict parser for read and refresh. |
| Provider tests | Add production-shaped object-contract and invalid-write regressions. |
| `packages/overlay/src/services/config-load.ts` | Split Provider and Prompt into independent validated owner commits while keeping each owner's own requests atomic. |
| Overlay settings tests | Replace settings-wide all-or-nothing expectations with owner-isolation and explicit failure assertions. |
| Provider/model browser fixture | Exercise Prompt failure plus successful Provider rendering, then the all-success model-selection path. |
| Installed benchmark Skill | Remove the retired empty `mounted_agents` field; do not add compatibility parsing. |
| Expert-squad sources/tests | Preserve current strict schema; change only if a focused validation proves a current package/payload remains stale. |
| Specs index | Index this record and run documentation-health checks. |

## Implementation and Evidence

- `provider/models.ts` now models object-valued `experimental.modes` explicitly. The focused suite proves the current object contract succeeds, the retired boolean fails, and a schema-invalid refresh leaves the canonical catalog unchanged.
- Overlay settings loading now has three explicit owners: config/channel, Provider/auth, and Prompt. Owner commits remain internally atomic, while settings-wide refresh uses `Promise.allSettled` only to collect and rethrow failures after successful owners have committed.
- Prompt catalog resolution distinguishes a projected expert-squad worker from a native or custom standalone catalog agent. A native `coding` prompt no longer fails merely because the active `general` squad does not project that agent.
- The retired `mounted_agents` field was removed from `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`; strict ordinary-Skill rejection tests remain green.
- Real Node-launched browser acceptance passed all five Provider/auth cases. The inspected screenshot is `.scratch/provider-settings-prompt-owner-failure.png`; it shows a non-empty Anthropic catalog, one model, search, refresh/add actions, and an enabled API-key control while the independent Prompt owner returns an invalid response shape.

### Passing validation

```text
33 pass, 0 fail — provider schema/refresh/routes plus Overlay owner-load and directory-scope tests
5 pass, 0 fail — packages/overlay/test/browser/provider-auth-panel.test.ts (Node browser runner)
1 pass, 0 fail — focused GET /config/prompt effective-prompt route
ordinary Skill suite — all 25 executed Skill tests pass, including retired agents/mounted_agents rejection
packages/opencorvus typecheck — pass
packages/overlay typecheck — pass
historical-docs-links.test.ts — 20 pass
git diff --check — pass
live models.dev schema probe — 154 providers, 39 models carrying valid experimental.modes
local canonical catalog probe — 147 providers, 5,337 models
```

### Repository-wide failures outside this repair

- The concurrent expert-squad refactor is internally inconsistent: its full resolver/config suite reports 46 failures. Fixtures still contain retired top-level `agents`, omit required projection `label`, refer to removed `virtual-agents`, and call resolver APIs absent from the current implementation. The Provider-specific general prompt route passes after this repair; no compatibility parser was added for the broken expert-squad fixtures.
- Documentation health initially reported two repository-index failures involving concurrent July records and a local planning draft. The later integrity recovery formally indexed those records and removed the draft-path dependency; historical-link validation remained green.
- The working tree contains hundreds of unrelated concurrent modified/untracked files, including pre-existing changes in several files this repair had to touch. Creating a focused commit would capture unrelated work or produce an index state that does not represent a buildable tree, so no commit or push was performed.

## Authorized Live Verification

The user explicitly authorized startup and testing. Port 7878 had no listener, so no existing OpenCorvus/Overlay process was terminated. Current workspace source was started as process 42960 on `http://127.0.0.1:7878` with the repository as `--project-dir`.

Live API evidence:

```text
/global/health       200, version=local
/provider            200, 147 providers, 6 connected, 147 defaults
/config/providers    200, 6 configured providers, 6 defaults
/config/prompt       200, 19 prompt entries
```

The in-app browser loaded `http://localhost:7878/ui/` with connection status `online` and verified:

- Provider settings rendered 147 catalog rows, 6 configured providers, one search control, Refresh, and Add.
- Searching `hexin` reduced the catalog to exactly one `Hexin OpenAI Gateway` row with 42 models and connected status.
- Agent Models rendered a project-default selector plus all agent selectors; each tested selector contained 84 model options.
- A reversible project-default save selected `hexin/kimi-k2.6`; the project-scoped `/config` response returned the same model. Restoring the empty project override removed `model` and returned the UI to inherited global configuration.
- A reversible `coding` agent save selected `hexin/kimi-k2.6`; `/config` returned `agent.coding.model=hexin/kimi-k2.6`. Restoring the empty override removed that project-scoped value.
- Browser console inspection returned no errors or warnings.
- Manually inspected live screenshots: `.scratch/provider-settings-live-7878.png` and `.scratch/agent-models-live-7878.png`.

The live service remains running on port 7878 for user verification. One unrelated server diagnostic remains outside this repair: MCP startup for the previously selected economy project logged a closed instance-cache lease, without affecting Provider or model selection.

## Second Review

- No boolean compatibility union, stale catalog substitution, empty Provider fallback, or swallowed Prompt error was introduced.
- Normal reads and explicit refresh still converge on one strict model schema and one canonical catalog file.
- Provider/auth remain one atomic owner; Prompt cannot erase their successful commit.
- Screenshot inspection found both the Provider and Agent Models panels readable and interactive in the authorized live process; no visual correction was required.
- Provider/model-selection acceptance is complete. Repository-wide delivery is not marked complete until the concurrent tree is reconciled enough for a coherent commit/push and the unrelated expert-squad/document-health failures are resolved.
