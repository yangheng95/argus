# 2026-07-09 Preset Prompt Expert Squad Boundary Cleanup

## Recall

### Original Request

- 用户指出当前编排过度强调 goal，且预置 agent / prompt 写得既详细又不通用。
- 用户要求清理残留，把预置不通用内容严格移动到对应专家团，测试专家团加载是否正常。
- 用户要求预置 prompt 只声明系统性质、职责、专家团来源、调度规则等通用协议。
- 用户要求检查专家团 schema 是否完整正确，因为移走预置 prompt 后专家团里的 sloppy placeholder 会完全失效。
- 用户要求每一步改动都找几个独立 agent 深度复核，并校准到找不到问题。
- 用户追加要求更新校准模板和创建专家团的 skill，并明确模板可以是一个具体任务例子，不要空空荡荡。

### Acceptance Criteria

- 通用 core prompt 不再承载 frontend-replica、web clone、desktop-only、AInvest、rawproject、source IR 等专家团领域策略。
- 领域策略只能存在于对应专家团 package README、selector、role overlay、package skills/tools/MCP 或 project payload 中。
- runtime built-in 只保留 `general` 专家团；非通用专家团只能通过 `.opencorvus/expert-squads/<namespace>/<id>/` 的 project package discovery / resolver / catalog 路径进入。
- `PromptProfileResolver` 仍是唯一 runtime projection surface；不能新增 fallback、alias、second active field、hidden state 或 inactive scan。
- portable expert-squad template 不能放在 runtime discovery root 里，不能污染 production catalog / payload / registry discovery。
- portable template 必须是一个具体任务校准例子，不能是空占位符或 sloppy placeholder。
- 修改必须有针对性测试，覆盖 schema、payload、registry、resolver、selector isolation、prompt hygiene、模板生成和 skill 文档约束。
- 每个阶段都纳入独立 agent 复核反馈，发现问题后修正并复测。

### Hard Constraints

- 禁止 fallback / compatibility / alias / gate。
- 禁止双源 active expert squad。`prompt_profile.active` 是唯一 active 选择来源。
- 禁止让普通 skill import 隐式创建、release、选择或覆盖专家团。
- 禁止把 template 或 sample package 放进 `.opencorvus/expert-squads` 让 registry 发现。
- 禁止无脑 git reset / checkout / worktree。当前工作区已有用户改动，不能回退。
- 所有方案、历史记录、任务 artifact 只能落在 `specs/` 统一结构。
- 代码改动必须配测试；benchmark / 测试通过后仍要二次 review。
- commit subject 必须以 `dsw-33987` 开头，最终 push 到 `myhexin` remote。

### Existing Records Read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-08-expert-squad-release-schema-audit.md`
- `specs/records/2026-07/2026-07-08-expert-squad-project-open-payload-release.md`
- `specs/records/2026-07/2026-07-08-expert-squad-selector-contract-completion.md`
- `specs/records/2026-07/2026-07-07-frontend-tool-portability-boundary.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `specs/records/2026-07/2026-07-07-portable-expert-squad-template.md`
- `specs/records/2026-07/2026-07-07-unified-scheduler-dispatch-tool.md`
- `specs/records/2026-07/2026-07-07-frontend-replica-frontend-design-disconnect.md`
- `specs/records/2026-07/2026-07-07-frontend-innovate-html-design-ground-truth.md`
- `C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator\SKILL.md`
- `C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator\references\open-corvus-expert-squad-checklist.md`
- `C:\Users\chuan\.codex\skills\.system\skill-creator\SKILL.md`

### Whole-Repo Grep And File Inventory

- Expert squad runtime / projection inventory:
  - `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\.jsonc|prompt_profile\.active|select_expert_squad|active_skill_projection|capability_projection" ...`
  - Key files found: `packages/opencorvus/src/expert-squad/*`, `packages/opencorvus/src/config/prompt-profile.ts`, `packages/opencorvus/src/agent/prompt-loader.ts`, `packages/opencorvus/src/project/instance.ts`, server routes, overlay tests, expert-squad tests.
- Embedded / payload / import inventory:
  - `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\(|loadPackage\(|loadSourcePackage\(|importDirectory\(|importArchive\(|exportArchive\(|payload|seed|release" ...`
  - Key files found: `packages/opencorvus/script/generate-expert-squad-payload.ts`, `packages/opencorvus/script/generate-portable-expert-squad-template.ts`, `packages/opencorvus/src/expert-squad/payload.ts`, registry / manager / source package manager tests.
