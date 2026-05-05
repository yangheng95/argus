# Orchestrator Collaboration Closure

## Problem

Overlay benchmark `20260505-151125` showed the orchestrator re-entering Architect after a goal had already passed. That is not a robust scheduling strategy. It means the initial goal graph was not treated as a durable collaboration contract after execution began.

Overlay benchmark `20260505-154347` showed the next failure mode: after a Build failure, the orchestrator jumped to `restart_from_stage(plan)` with "architect contract incomplete" instead of first diagnosing the failed goal and retrying or point-correcting the same graph. That is the same root problem in another lane.

Overlay benchmark `20260505-161217` exposed the integrity-layer version of the same problem: integrity found real architecture defects and returned `needs_correction`, but its correction schema could not modify the topology fields it was auditing (`depends_on`, `imports`, `exports`). The result was repeated "corrected goal set: -0 +0" with no real closure improvement.

Overlay benchmark `20260505-162810` exposed the session-loop version of the same closure problem: `submit_architect` returned `PASS`, but the Architect session did not stop immediately. Because the terminal collector was already satisfied, the next loop no longer scoped tools to `submit_architect`, reopened the full tool surface, and let the model continue with `todowrite` and summary chatter. Terminal collector satisfaction must be a loop exit condition, not just a recovery predicate.

Overlay benchmark `20260505-163855` exposed a fidelity-gate version of the same problem: G1 passed after creating the Vite scaffold, then G2 was blocked before build with `Missing source coverage for existing owned paths: vite.config.ts, index.html, src/main.ts, src/style.css`. The orchestrator treated that as a goal-ownership defect, repeatedly called `modify_goal`, marked the passed G1 tip with `superseded_reason=modify_contract`, and eventually restarted from plan. This was the opposite of collaboration closure: files created by an earlier passed goal became evidence for invalidating that milestone instead of ordinary shared-code context for the next Build session.

Overlay benchmark `20260505-170235` exposed the build-report audit version of the same problem: after parallel Build sessions merged sibling goal work into primary, the audit compared `baseRef..HEAD` for the final merge commit. That range included sibling files from the already-advanced primary branch, so the expression-engine goal was failed for not explaining Vite/UI/README files it did not author. The audit also ran after the session closed, which prevented the build agent from correcting an incomplete `files_changed[]` report in the same session.

The prior attempted fix was a hard tool gate. That is the wrong architectural direction: it blocks one symptom, but it does not improve the scientific quality of the scheduling surface the orchestrator reads.

## Root Cause

The orchestrator reads status snapshots, but it does not read a first-class collaboration-closure projection:

- whether the current graph has entered execution,
- which goals are now dispatchable by dependency evidence,
- which failed goals remain inside the current graph and need diagnostic retry,
- which goals are blocked by unfinished dependencies,
- whether integrity corrections create an actual semantic goal-contract delta,
- whether a stage's terminal collector has already been satisfied,
- which repair lane fits ordinary collaboration drift,
- when Architect re-entry would be a structural re-plan instead of normal execution.
- whether a fidelity gate is still in the planning window or is wrongly revalidating source coverage after execution evidence exists.
- whether a Build file-change audit is measuring the current build session's own contribution or accidentally attributing sibling-goal merge context to it.

Without that durable projection, the LLM treats uncertainty as permission to ask Architect to solve the graph again.

## Fix Direction

Add a derived, persisted-read projection to `describeTask` and render it into the orchestrator context:

- It is computed from existing durable sources: goal contracts, goal-run attempts, dependency edges, and derived goal status.
- It does not disable any tool.
- It does not limit editable files.
- It makes the collaboration contract explicit every wake.
- It routes ordinary shared-file edits to Build `files_changed[]` and point contract corrections to `modify_goal`.
- It routes failed Build attempts to `query_failed_goals` and same-goal retry before any upstream restart.
- It gives integrity the ability to repair the lightweight topology fields it audits: ownership, dependencies, imports, exports, kind, and priority.
- It demotes no-op `needs_correction` results to concerns so review noise cannot block execution forever.
- It makes terminal collector satisfaction stop the session loop immediately, so Architect/Integrity/Build cannot keep planning after their report/submit contract is complete.
- It keeps source-coverage fidelity checks as pre-execution planning guards. After any goal attempt exists, existing-file source coverage is execution context, not a build blocker; Build owns necessary cross-file edits and reports them through `files_changed[]`.
- It keeps reference coverage strict even during execution, because screenshots/webpages/mockups are authoritative 1:1 targets and must cascade into Build.
- It audits Build `files_changed[]` against the build session's own contribution range. After merge_back creates a merge commit, that means `HEAD^2..HEAD`, not the original task base to final integrated HEAD.
- It rejects incomplete `files_changed[]` reports inside the still-alive Build session so the model can amend the terminal report instead of failing the goal after the session is gone.
- It reserves Architect re-entry as a structural re-plan that requires delivery/prosecutor/reference-coverage evidence or an explicit upstream restart.

## Acceptance

- A task with any goal attempt renders a "Collaboration Closure" section.
- The section lists dispatchable pending goals whose dependencies are satisfied.
- The section lists blocked pending goals with the dependency statuses that block them.
- The section lists failed goals as same-graph diagnostic recovery work.
- The section says ordinary shared-file collaboration belongs to Build reports and `modify_goal`, not Architect re-planning.
- The section says Build failure alone is not a reason to restart upstream.
- Session-loop tests prove a satisfied terminal collector is a direct stop condition.
- Tests prove the projection appears after execution starts and remains absent or pre-execution-scoped before the first attempt.
- Tests prove execution-stage build is not blocked solely by missing source coverage for existing files, while missing reference coverage still blocks.
- Tests prove build file-change audit excludes sibling-goal files introduced through merge_back and only requires explanations for this goal's own contribution.
