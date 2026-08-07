# Mission Full Execution Surface

Date: 2026-07-23

## Recall

| Item | Recorded requirement or evidence |
| --- | --- |
| User request | Fix Mission lacking Bash and command permissions; Mission is expected to be a full-function agent. |
| Acceptance | A native Mission session materializes the ordinary primary-assistant execution tools, including `bash`, provider-appropriate file mutation, Browser Preview, Skill, planning, and batch surfaces, while retaining Mission-only coordination tools. Its permission rules allow Bash by default. The Mission prompt no longer tells the model that execution is unavailable or always requires a dispatched Task. Slash-command requests can continue to select the native Mission primary identity through the existing `SessionCommand` path; no second command tool is introduced. |
| Hard constraints | Keep one registry `bash` implementation and one native primary-agent materialization path. Do not add a host authorization gate, fallback, compatibility alias, state machine, or second `command` tool. Preserve user configuration as the final permission override. Preserve Task/Expert Squad dispatch as Mission's durable workflow surface without forcing every direct user request through it. Do not restart or refresh a running OpenCorvus or overlay process. |
| Existing decisions read | `specs/current/architecture/01-agents.md`; `specs/current/architecture/13-agent-communication-matrix.md`; `specs/records/2026-06/2026-06-15-user-authorized-mission-orchestrator-bash.md`; `specs/records/2026-07/2026-07-02-orchestrator-runtime-command-permission.md`; current Mission core prompt, primary registry, tool-pool data, tool registry, permission composition, session command route, and session shell route. |
| Whole-repository search | Searched `Mission`, `mission`, `bash`, `command`, permission/tool projection, `PrimaryAssistantRegistry.get`, `AgentToolPool.assignment`, `SessionCommand`, and `SessionShell` across `packages/opencorvus/src`, focused tests, Overlay sources/tests, and `specs`. The exact production consumers and sibling contracts are enumerated below. |
| Historical cause | The 2026-06-15 record granted Mission user-authorized Bash. Commit history shows the Mission prompt later reverted to a coordinator-only, no-shell contract. The July tool-pool consolidation encoded that regressed prompt contract by omitting Bash and all mutation tools from `roleAssignments.mission`. The permission defaults still allow Bash, so the observable failure is primarily tool projection plus a contradictory prompt, not a missing Bash implementation. |
| Independent-agent feedback | Not requested by the user. Repository instructions permit sub-agents only when the user explicitly requests them, so no independent agent was started. |
| Workspace state | The main worktree contains substantial unrelated in-progress changes. This repair is limited to the Mission tool/prompt/architecture/test/spec files and will not rewrite or discard unrelated changes. A pre-change push attempt was blocked by unrelated in-progress Overlay type errors from the shared worktree; no hook was bypassed. |

## Causal chain

1. Observable phenomenon: Mission cannot call Bash/run commands and describes itself as unable to execute.
2. Direct trigger: `roleAssignments.mission` omits `bash` and the other primary execution tools, so `ToolRegistry.runtimeTools` filters them before the model sees them.
3. Prompt reinforcement: `mission-core.txt` explicitly says Mission must dispatch whenever it wants to run a command or change a file.
4. Deeper cause: the July native-agent/tool-pool refactor preserved a later coordinator-only regression instead of the earlier user-authorized Mission execution decision. Permission composition itself already defaults Bash to `allow`; changing only permissions would therefore not restore the tool.
5. Why a narrow permission patch is insufficient: adding `bash: "allow"` without adding Bash to the canonical tool pool still leaves it invisible, while adding only the tool leaves the prompt instructing the model never to use it. Both sources must converge.

## Complete call-site and contract inventory

