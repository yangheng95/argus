# Build Outcome And Visual Evidence Repair

Date: 2026-06-29

## Incident

Task `tsk_f0e5c0272001djBGw2eLvbkgkH` exposed two related fact-source gaps.

1. Terminal build attempts that failed, aborted, or produced no project diff
   only updated the `goal_run_attempt` row. They did not persist a durable
   non-acceptance output artifact, so board/debug consumers collapsed distinct
   outcomes into `changedFiles=0` and `contributionCommits=none`.
2. Visual evidence allowed a full-region mismatch to be masked by a later
   exact/content-well crop with the same logical region identity. Scroll-slice
   side-by-side evidence is supporting visual-diff evidence only; formal
   reference parity must remain backed by persisted `reference-comparison`
   evidence.

## Recalled Constraints

- `build({ goalID })` root tool ownership is a dispatch lock, not the child
  build lifecycle. It must close after the child session and `goal_run` have
  started so terminal refill and FIFO scheduling remain unblocked.
- Child build liveness must be read from durable `goal_run`, `session.status`,
  `build_session_contract`, and terminal refill facts.
- `acceptance` remains positive delivery evidence only. Absence of acceptance
  must not be overloaded to mean failed, aborted, no-diff, or invalidated.
- Full-region and content-well crops are different visual contracts and must
  not satisfy each other.

## Repair Plan

1. Add a durable `build_attempt_outcome` artifact written for every terminal
   build attempt. The artifact is not acceptance; it records terminal status,
   outcome kind, error/summary, workspace facts, commit refs, diff refs, and
   host-observed changed files.
2. Write terminal `goal_run_attempt`, `build_attempt_outcome`, and optional
   positive `acceptance` in one `finalizeBuildAttempt` transaction.
3. Add store readers for build outcomes and project them into per-goal board
   step payloads, overlay debug output, and integrity replay context.
4. Preserve async root ownership. Tighten `cancel_subagent recover_stale` so
   no live tool ownership is not treated as proof that a child build is stale
   or recovered.
5. Extend formal visual evidence identity with crop intent and ensure
   scroll-slice `visual_diff` evidence cannot satisfy reference parity.

## Test Matrix

- `finalizeBuildAttempt` completed with project diffs writes outcome plus
  acceptance.
- `finalizeBuildAttempt` failed writes outcome and no acceptance.
- `finalizeBuildAttempt` completed with no project diff writes
  `no_project_diff` outcome and no acceptance.
- Board/debug output distinguishes `aborted`, `failed`, and `no_project_diff`
  from positive delivered acceptance.
- `cancel_subagent mode="recover_stale"` refuses live goal runs that have no
  live root ownership instead of reporting successful recovery.
- Visual evidence tests prove full-region and content-well crops cannot
  satisfy each other, while low SSIM remains diagnostic support rather than an
  acceptance gate.
