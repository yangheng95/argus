# Capability Catalog, Harness Projection, and Permission Foundation

Status: implemented and validated

## Recall

### User requirements

- Deep-audit and calibrate
  `specs/current/architecture/17-code-work-agent-platform.md`.
- Complete the infrastructure before the Gmail vertical, specifically fuzzy
  capability search, Harness mounting hierarchy, and permission control.
- Allow a real runtime permission request to appear at the external action
  boundary, with existing once-only approval and permanently persisted
  approval choices.
- Create a new Git worktree, implement the design, test it, merge it back into
  `v0.0.24beta`, and push to the `myhexin` git-cc remote.

### Acceptance criteria

1. Capability search uses one typed identity codec and deterministic,
   revisioned metadata snapshot.
2. Search is read-only and cannot mount, authenticate, approve, or execute a
   capability.
3. Chat, Work, Mission, Task scheduler, and Task Agent preserve their existing
   capability owners while exposing one immutable diagnostic projection shape.
4. Runtime projection precedes permission: an allow rule cannot materialize an
   unprojected capability.
5. Package provider actions use a strict generic permission plan and an exact
   already-projected MCP Tool reference.
6. Focused non-UI tests cover identity, duplicate rejection, deterministic
   fuzzy ranking, caller visibility, projection hashing, non-expansion, and
   provider-action permission behavior.
7. Permission contract tests prove that `once` authorizes only the pending
   call, while `always` persists only the exact semantic permission patterns.
8. The implementation branch is tested, reviewed, merged back into
   `v0.0.24beta`, and pushed without touching unrelated parallel work.

### Hard constraints

- Preserve `PromptProfileResolver`, `ConversationCapability`,
  `MissionSkillRuntime`, `ToolRegistry`, MCP, and `PermissionNext` as their
  existing single-source owners.
- Do not add a Harness table, generic binder, second active Squad field,
  provider-specific Core logic, fallback, workflow gate, or state machine.
- Search metadata contains no Skill body, MCP resource body, provider
  arguments, OAuth token, or secret.
