# 2026-07-09 External Expert Squad Schema Base Role

## Recall

### User Request

- 用户追问完整 prompt 是否由 agent 自身 prompt 加预置 prompt 组成。
- 用户进一步指出当前专家团 agent 只能隐式继承同名 base role；如果声明不支持的 role 会失败。
- 用户要求重新设计外置专家团 schema，使外置专家团可以声明自己的 agent identity，同时显式绑定 OpenCorvus 内置 base role。

### Acceptance Criteria

- 外置专家团 manifest 必须显式区分 `projection id` 与 `base_role`。
- `capability_projection.agents.<projection_id>` 的 key 是专家团自己的 agent/projection identity，不再必须是 `AgentRoleID`。
- 每个 worker projection 必须声明 `base_role`，且 `base_role` 必须是合法 `AgentRoleID`。
- 旧布尔字段 `role_base` 必须被替换为语义明确的 `inherit_base_tools`，不能与新字段并存。
- prompt 组合必须按 `base_role` 选择预置 prompt，按 `projection id` 选择专家团 overlay / virtual-agent prompt / package resources。
- workflow dispatch 仍使用现有 base role / workflow target，不使用 virtual-agent ID 或 projection ID 作为 `dispatch_agent.target`。
- 如果一个 active expert squad 对同一 `base_role` 声明多个 projection，必须加载失败，不能猜默认。
- package refs、skills、tools、MCP ownership 必须按 `projection id` 所在目录归属；运行时执行语义仍按 `base_role`。
- `PromptProfileResolver` 仍是唯一 runtime projection surface；不能新增 fallback、alias、second active field、inactive scan。
- 更新真实 packages、portable template、payload、registry/resolver/catalog tests，验证 custom projection ID 可加载、可组合 prompt、可投影工具，并验证旧 schema 被拒绝。

### Hard Constraints

- 禁止 fallback / compatibility / alias / gate。
- 禁止保留旧 `role_base` 和新 `base_role` 的双源语义。
- 禁止把 unsupported role 静默映射到 `general` 或其它默认 role。
- `prompt_profile.active` 仍是唯一 active expert-squad 选择来源。
- 非 `general` 专家团仍只能通过 `.opencorvus/expert-squads/<namespace>/<id>/` package discovery / resolver / catalog 路径进入。
- 不创建新 worktree，不重启或刷新 OpenCorvus / overlay 运行进程。
- 当前工作区已有外部修改 `AGENTS.md`，不得回退或改动它。
- 修改必须配测试；提交 subject 必须以 `dsw-33987` 开头，最终 push 到 `legacy-remote` remote。

### Sources Read