| Source or consumer | Current role | Change |
| --- | --- | --- |
| `packages/opencorvus/src/agent/tool-pool-data.ts` `codingGlobal` | Canonical full primary execution tool list for Coding/Chat. | Extract the shared execution surface from Coding-only local delegation. Reuse it for Mission, then add Mission-only `mission_skill`, `panel`, and `wait`. Keep `delegate_agent` exclusive to Coding/Chat because it is a separate local-child protocol, not an execution permission. |
| `packages/opencorvus/src/agent/tool-pool-data.ts` `roleAssignments.mission` | Canonical Mission built-in visibility source consumed by native materialization and registry filtering. | Replace the read/coordinator-only list with the shared primary execution list plus Mission coordination tools. |
| `packages/opencorvus/src/agent/native-agent-materializer.ts` | Assigns `AgentToolPool.assignment(id)` to every native agent. | Preserve; this remains the only materialization path. |
| `packages/opencorvus/src/tool/registry.ts` | Filters built-in tools to the native agent's visible tool IDs and chooses provider-specific `apply_patch` versus `edit`/`write`. | Preserve; tests must exercise this real filtering behavior for Mission. |
| `packages/opencorvus/src/agent/native-agent-permissions.ts` | Supplies default `*` and explicit Bash/edit/read permissions, then applies user configuration. | Preserve the single permission composition path; add a focused assertion that Mission evaluates Bash as allowed. Do not override an explicit user deny. |
| `packages/opencorvus/src/agent/primary-assistant-registry.ts` Mission permission assembly | Adds Mission-specific allowed coordination permissions. | Keep the existing composition and explicitly name Bash in the Mission ruleset so the role contract is readable and regression-tested; user config remains later and authoritative. |
| `packages/opencorvus/src/prompt/core/mission-core.txt` | Tells Mission it is coordinator-only and has no Bash/edit/write/apply-patch. | Replace the prohibition with a general-purpose primary-agent contract: execute directly when that is the responsible way to satisfy the current request; use Mission Tasks for durable, parallel, specialist, or long-running work. |
| `packages/opencorvus/src/session/command-exec.ts` | Resolves slash commands to any exact `PrimaryAssistantRegistry` identity, including Mission. | Preserve. No second `command` permission or tool exists. Add/retain evidence that Mission remains a primary identity and explain that command execution reaches its normal runtime surface. |
| `packages/opencorvus/src/session/shell-exec.ts` and session routes | Executes operator-authored shell input in the selected session identity. | Preserve. The reported Mission defect does not require another shell implementation. |
| `packages/opencorvus/src/tool/bash.ts` | Sole registry Bash tool and Bash permission request implementation. | Preserve. Mission receives this existing implementation through its canonical pool. |
| `packages/opencorvus/src/tool/delegate-agent.ts` | Coding/Chat-only bounded local-child protocol with a hard identity contract. | Preserve and keep absent from Mission. Full execution does not create a second Mission dispatch mechanism. |
| `packages/opencorvus/test/agent/role-contract.test.ts` | Currently pins Mission's coordinator-only pool and local-delegation separation. | Assert Mission contains the shared execution capabilities, keeps its coordination tools, permits Bash, and still excludes local `delegate_agent` and scheduler-only `dispatch_agent`. |
| `packages/opencorvus/test/agent/primary-assistant-registry.test.ts` | Verifies native primary identity materialization and prompt identity. | Add exact Mission full-execution assertions and prompt regression checks. |
| `packages/opencorvus/test/session/extra-tools.test.ts` | Exercises projected-worker and extra-tool filtering rather than the native role assignment boundary that regressed here. | Preserve. The exact native Mission materialization regression belongs with `PrimaryAssistantRegistry` and `AgentToolPool`, avoiding a second indirect fixture for the same source. |
| `specs/current/architecture/01-agents.md` | Describes primary assistants and currently limits local delegation but does not define Mission execution breadth. | Record Mission as a full primary execution agent that also owns durable Mission coordination; retain the distinct Task and local-delegation boundaries. |
| `specs/README.md` and `specs/records/2026-07/README.md` | Canonical spec indexes. | Add this record without disturbing unrelated in-progress index edits. |

## Implementation

1. Refactor the canonical primary tool list so Coding/Chat and Mission share one execution surface, while `delegate_agent` remains an explicit Coding/Chat-only addition.
2. Project that execution surface into Mission together with Mission Skill, Mission state, panel, and wait.
3. Converge the Mission prompt on direct execution plus durable Task orchestration, removing the false no-Bash/no-edit statements.
4. Add focused unit and real registry-materialization regressions.
5. Update current architecture and spec indexes, run focused tests, package typecheck, document-health checks, and review the final diff.

## Implementation result and second review

- `primaryExecutionGlobal` is now the single ordinary primary execution inventory. Coding adds its separate `delegate_agent`; Mission adds `mission_skill`, `panel`, and `wait`.
- Mission's native permission profile explicitly allows Bash while retaining the existing user-config-last precedence. A regression proves an explicit user Bash denial still wins.
- Mission's prompt and current architecture now describe direct execution and durable Task coordination as complementary responsibilities.
- The exact-set regression compares Mission with Coding minus `delegate_agent` plus Mission-only tools, so future additions to the ordinary primary execution inventory cannot silently skip Mission.
- Codex second review corrected the initial test placement: `session/extra-tools.test.ts` is a projected-worker/extra-tool suite and would test the wrong responsibility. The final regressions stay at the native registry and role-contract boundaries that own this defect.

## Verification

- `bun test packages/opencorvus/test/agent/role-contract.test.ts -t "mission combines"`
- `bun test packages/opencorvus/test/agent/primary-assistant-registry.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

Observed:

- Mission-focused role-contract test: 1 pass.
- Primary-assistant registry suite: 8 pass.
- Historical links and document health: 82 pass.
- Package typecheck entered the real compiler and failed only in unrelated shared-worktree Task Run retirement changes: current consumers still import deleted `Run` types/functions from `engine/store.ts`. No Mission file appears in the compiler errors, and this repair does not restore those retired exports as compatibility code.