- UI automated tests are prohibited; this phase changes only non-UI contracts.
- Preserve all parallel work and do not use `git reset`, `git clean`, or broad
  restore operations.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/17-code-work-agent-platform.md`
- `packages/opencorvus/src/agent/{tool-pool-data,tool-pool-contract,primary-assistant-registry,runtime-template-registry}.ts`
- `packages/opencorvus/src/conversation/capability.ts`
- `packages/opencorvus/src/mission-skill/{catalog,runtime}.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/skill/{manager,mounts,eligibility,surface}.ts`
- `packages/opencorvus/src/tool/{global-tools,registry,execution-surface,skill,tool-id-catalog}.ts`
- `packages/opencorvus/src/mcp/index.ts`
- `packages/opencorvus/src/permission/next.ts`
- `packages/opencorvus/src/session/{loop,runtime-contract}.ts`
- relevant Tool, Skill, MCP, Expert Squad, conversation capability, runtime
  contract, and permission tests under `packages/opencorvus/test/**`.

### Whole-repository search

Repository-wide `rg` searches covered:

```text
fuzzysort / fuzzy
Tool.define / builtInGlobalTools / GLOBAL_TOOL_IDS
AgentToolPool / runtimeTemplateAssignments / roleAssignments
ConversationCapability / primary_assistant_capabilities
MissionSkillCatalog / MissionSkillRuntime
PromptProfileResolver / resolveSchedulerTurnProjection / resolveWorkerTurnProjection
ToolRegistry / visibleExecutionToolIDs / applyToolExecutionPolicy
MCP.tools / toolsForServers / prompts / resources / projectStatus / OAuth
PermissionNext.merge / PermissionNext.evaluate / PermissionNext.ask
SessionRuntimeContractStore / projectedRegistryToolIDs / projectedTools
capability routes / permission routes / expert-squad routes
```

The search found no cross-kind capability catalog or `capability_search` Tool.
It confirmed that native Chat/Work assignment, Mission Skill loading, Task
projection, Tool materialization, MCP transport, and permission evaluation have
separate existing owners. The implementation must compose metadata and
diagnostics over those owners rather than replace them.

### Call-site disposition

| Owner or caller | Disposition |
| --- | --- |
| `tool/global-tools.ts`, `tool/tool-id-catalog.ts` | Register the read-only platform `capability_search` Tool. |
| `agent/tool-pool-data.ts` | Add search to production native roles and runtime-template upper bounds. |
| new `capability/**` modules | Own typed refs, snapshot/search, caller view, immutable projection, and generic provider-action permission contract. |
| `ConversationCapability` | Adapt exact Chat/Work assignments into the shared projection shape. |
| `MissionSkillRuntime` | Adapt its exact resolved Mission Skill surface into the shared projection shape. |
| `PromptProfileResolver` | Adapt already-resolved scheduler/worker turn projections; remain the Task projection authority. |
| `SessionRuntimeContractStore` | Supply exact current Task runtime identity and projected Tool facts to search; remain runtime-contract owner. |
| `ToolRegistry`, `SkillTool`, MCP resolver | Remain exact materialization/load/transport owners. |
| `PermissionNext` | Supply generic evaluation/ask storage; no second grant store. |
| package MCP invocation | Use a strict typed provider-action plan and prove the exact MCP ref exists in the execution surface. |

## Verification

### Delivered contracts

- Added canonical typed `CapabilityRef` encoding for Skill, Tool, Mission
  Skill, Expert Squad, MCP server, MCP Tool, MCP prompt, and MCP resource
  identities.
- Added deterministic immutable catalog snapshots, caller visibility, exact
  filters, stale-revision rejection, stable fuzzy ranking, and the read-only
  `capability_search` Tool.
- Added `capability_search` to every production primary/runtime-template Tool
  pool while keeping Control and helper identities outside the discovery
  surface.
- Added immutable `HarnessProjection` adapters for Chat, Work, Mission, Task
  scheduler, and Task Agent owners. Task projections are required by
  `SessionRuntimeContractStore`; native projections are attached to the actual
  post-materialization execution surface.
- Classified native MCP Tools separately from platform Tools, and preserved
  exact package owners instead of reclassifying equal local IDs.
- Added strict provider-action plans with a canonical typed MCP Tool ref,
  exact semantic patterns, exact persistable patterns, redacted primitive
  metadata, inherited-Agent deny preservation, and runtime `ask` before
  execution.
- Reused the existing permission interaction and persistence path: `once`
  resolves only the pending request, while `always` stores only the exact
  semantic allow pattern in the project permission table.
- Removed environment-sensitive Question/LSP filtering from the cached Tool
  definition load. Definitions are stable; each materialization now applies
  its current provider environment, preventing catalog/projection drift after
  a prior load.

### Tests and checks

```text
bun test <17 focused non-UI contract files>
  150 pass, 0 fail, 2159 expect() calls

bunx turbo run typecheck
  8 successful, 8 total

bun run docs:check
  docs:check ok (310 ops, 24 groups)

bun test historical-docs-links + document-health + product-docs-single-source
  93 pass, 0 fail, 1448 expect() calls

git diff --check
  pass
```

The focused suite covers typed-ref collisions, deterministic mixed-kind fuzzy
ranking, stale revisions, caller/template visibility, exact package ownership,
native and Task Harness projection, frozen hashes, runtime-contract rejection,
permission non-expansion, same-local-ID MCP owner collisions, permission
interaction visibility, and `once`/`always` persistence.

The document-health suite initially reported only that this new implementation
record was not yet tracked. It passed completely after staging, so the final
run evaluated the same tracked-file state as CI.

### Review

Claude Code 2.1.220 was invoked from the isolated worktree with only
`Read,Grep,Glob`, no session persistence, and no delegation or worktree tools.
The service rejected the review before reading files because the account had
reached its monthly spend limit. A manual second review then tightened the
provider boundary from a local Tool ID to an exact typed MCP Tool ref, added a
same-local-ID/different-owner regression, attached native projections to the
real execution surface, and fixed environment-dependent Tool registry drift.

### Scope boundary

This record implements the user-prioritized capability-search, Harness
mounting, and permission-control foundation. It does not implement the later
product-pillar/immutable Task creation changes, the Gmail Work Squad, or the
always-on daemon described separately in the calibrated architecture.
