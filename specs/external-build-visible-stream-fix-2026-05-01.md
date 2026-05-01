# External Build Visible Stream Fix

## Evidence

- Task `tsk_de3db7236001q3ZD0IlgOUxYxg`, goal `gol_de3e82511006JeI5JU5Cct0MYf` second attempt created build session `ses_21bf626a2ffe4o3MAOilJ4rM46`.
- The build session had many `reasoning` / assistant `text` parts and read-only tools, but the goal worktree `goal-5cct0myf` had no file changes at inspection time.
- The first attempt failed with the concrete error `Claude Code process aborted by user`; the orchestrator correctly started a retry, but the retry's visible card still showed planning narration instead of actionable build progress.

## Root Cause

The external build executor path (`claude-code` / `codex`) is not the in-process OpenCorvus build agent. It does not receive the `report_build_result` tool or the `merge_back` tool, and `BuildAgent` host-synthesizes the terminal `BuildResult` after the external provider exits.

That is a valid execution model, but the external path did not inject an equivalent build operating contract into the external provider's system prompt. The provider therefore used its generic coding-agent behavior: broad inventory, visible planning narration, and subagent exploration before implementation.

Separately, `runWithExternalProviderImpl` persisted external `text_delta` and `reasoning_delta` as normal session parts. That made internal build narration look like the authoritative build card body.

## Fix

1. Inject a first-party external build contract into `BuildAgent.composeExternalCodingSystem` for both `claude-code` and `codex`:
   - implement in the worktree;
   - keep exploration bounded to the goal's imports/exports and owned paths;
   - run acceptance checks;
   - commit the worktree branch;
   - do not call unavailable OpenCorvus terminal tools;
   - keep assistant prose out of the visible stream.
2. Stop materializing external assistant `text_delta` and `reasoning_delta` into build session parts. Keep tool calls/results, approvals/input, errors, plan/diff decisions, and the host terminal `BuildResult`.
3. Add focused tests for the injected contract and the external assistant-text materialization policy.
