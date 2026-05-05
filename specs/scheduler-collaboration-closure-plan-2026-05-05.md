# Scheduler Collaboration Closure Plan - 2026-05-05

## Trigger

Visible overlay benchmark `overlay-benchmark-20260505-125447` reached build, then restarted from plan because the bootstrap goal created shared application files that later goals also needed. Treating that as a file-ownership violation made the system brittle: capable coding agents sometimes must edit shared files to integrate the real deliverable.

## Root Cause

The scheduler conflated `owned_paths` with exclusive write permission. That pushes collaboration correctness into a file sandbox, but the actual architecture is a conversation protocol:

- Architect describes responsibilities, dependencies, reference coverage, and assembly owners.
- Build agents implement inside isolated worktrees and merge back.
- Orchestrator reads persisted outputs and decides the next milestone.
- Delivery audits the integrated result.

The missing piece is not a stricter file wall. It is a collaboration audit surface: every build agent must explain what it changed file by file, why those changes belong to the current milestone, and how they affect shared integration surfaces. The orchestrator and delivery then check those claims against actual diffs and task state.

## Repair Strategy

1. Reframe `owned_paths` as responsibility paths, not exclusive write access.
   - They guide the agent and reviewer toward the intended scope.
   - Overlap is allowed when goals must coordinate on shared surfaces.
   - Verification goals remain constrained to test paths because that is a role contract, not a file sandbox.

2. Make build output self-explanatory.
   - `report_build_result` must include a structured `files_changed[]` list.
   - Each entry names the path and concrete reason for the change.
   - The build host cross-checks passed reports against actual git diffs and demotes unsupported reports to failed.

3. Push collaboration state into every goal build prompt.
   - Include all sibling goals, their current derived status, dependencies, exports/imports, and responsibility paths.
   - Keep assembly owners and reference coverage visible.
   - Tell the agent shared-file edits are allowed only when they preserve the other goals' declared intentions and are explained in `files_changed[]`.

4. Let delivery audit cooperation, not merely file locality.
   - Per-goal delivery artifacts should persist the structured file-change claims beside actual diffs.
   - Delivery can compare the claims, diffs, goal contracts, and assembly owners.

## Acceptance Criteria

- A build agent cannot report `passed` unless every actual changed file has a matching `files_changed[]` explanation.
- Prompt tests prove goal builds see sibling goal collaboration state.
- Schema tests prove passed build reports require at least one explained file change.
- Existing fidelity gates still protect reference coverage and assembly ownership.
- No merge-time hard block rejects a build solely because it changed a path outside `owned_paths`.
