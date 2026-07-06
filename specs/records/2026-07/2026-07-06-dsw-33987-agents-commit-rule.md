# dsw-33987 AGENTS Commit Rule

## Recall

### User Request

- Use `dsw-33987` uniformly.
- Write the rule into `AGENTS.md`.

### Acceptance Criteria

- `AGENTS.md` explicitly says commits for the current `v0.0.1beta` git-cc delivery line must use the `dsw-33987` subject prefix.
- The existing pushed `dsw-0000: add expert squad display prefixes` commit is rewritten to use `dsw-33987`.
- The rewrite is pushed to `myhexin/v0.0.1beta` only after confirming the remote still matches local `HEAD`, using lease protection for the history update.
- Existing unrelated dirty worktree changes, including the pre-existing `AGENTS.md` expert-squad rule hunk, are preserved and not folded into this change.

### Hard Constraints

- No fallback, compatibility, or placeholder task ID.
- Do not invent any other `dsw-*` ID.
- Do not use `git reset`.
- Do not create a new worktree.
- Push to the git-cc remote named `myhexin`; `origin` does not satisfy delivery.
- Do not bypass hooks.

### Sources Read

- `AGENTS.md`.
- `specs/records/2026-07/README.md`.
- `specs/records/2026-07/2026-07-01-v0.0.1beta-history-rewrite.md`.
- Current Git status, current log, index status, and remote parity.

### Whole-Repository Search Evidence

- `rg -n "dsw-33987|dsw-|commit message|提交消息|git-cc|myhexin|rule 33|33\\." AGENTS.md specs`
- Existing `specs/records/2026-07/2026-07-01-v0.0.1beta-history-rewrite.md` says commits after the `dev` boundary on `v0.0.1beta` must use `dsw-33987`.
- Existing June records mention `dsw-0000` only as historical failed or local placeholder evidence, not as an allowed current delivery prefix.

### Git Evidence

- Local `HEAD` before this rule update: `028bd41d1e dsw-0000: add expert squad display prefixes`.
- `git rev-list --left-right --count myhexin/v0.0.1beta...HEAD` returned `0 0` after fetching `myhexin v0.0.1beta`, so the remote currently matches local `HEAD`.
- `AGENTS.md` already contains an unstaged expert-squad rule addition outside this task; this change must stage only the new `dsw-33987` rule hunk from `AGENTS.md`.

### Independent Agent Feedback

- No sub-agent was launched. The task is a direct rule and commit-message correction in the current worktree, and project rule 33.2 forbids creating another worktree to isolate the rewrite.

## Implementation Plan

1. Add a focused rule under `AGENTS.md` rule 33 requiring `dsw-33987` for the current `v0.0.1beta` git-cc delivery line.
2. Update this monthly records index so the rule change remains discoverable.
3. Run documentation link health and whitespace checks for the touched files.
4. Stage only the focused rule/spec/index hunks.
5. Amend the last commit subject from `dsw-0000` to `dsw-33987`.
6. Fetch `myhexin v0.0.1beta` again and force-push with lease only if the remote has not moved.
