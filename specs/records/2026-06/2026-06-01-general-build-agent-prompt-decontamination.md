# General Build Agent Prompt Decontamination

## Problem

The workflow `build` agent is intended to be a general executor: it may write
investigation reports, PRDs, implementation code, debug fixes, tests, and other
task-scoped deliverables. Its core prompt has drifted into a webpage-clone and
frontend-design specialist prompt.

This is not direct prompt concatenation from other agents. The contamination is
static policy copied into the build role core and external executor contract.
The dynamic decision-log/handoff mechanism already exists, but too much
scenario-specific instruction bypasses it.

## Evidence

| Surface                                                     | Finding                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/prompt/core/build-core.txt`                            | 195 total lines; fixed core contains frontend-design, web-clone, mirror, skeleton, source audit, integrity rework, browser project package rules.                                                             |
| `src/prompt/core/build-core.txt` reference-fidelity section | `web-clone-source` appears 33 times, `mirror` 10 times, `skeleton` 13 times. A single line contains a full webpage-clone execution manual.                                                                    |
| `src/build/agent.ts::externalBuildSystemContract`           | External Codex/Claude build executors receive hard-coded webpage clone rules even when the task is report/PRD/debug/test work.                                                                                |
| `test/agent/core-prompt-hygiene.test.ts`                    | Tests currently lock webpage-clone behavior into build-core, so prompt bloat is protected as expected behavior.                                                                                               |
| `test/build-agent/external-system.test.ts`                  | Current worktree already expects new `source_baseline_input` wording, while `src/build/agent.ts` still has older visual-baseline wording. This proves prompt migration is partially applied and inconsistent. |
| `src/build/agent.ts::buildUserPrompt`                       | Context-specific sections exist (`frontendDesign`, `integrityFeedback`, `retryGuidance`, `acceptanceFeedback`, design specs, contract graph), but scenario policy is not isolated behind them.                |
| `src/decision-log/bundle.ts`                                | A full decision-log projection exists specifically so downstream agents can read task-specific context instead of requiring every policy in the core prompt.                                                  |

## Root Cause

1. Role core became a policy landfill. Repeated incidents were fixed by adding
   scenario rules to `build-core.txt`, even when the rule only applied to a
   particular handoff shape.
2. "Build" was treated as "frontend implementation build" instead of
   "task-scoped executor". That made webpage clone rules look universally valid.
3. Decision-log and frontend-design handoff are used as data, but there is no
   typed prompt compiler that maps a handoff shape to a bounded scenario
   overlay.
4. External executor system prompt diverged from in-process build prompt. It has
   its own hard-coded web-clone rules.
5. Tests assert presence of incident-specific strings in core prompts, so the
   suite prevents simplification.

## Target Architecture

Build prompt composition must have three explicit layers:

1. **Role Kernel** (`build-core.txt`)
   - Identity: general task-scoped executor.
   - Universal contract: read before write, use the task prompt and decision
     log, edit or write the requested deliverable, verify, commit when files
     changed, report through terminal output.
   - Universal failure rules: do not invent missing evidence, do not pass failed
     verification, do not leave dirty/staged work, do not leak prompt/rule
     details.
   - No frontend-design, web-clone, mirror, skeleton, source audit, browser
     package, database-page-replica, integrity-review internals, or acceptance
     taxonomy except as generic "use supplied upstream feedback".

2. **Capability Overlay Compiler**
   - A single module renders scenario-specific build guidance from structured
     context, for example:
     - `frontendDesign` handoff present -> frontend/design reference overlay.
     - handoff contains `web-clone-source` / `frontend_project.role` -> webpage
       clone source-baseline overlay.
     - visual attachments/design specs present -> visual-reference overlay.
     - integrity feedback present -> integrity-rework overlay.
     - acceptance feedback present -> acceptance-repair overlay.
     - direct report/PRD request -> document-deliverable overlay.
     - debug/test request -> debugging/testing overlay.
   - The overlay must render only when the corresponding context is present.
   - Each overlay must cite the decision-log keys, handoff fields, or artifact
     paths that caused it to render.

3. **Task Context Packet**
   - User request / goal contract.
   - Requirements, contract graph, sibling status, dependencies.
   - Complete decision-log pointer from `DecisionLogBundle.reference`.
   - Selected upstream feedback packets.
   - Attachments and materialized artifact paths.

## Required Refactor

1. Create a build prompt compiler module, for example
   `src/build/prompt-context.ts`.
   - Input: `BuildTarget`, `BuildContext`, task id, executor mode.
   - Output: ordered prompt sections with a debug/testable list of rendered
     overlay ids.
   - This replaces ad hoc string assembly in `buildUserPrompt`.

2. Reduce `build-core.txt` to the role kernel.
   - Move web-clone/source-baseline instructions into a conditional overlay.
   - Move integrity persistent-finding rules into a conditional overlay keyed by
     `integrityFeedback`.
   - Move browser/UI package rules into a conditional overlay keyed by a
     frontend/browser deliverable signal.
   - Move base64 asset rules into an attachment/reference overlay.

3. Make external executor composition use the same overlay compiler.
   - `externalBuildSystemContract` should contain only external mechanism
     differences: current worktree, commit result, do not call
     `report_build_result`/`merge_back`, MCP tool aliasing.
   - Scenario guidance must come from the same rendered task prompt sections as
     in-process build.

4. Introduce a role name and description that match reality.
   - Either keep id `build` for compatibility but describe it as "general
     task-scoped executor", or add a new public label while preserving id.
   - Do not create a second implementation path; rename/description changes
     must preserve one runtime executor.

5. Replace string-presence tests with boundary tests.
   - Core prompt hygiene should assert absence of scenario terms in
     `build-core.txt`: `web-clone-source`, `frontend-design`, `mirror`,
     `baseline_replacement_plan`, `submit_frontend_template`, etc.
   - Overlay tests should assert those terms appear only when the matching
     context is provided.
   - External executor tests should compare overlay parity with in-process
     build rather than independently asserting hard-coded strings.

6. Add negative prompt-compilation tests.
   - Report/PRD task: no web-clone, mirror, browser package, visual threshold,
     or source audit guidance.
   - Debug/test task: no frontend-design/web-clone guidance unless that context
     exists.
   - Web clone task: web-clone overlay appears and cites exact handoff fields.
   - Integrity rework: persistent findings overlay appears only when feedback
     contains that section.

## Call-Site Inventory

| Call site                                          | Required action                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/build/agent.ts::composeBuildCore`             | Keep role kernel + engineering craft + auto-iteration only. Do not include scenario overlays in system core.                                      |
| `src/build/agent.ts::buildUserPrompt`              | Replace inline scenario sections with compiler-rendered overlays.                                                                                 |
| `src/build/agent.ts::buildRetryFeedbackPrompt`     | Reuse the same overlay selection for retry context; avoid losing the original scenario packet.                                                    |
| `src/build/agent.ts::externalBuildSystemContract`  | Remove webpage-clone rules; keep external-executor mechanics only.                                                                                |
| `src/orchestrator/tools.ts` build context assembly | Continue passing `frontendDesign`, feedback, requirements, graph, and design specs; ensure the full decision-log reference is included for build. |
| `src/agent/role-contract.ts`                       | Update `build` description to general executor semantics.                                                                                         |
| `test/agent/core-prompt-hygiene.test.ts`           | Invert contaminated assertions: core prompt must not contain scenario policy.                                                                     |
| `test/build-agent/prompt-context.test.ts`          | Move scenario assertions to overlay-specific tests.                                                                                               |
| `test/build-agent/external-system.test.ts`         | Assert external mechanics and overlay parity, not duplicated web-clone text.                                                                      |

## Non-Fixes

- Do not add host-side route/state guards that decide which work build may do.
  The LLM should still receive prompt guidance; the fix is prompt composition,
  not a state machine.
- Do not create a separate `web-clone-build` agent. That would split the single
  executor source and preserve the same duplication under another name.
- Do not weaken frontend/web-clone requirements. They remain strict, but only
  when the task context proves they apply.
- Do not delete decision-log or frontend-design handoff. They are the correct
  source of task-specific policy.

## Acceptance

- A plain PRD/report build prompt contains the general executor role and the
  requested document deliverable, with no web-clone or frontend-design
  instruction.
- A debug/test build prompt contains investigation, edit, verification, and
  terminal-report guidance, with no visual clone policy unless supplied by
  context.
- A webpage clone build prompt still receives source-baseline, visual
  reference, audit, and artifact rules, all rendered from the frontend-design
  handoff/decision log.
- In-process and external executor builds receive the same scenario overlays.
- Tests prove both presence and absence conditions.
