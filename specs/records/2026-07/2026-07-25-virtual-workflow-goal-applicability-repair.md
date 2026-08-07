# Virtual Workflow Goal Applicability Repair

Date: 2026-07-25

Status: Implemented and focused verification passed.

## Recall

| Item | Details |
| --- | --- |
| User requirement | Monitor Mission `a0326f635c659e7a`, immediately repair evidenced shared infrastructure defects across every affected Agent and Expert Squad family, and intervene or restart only when necessary. |
| Acceptance criteria | A Goal-scoped workflow node dispatches only to Goals whose persisted contract matches that node's responsibility. Goal readiness must not be confused with workflow-node readiness. A Task-scoped node depending on a Goal-scoped node waits for every applicable Goal instance. Current Mission correction remains visible and does not restart the backend or Mission. |
| Hard constraints | Follow `AGENTS.md`, especially rules 3.1, 4, 6.1, 7, 8, 15.1, 24, 28, 32, 33, 35, 36, and 39. Fix prompt and data-flow semantics rather than adding a host gate, state machine, fallback, retry loop, or Squad special case. Preserve parallel worktree changes. Commit subjects use `dsw-33987`; push to `legacy-remote`. |
| Runtime evidence | Task `tsk_f98ce9ec3001yG4BoifyhsjnQD`, Orchestrator message `msg_f990ca640001b4rNm3Q1f4qtXt`, and child Session `ses_066f2980fffeSNKKF5J7h3AlLx` show `mirror-prd-author` dispatched with `work_scope.goal_id=gol_f98f011f0002rp3mFznXZvWeMN` while the instruction described the paid-space detail PRD. The persisted Goal is instead `Catalog rendered desktop design`; paid-space detail PRD is Goal `gol_f98f011f0005Hz2Wf6nRHxDCNg`. The worker raised a visible coordination contradiction, but the Orchestrator told it to continue and mixed the two contracts again. The exact child-cancel route returned HTTP 400 because the already-settled Session had no projected runtime identity. Operator correction message `msg_f991bbd57001omj7hQh4axum3e` was accepted and woke the same Task without a process restart, but the old runtime then dispatched `mirror-design-page-designer` Session `ses_066e57a2cffdoUf2bI0oXxKQQb` to Catalog implementation Goal `gol_f98f011f0003L0SriKrN2hHztF`, proving the lineage could not reliably continue. Exact child cancellation returned HTTP 200 with `cancelled:true`; Task cancel and Mission abort then each returned HTTP 200 `true`. |
| Sources read | `AGENTS.md`; `2026-07-25-expert-squad-dispatch-scope-and-guardrail-repair.md`; `prompt-profile-resolver.ts`; `virtual-workflow-dispatch-scope.test.ts`; all repository Expert Squad manifests with Goal-scoped nodes; Prism scheduler prompt, coordination Skill, and binding manifest graph; English and Chinese Agent documentation; current architecture extension contract. |
| Whole-repository grep | `rg -n "virtual_workflows\|virtualWorkflow"` across runtime, tests, packages, and specs; `rg -n "binding workflow\|workflow node\|depends_on\|terminal-success\|frontier"` across scheduler prompts and package overlays; `rg -n '"dispatch_scope": "goal"\|dispatch_scope: "goal"'` across every repository manifest and runtime fixture; `rg -n "executes once for each Goal\|same Goal\|dispatch_scope"` across tests, SDK, docs, and current architecture. Affected consumers include Prism, Mirror Watch, MirrorTest, Frontend Replica, Frontend Innovate, and General; all consume the shared scheduler projection. |
| Independent agent feedback | No independent Agent was requested or used. |

## Causal chain

1. The shared scheduler projection said that a Goal-scoped node executes once
   for every Goal created by the plan.
2. Real plans contain heterogeneous PRD, design, implementation, verification,
   integration, and acceptance Goals. Therefore “every Goal” assigns a node to
   contracts outside its phase and producer responsibility.
3. The projection described Goal-to-Goal and Goal-to-Task dependency evidence
   but omitted Task-to-Goal fan-in. A later Task-scoped planning node could
   therefore advance after only one Goal instance.
4. The active Orchestrator selected the next dependency-ready Goal and treated
   it as the next workflow node. It dispatched the PRD Author to a Design Goal,
   skipped the PRD review chain, and issued internally contradictory recovery
   guidance.
5. The earlier dispatch-scope repair isolated evidence per Goal but did not
   define which Goals a node applies to. It therefore prevented cross-Goal
   evidence reuse without preventing cross-phase dispatch.

## Repair

`PromptProfileResolver.composeResolvedAgentPrompt` remains the single shared
runtime projection. It now tells every binding-workflow scheduler to:

- derive a Goal-scoped node's applicable Goal set from the node agent identity,
  description, package responsibility, and exact persisted Goal contract;
- reject Goal ID/order, Goal dependency readiness, or conflicting prose as node
  selection evidence;
- keep Goal readiness and workflow-node order as separate facts;
- bind Goal-to-Goal evidence to the same applicable Goal; and
- require Task-to-Goal dependencies to fan in terminal-success evidence from
  every applicable Goal instance.

This is model-visible scheduling semantics, not a host executor or gate. English
and Chinese documentation plus current architecture use the same contract, and
the shared resolver regression covers the exact incident.

## Verification

- `bun test packages/opencorvus/test/expert-squad/virtual-workflow-dispatch-scope.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
  passed 25 tests with 193 assertions.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  passed 21 tests with 70 assertions.
- `bun run docs:check` passed all 291 OpenAPI operations in 24 groups.
- The combined document-health, product-docs single-source, and repository
  virtual-workflow protocol suite passed all behavioral assertions after the
  new record entered the Git index; its first run correctly rejected the
  not-yet-tracked record linked from the monthly index.