- Package inventory:
  - `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | sort`
  - Key issue found: untracked `.opencorvus/expert-squads/portable-expert-squad-template/package/**` currently sits under registry discovery root and fails registry id/path validation.
- Prompt contamination inventory:
  - `rg -n "frontend|webpage|clone|replica|rawproject|source IR|visual|desktop|AInvest|goal" packages/opencorvus/src/agent packages/opencorvus/src/workflow .opencorvus/expert-squads specs/artifacts`
  - Key files found: `workflow.ts`, `orchestrator-core.txt`, `build-core.txt`, `architect-core.txt`, `requirements-core.txt`, `frontend-design-core.txt`, `frontend-research-core.txt`, `visual-qa-core.txt`, `goal-workload-analyst-core.txt`, several frontend expert squad overlays, portable template residue.

### Independent Agent Feedback

- Confucius audited core prompt and workflow:
  - Core prompt contains non-generic frontend-replica / visual parity / rawproject / web-clone-source / source IR / desktop-only / Frontend Innovate / goal-heavy leakage.
  - `workflow.ts` should preserve `WorkflowRegistry` as workflow authority but should not keep domain strategy prose in generic defaults.
  - Frontend-specific role prompts can keep generic role responsibility but clone / reference parity / desktop policy must move to expert squad overlays.
- Hegel audited expert squad packages and schema:
  - Real packages are mostly schema-complete.
  - Blocker: `.opencorvus/expert-squads/portable-expert-squad-template/package` is a template under runtime discovery root; `ExpertSquadRegistry.discover(repo)` fails because manifest `id: "portable-template"` does not match folder `package`.
  - Focused test result: `bun test packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/portable-template.test.ts` produced 65 pass / 1 fail due to that template path mismatch.
- Ampere audited projection / payload / tests:
  - Actual payload generator is `packages/opencorvus/script/generate-expert-squad-payload.ts`.
  - Project open releases payload before discovery through `releasePayloadPackages()` then registry discovery in `packages/opencorvus/src/project/instance.ts`.
  - `PromptProfileResolver` selects active by manifest id only; general activation exposes project selectors, non-general activation exposes only active package selector.
  - Required tests should cover template exclusion from runtime discovery/payload, active selector isolation, payload script path, missing payload behavior, and projected tool completeness if projections are touched.

## Execution Plan

1. Remove template residue from runtime discovery authority.
   - Update portable template generator so `specs/artifacts/portable-expert-squad-template` is the only template authority.
   - Convert placeholder template content into a concrete task example.
   - Delete the stale `.opencorvus/expert-squads/portable-expert-squad-template` discovery-root residue after proving it is the source of registry failure.
   - Add tests asserting the template root is outside runtime package discovery and excluded from payload.

2. Tighten core prompt hygiene.
   - Reduce generic core prompts to role responsibilities, input/output contracts, evidence expectations, and expert-squad projection protocol.
   - Move or verify movement of frontend-replica / frontend-innovate / benchmark-debug domain instructions into corresponding expert squad packages.
   - Update prompt hygiene tests so they reject domain terms in generic prompt sections and assert the expert squad overlays own those terms.

3. Verify expert squad schema and projection.
   - Add or extend tests for registry schema, manifest completeness, selector markdown, active/inactive package isolation, payload release, resolver surfaces, and catalog projection.
   - Ensure no test relies only on prompt string snapshots when runtime registry / manager / resolver paths are the real authority.

4. Update authoring skill.
   - Update `opencorvus-expert-squad-creator` instructions to require concrete task examples in templates, forbid empty placeholders, require template artifacts under `specs/artifacts`, and require registry / resolver / payload verification.
   - Validate skill file structure and make the checklist reflect the current dynamic project-package architecture.

5. Run validation and independent review loop.
   - Run focused tests after each slice.
   - Re-run independent read-only reviews after prompt and schema changes.
   - Run final focused suite, self-review changed files, commit with `dsw-33987` prefix, and push to `myhexin`.

## Implementation Record

### Runtime Discovery Cleanup

- Removed the stale portable template package from `.opencorvus/expert-squads/portable-expert-squad-template`, because it was a template under the runtime discovery authority and failed manifest id / folder validation.
- Kept the portable template source under `specs/artifacts/portable-expert-squad-template` only.
- Updated `packages/opencorvus/script/generate-portable-expert-squad-template.ts` so the generated authoring flow copies the template to a directory outside `.opencorvus/expert-squads/**`, specializes it, validates it with the registry source-package loader, and only then imports or installs it into `.opencorvus/expert-squads/<namespace>/<id>/`.

### Concrete Template

