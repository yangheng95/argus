# Resume note — 2026-05-09 (after `.git/` sandbox block)

You are resuming the same task brief: `specs/_codex-brief-delivery-trunk-readiness-2026-05-09.md`.

## What changed since you stopped

Your previous session was killed because `workspace-write` sandbox blocked git index writes (`fatal: Unable to create '.git/index.lock': Permission denied`). You correctly diagnosed it as policy-blocked rather than a stale lock or live process.

This session is launched with `--sandbox danger-full-access`. Git writes (`add`, `commit`, `push`) and `.git/` access are now permitted. Approval is still `never`, so do not invoke destructive commands you would not run in a normal session (no `git push --force`, no `rm -rf` on shared paths, no skipping pre-push hooks).

## Current disk state

- `specs/delivery-trunk-readiness-gate-2026-05-09.md` is on disk (109 lines, 7.6 KB) but UNTRACKED (`?? specs/...`). Your prior commit attempt failed before persisting the change. Read it back, decide whether it is still the spec you want, and commit it as the first step of this session.
- `specs/_codex-brief-delivery-trunk-readiness-2026-05-09.md` is the brief you were following.
- `specs/_codex-review-delivery-acceptance-2026-05-09.md` is your earlier read-only review notes — keep as reference, but it is not part of the implementation deliverables.
- No code under `packages/` has been changed yet. `git status` will show only the spec as new.

## Resume instructions

1. `git status -s` to confirm the disk state matches the description above.
2. Read your spec, decide if it stands. If yes, commit it with the message you originally chose (`spec: define delivery trunk readiness gate` or similar). If you want to revise it, do so first.
3. Continue with §7 of the brief from item 2 onward (implementation, reorder, assessFunctionalCompletion, deliver invariant, benchmark side, lockfile policy flip, prompt updates, tests, commits).
4. Per CLAUDE.md rule 26, commit each logical step separately and push after the suite passes. Don't `--no-verify` — fix hooks if they fail.
5. Per rule 21 do NOT run unfocused `bun test`. Use the directed paths from the brief (`bun test test/delivery/` etc.).
6. If you complete the work, write a one-paragraph `## Final report` block to stdout summarizing: spec hash, code commits, test counts, push status, anything left unfinished.

If a CLAUDE.md rule blocks an action and there is no compliant alternative, stop and emit a clear "Blocked: <reason>" line so the supervising agent can intervene. Otherwise: spec → impl → tests → commit → push → final report.