- `AGENTS.md`
- `C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator\SKILL.md`
- `C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator\references\open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-09-preset-prompt-expert-squad-boundary-cleanup.md`
- `specs/records/2026-07/2026-07-08-expert-squad-release-schema-audit.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `specs/records/2026-07/2026-07-07-portable-expert-squad-template.md`
- `specs/records/2026-07/2026-07-07-unified-scheduler-dispatch-tool.md`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/expert-squad/catalog-profile.ts`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/script/generate-portable-expert-squad-template.ts`
- `packages/opencorvus/script/generate-expert-squad-payload.ts`
- `packages/opencorvus/test/fixture/expert-squad.ts`
- `packages/opencorvus/test/expert-squad/registry.test.ts`
- `packages/opencorvus/test/expert-squad/portable-template.test.ts`
- Existing source manifests under `.opencorvus/expert-squads/**/expert-squad.jsonc` and `packages/opencorvus/src/expert-squad/builtin/general/expert-squad.jsonc`.

### Whole-Repo Grep Evidence

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\.jsonc|prompt_profile\.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - Finding: active selection, catalog, resolver, server routes, prompt catalog, payload release, and overlay surfaces all derive expert-squad behavior from registry / resolver rather than direct UI scans.
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\(|loadPackage\(|loadSourcePackage\(|importDirectory\(|importArchive\(|exportArchive\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test`
  - Finding: package validation flows through registry for embedded, source, project, import/export, payload generation, and project-open release.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | Sort-Object`
  - Finding: repository package sources are namespaced packages plus runtime `general`; tests and payload module are the main proof surfaces.
- `rg -n "role_base" packages/opencorvus/src packages/opencorvus/test specs/artifacts/portable-expert-squad-template .opencorvus/expert-squads -g "*.ts" -g "*.jsonc" -g "*.md"`
  - Finding: old implicit schema is used in registry schema, catalog profile expansion, real package manifests, generated template artifact, fixture package generator, and focused tests.
- `rg -n "virtualAgents|virtual_agents|capability_projection\.agents|baseRole|base_role|projected_agents" packages/opencorvus/src packages/opencorvus/test .opencorvus/expert-squads -g "*.ts" -g "*.jsonc" -g "*.md"`
  - Finding: resolver and catalog currently assume the projection key is the base role; virtual-agent display IDs are metadata and not dispatch inputs.

### Independent Agent Feedback

- No sub-agent was spawned for this turn. The current tool policy permits sub-agents only when the user explicitly asks for delegation / parallel agent work in this turn. This design uses direct source inspection plus focused tests and final self-review.

## Design

### Manifest Shape

The external expert-squad manifest keeps `schema_version: 1`, but v1 itself is changed in place to the current structure. There is no second schema branch and no compatibility parser.

Historical `role_base` fields are intentionally rejected by the strict manifest parser. A v1 manifest must now declare `base_role` and `inherit_base_tools`.

### Projection Shape

```jsonc
{
  "capability_projection": {
    "scheduler": {
      "base_role": "orchestrator",
      "inherit_base_tools": true
    },
    "agents": {
      "regression-tester": {
        "base_role": "build",
        "inherit_base_tools": true,
        "package_skill_refs": ["my-squad/regression-tester/test-implementation"]
      }
    }
  },
  "virtual_agents": {
    "regression-tester": {
      "id": "opentest-regression-tester",
      "label": "Regression Tester",
      "prompt": "virtual-agents/regression-tester/system.md"
    }
  }
}
```

### Semantics

- `projection id`: the key under `capability_projection.agents`. It is the expert-squad-owned agent identity and package resource owner.
- `base_role`: the OpenCorvus runtime role. It controls base/core prompt selection, workflow dispatch binding, base runtime contract, terminal protocol, and default tool assignment when inherited.
- `inherit_base_tools`: explicit replacement for old `role_base`; when true, the projection imports default visible tools for `base_role`.
- `virtual_agents.<projection_id>` is expert identity / overlay metadata for that projection. It is not a dispatch input.
- `agents.<projection_id>` is a direct overlay/resource directory for that projection.
- `agents.orchestrator` remains the scheduler overlay owned by `capability_projection.scheduler`.

### Runtime Mapping

- `resolveWorkerCapability(agentID=<base_role>)` finds exactly one active projection whose `base_role` equals the requested role.
- Zero matches means the active squad does not project that base role.
- More than one match is a manifest error; dispatch must not guess.
- Prompt composition receives the base role from existing callers, keeps the base/core prompt from that role, and resolves the active projection to find overlay, virtual-agent prompt, projected MCP context, package skills, and package tools.

## Implementation Plan

1. Add current-schema helpers in `ExpertSquadRegistry`:
   - require `base_role`;
   - replace `role_base` with `inherit_base_tools`;
   - validate projection IDs separately from base roles;
   - expose helper functions for projection entries and lookup by base role.
2. Update package ref collection and ownership:
   - `agents/<projection_id>` and `virtual-agents/<projection_id>` own package refs;
   - validation uses projection ID for package path ownership and `base_role` for runtime tool defaults.
3. Update `PromptProfileResolver`:
   - return `projectionID` alongside `agentID/baseRole`;
   - look up worker projection by base role;
   - compose overlays and virtual prompts by projection ID;
   - project workflow tools by projected base roles.
4. Update `catalog-profile` and prompt-profile catalog schema:
   - expose `base_role`, `inherit_base_tools`, `projection_id`, projected projection IDs, and virtual-agent base roles.
5. Update all repository manifests, built-in `general`, portable template generator/artifact, fixtures, and payload.
6. Update tests:
   - custom projection ID on `base_role: "build"` is accepted;
   - old `role_base` schema is rejected;
   - duplicate base roles are rejected;
   - resolver maps `dispatch/build` capability to custom projection ID and prompt overlay;
   - catalog and skill projection expose projection ID plus base role without using virtual-agent IDs as dispatch inputs.
7. Run focused validation:
   - registry, package-manager, prompt-profile-resolver, portable-template, payload-generation, server route tests as touched;
   - docs link test for new record;
   - typecheck and `git diff --check`.