- Replaced empty/sloppy template language with a concrete `invoice ledger reconciliation` expert-squad example.
- Regenerated the portable template artifact README, selector, manifest, orchestrator append prompt, authoring skill, and virtual-agent role prompts.
- Added tests that reject placeholder language such as `Replace this`, `TODO`, `fill this in later`, `ainvest`, and `Virtual-Agent Stubs`.

### Prompt Boundary Cleanup

- Reduced generic base/core prompts to role responsibilities, source/evidence boundaries, active expert-squad projection protocol, and task-contract handoff semantics.
- Moved frontend-replica policy into `.opencorvus/expert-squads/builtin/frontend-replica/agents/**` overlays, including source IR, `web-clone-source`, `reference.png`, VisualRegionBinding, desktop scope, 1:1 replica, source-baseline adoption, `baseline_replacement_plan`, scroll-slice review, and workload sizing rules.
- Added `goal-workload-analyst` to the frontend-replica manifest/projection and bumped `frontend-replica` version to `2026.07.09`.
- Cleaned `packages/opencorvus/src/orchestrator/tools.ts`, `packages/opencorvus/src/engine/workflow.ts`, `orchestrator-core.txt`, `build-core.txt`, and `architect-core.txt` so model-visible descriptions no longer define frontend-replica or frontend-innovate strategy.
- Preserved existing structured data keys such as `webpage_contract`, `frontend_research_brief`, `webpage_evidence`, `baseline_replacement_plan`, and `competitor_reference_evidence` where they are schema/artifact/decision-log fields, because renaming those keys would be a separate data-contract migration rather than prompt cleanup.

### Skill Update

- Updated external skill files:
  - `C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator\SKILL.md`
  - `C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator\references\open-corvus-expert-squad-checklist.md`
- The skill now states the runtime authority as `.opencorvus/expert-squads/<namespace>/<id>/`, keeps portable templates under `specs/artifacts`, requires concrete task examples, forbids template/sample packages in runtime discovery roots, and requires registry/resolver/payload validation for loading/projection changes.

## Calibration Record

- Carver schema/projection review initially found no loader breakage but required:
  - bumping `frontend-replica` version after adding overlay content;
  - a resolver test proving `goal-workload-analyst` overlay composes only when `frontend-replica` is active;
  - a payload release test proving released payload packages can compose the same overlay;
  - a payload semantic assertion for `agents/goal-workload-analyst/system.md`.
- These items were implemented in `expert-squad.jsonc`, `prompt-profile-resolver.test.ts`, and `payload-generation.test.ts`.
- Godel template/skill review found no required fixes after the concrete template and skill checklist changes.
- Gauss prompt-boundary review initially found remaining model-visible strategy text in `orchestrator/tools.ts`, `workflow.ts`, `orchestrator-core.txt`, and `build-core.txt`.
- Those findings were fixed by replacing replica/innovate strategy wording with active-contract / active-overlay language, while preserving stable workflow id `frontend_innovate`.
- Gauss follow-up review found no remaining must-fix issues and explicitly accepted the remaining schema/artifact keys as structured data rather than prompt strategy.

## Validation Record

- `rg -n "Webpage-evidence-grounded|frontend replica scope|Frontend Innovate|HTML design draft|competitor/reference evidence|competitor evidence|selected-direction|webpage investigation|webpage_clone_artifacts|truthful parity|reference-parity mismatch|reference implementation or visual parity|webpage/UI source-investigation|web-clone-source|Page Skeleton Blueprint|SourceDomPage|source-baseline adoption rule|webpage-clone implementation contract|browser_preview_compare_scroll_slices" packages/opencorvus/src/prompt/core packages/opencorvus/src/agent/prompt packages/opencorvus/src/engine/workflow.ts packages/opencorvus/src/orchestrator/tools.ts` returned no matches.
- `bun test --timeout 30000 packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`: 61 pass.
- `bun test --timeout 30000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`: 42 pass, 45 skip.
- `bun test --timeout 30000 packages/opencorvus/test/expert-squad/portable-template.test.ts packages/opencorvus/test/expert-squad/payload-generation.test.ts`: 10 pass.
- `bun test --timeout 30000 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts`: 101 pass, 1 skip.
- `bun test --timeout 30000 packages/opencorvus/test/agent/final-system-prompt-audit.test.ts packages/opencorvus/test/agent/role-contract.test.ts`: 18 pass.
- `python C:\Users\chuan\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator`: passed earlier after skill edits.

## Remaining Non-Goal State

- `AGENTS.md` is still modified in the worktree from outside this cleanup and was not edited or reverted by this task.
