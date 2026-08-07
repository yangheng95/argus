# Turn Projection And Coordination Handoff Repair

Date: 2026-07-22
Status: Implemented
Owner: Codex

## Recall

### User request

The user supplied Task `tsk_f855e9851001b7451krmNUDxKn` and asked to repair two
runtime failures while explicitly excluding the Goal-status projection:

- `Skill projection general does not match active expert squad mirror-watch.`
- `Undeclared coordination handoff tool result request_orchestrator_decision/...`

### Acceptance criteria

- Selecting a different Expert Squad affects the next Orchestrator wake without
  invalidating the immutable tools, Skills, prompt, or projection of the current turn.
- A delegated worker that can execute `request_orchestrator_decision` declares the same
  tool as a typed coordination-handoff completion alternative.
- The runner continues to validate the durable request ID, tool-call ID, dispatch
  ownership ID, task ID, and worker Session ID; no permissive fallback is introduced.
- Focused regressions reproduce both original failures and pass after the repair.
- OpenCorvus typecheck, focused tests, document-health checks, and diff checks pass.

### Hard constraints

- `prompt_profile.active` remains the only active Expert Squad selection source.
- `PromptProfileResolver` remains the only projection owner.
- Do not add a gate, state machine, compatibility branch, hidden message, synthetic
  message, or fallback projection.
- Do not weaken the runner's durable coordination identity validation.
- Do not change Goal status or Goal outcome behavior in this repair.
- Do not restart or refresh the running OpenCorvus or Overlay process.
- Preserve and do not stage unrelated dirty work in the shared worktree.
- Commit subjects use `dsw-33987` and push to `myhexin/v0.0.13beta`.

### Sources read

- `AGENTS.md`
- Runtime SQLite rows for the supplied Task, root/Orchestrator/worker Sessions, Messages,
  Parts, worker-turn descriptors, protocol events, and decision log
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/records/2026-07/2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/session/runtime-contract.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/agent/dispatch-adapter-contract.ts`
- `packages/opencorvus/src/agent/tool-pool-data.ts`
- `packages/opencorvus/src/delegated-worker/agent.ts`

### Whole-repository search evidence

- `rg -n "SkillMount\\.resolve|ResolvedAgentSkillSurface|skillProjection|projectDirectory" packages/opencorvus/src packages/opencorvus/test --glob '*.ts'`
- `rg -n "select_expert_squad|continuation_wake|expert_squad_selection" packages/opencorvus/src packages/opencorvus/test --glob '*.ts'`
- `rg -n "terminalToolCompletion\\(|coordinationHandoffToolID|request_orchestrator_decision" packages/opencorvus/src packages/opencorvus/test --glob '*.ts'`
- `rg -n "createAgentCoordinationRuntimeTools|WORKER_COMMUNICATION_TOOL_IDS|delegated_worker" packages/opencorvus/src packages/opencorvus/test --glob '*.ts'`

### Independent agent feedback

No sub-agent was used because the user did not request delegation or parallel agents.

## Causal diagnosis

The first failure occurred after the General Orchestrator successfully called
`select_expert_squad(profile_id="mirror-watch")`. The tool correctly changed the root
overlay for future wakes, but the current General turn later resolved its Skill surface
against the newly mutable effective config. `SkillMount.resolve()` therefore compared a
turn-owned General projection with the future wake's Mirror Watch active selection.

The second failure is an adapter ABI mismatch. The delegated-worker base tool pool
projects `request_orchestrator_decision`, and the supplied worker executed it successfully,
including a durable pending request and dispatch-ownership metadata. The
`delegated_worker` completion contract does not declare that terminal alternative, so the
runner correctly rejected the otherwise valid handoff as undeclared.

## Call-site disposition

| Surface | Callers / consumers | Repair |
| --- | --- | --- |
| `SkillMount.resolve()` | SessionLoop final Skill-surface resolution | Validate the runtime identity against the immutable turn-owned Skill projection; stop consulting the mutable active profile as a second turn identity source. |
| `SessionLoop` runtime contract | Scheduler and projected-worker turns | Continue carrying the frozen Skill projection and project directory as the turn authority; use current config only for non-identity runtime inputs. |
| `select_expert_squad` | Current Orchestrator turn and scheduled continuation wake | Preserve its visible root-overlay write and continuation wake; verify that the current turn can finish with its original projection and the new wake resolves the selected projection. |
| `delegated_worker` dispatch adapter | Every dynamic Agent using the delegated-worker base role | Declare `request_orchestrator_decision` as a typed completion alternative while retaining `submit_delegated_worker_result` as the normal domain finalizer. |
| `WorkerTurnDescriptor` and runner prompt | Persisted runtime evidence and model guidance | Derive `coordinationHandoff` from the adapter contract so the descriptor, prompt, visible tools, and runner validator agree. |
| Coordination handoff validator | Every typed worker handoff | Keep exact durable request and ownership validation unchanged. |

## Implementation plan

1. Add a focused Skill-mount regression proving a frozen General turn remains valid after
   the root active profile changes to another installed Expert Squad.
2. Remove the mutable active-profile comparison from Skill identity resolution while
   retaining exact runtime-owner/projection identity and projection-hash checks.
3. Add delegated-worker contract and runner regressions for the declared typed handoff.
4. Mark the delegated-worker adapter's terminal completion as coordination-capable.
5. Run focused tests, typecheck, document-health tests, diff checks, and a second code review.

## Verification commands

- `bun test packages/opencorvus/test/session/extra-tools.test.ts`
- `bun test packages/opencorvus/test/agent/dispatch-adapter-contract.test.ts packages/opencorvus/test/agent/runner-prompt.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Implementation and review result

- `SkillMount.resolve()` no longer accepts mutable config as an identity input. It resolves
  exclusively from the frozen turn-owned Skill projection and exact runtime owner.
- Delegated Worker, Build, Explore, and Integrity now declare the same typed coordination
  handoff that their inherited tool pools expose. Existing Requirements, Architect,
  frontend, research, Visual QA, workload, intent, and fact-check contracts remain aligned.
- The runner accepts a handoff for plain completion only through the same declared adapter
  field and retains exact durable request/ownership validation.
- Independent second review found the mismatch was systemic beyond the reported delegated
  worker. An enum regression now compares every runtime template's actual projected tool
  pool with its dispatch-adapter handoff declaration.
- Focused Expert Squad, Mirror Watch, Mirror Prism, adapter, runner, coordination-tool, and
  processor tests pass. OpenCorvus typecheck and historical-doc link health pass.
- Goal status and outcome projection were intentionally not changed.
