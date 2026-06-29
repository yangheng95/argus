# WSL Binary Mission Launch Recovery Plan - 2026-06-13

## Problem

The first failure was a project directory scope failure: the panel/backend tried to operate under `/.opencorvus`, which matches the historical `process.cwd()`/root directory cascade fixed by `1ab27386f4` and documented in `2026-04-30-instance-bootstrap-darwin-cascade.md`.

During live repair, unrelated filesystem/config patches were added before proving the running binary, project path, and historical fixes. Those patches produced a second visible failure:

`EEXIST: file already exists, mkdir '/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4/.opencorvus'`

## Independent Review Findings

Independent read-only review concluded:

- `GET /task/events` itself is an SSE subscription and does not call `Config.update`.
- Project-scoped routes pass through `Instance.provide(... init: InstanceBootstrap ...)`.
- `InstanceBootstrap` calls `TerminalProfile.ensureProjectDefaultProfile()`, which can call `Config.update()` and write `<project>/.opencorvus/opencorvus.jsonc`.
- Historical commit `5484f78083` already fixed `Config.update` concurrency with a keyed lock. The correct repair path is not a global `Filesystem.write` mkdir wrapper.
- Historical commit `1ab27386f4` removed `process.cwd()` fallback. Do not reintroduce cwd fallback.
- If the stack still points at removed source, first verify the running binary and project directory.

## Local Evidence

- Current 7878 process is intentionally left running and must not be restarted for validation:
  - executable: `/mnt/c/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/dist/binary/opencorvus-linux-x64/opencorvus`
  - cwd: `/mnt/c/Users/chuan/myhexin-local/opecorvus`
  - command: `serve --project-dir /mnt/c/Users/chuan/myhexin-local/opecorvus --hostname 127.0.0.1 --port 7878`
- Bad filesystem/config patches were reverted. Current intended source diff is limited to the build-agent prompt instruction and its prompt test.
- `economy_4/.opencorvus` had a DrvFS inconsistent entry state:
  - Windows `dir` did not show it.
  - WSL `ls` did not show it.
  - Node `accessSync` succeeded while `statSync`/`lstatSync` returned `ENOENT`.
  - `mkdir -p` and Node `mkdirSync({ recursive: true })` failed on the exact name.
- Creating the exact `.opencorvus` directory from Windows normalized the entry:
  - WSL `statSync` and `lstatSync` then succeeded.
  - `GET /config?directory=/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4` returned 200.
  - `GET /task/events?directory=/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4` returned `task-list.connected`.

## Decisions

1. Keep the generic build-agent prompt instruction for toolchain preflight failures and its test.
2. Do not keep global `Filesystem.write` or `Config.update` patches from the failed repair attempt.
3. Do not restart or reuse port 7878 for validation. It is the user's current server.
4. Use a separate WSL binary process on port 7879 for package/start/mission validation.
5. Stop only the validation process on port 7879 after normal startup verification.
6. Treat `.opencorvus` exact-path DrvFS corruption as local project directory state unless it is reproduced in a fresh directory. Do not encode a shell `mkdir -p` fallback in production.

## Next Steps

1. Verify current source diff remains limited to the build-agent prompt and test.
2. Run the targeted build-agent prompt test.
3. Package the WSL Linux x64 binary from the synced `/mnt/c` repository.
4. Start the newly packaged binary on `127.0.0.1:7879` with project dir `/mnt/c/Users/chuan/myhexin-local/opecorvus`.
5. Verify `/ui/`, `/config`, and `/task/events` against directory `/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4`.
6. Publish the TradingView World Economy request to Mission through `POST /mission/wake` on port 7879 with the project directory query parameter.
7. Confirm Mission wake returns `missionID` and `sessionID`, and that `GET /mission?directory=...` contains the new mission.
8. Stop the port 7879 validation process after startup verification.

## Validation Commands

- `bun test packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts`
- `bun run package:linux-binary` from WSL in `/mnt/c/Users/chuan/myhexin-local/opecorvus`
- `curl http://127.0.0.1:7879/ui/`
- `curl http://127.0.0.1:7879/config?directory=/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4`
- `timeout 5 curl -N http://127.0.0.1:7879/task/events?directory=/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4`
- `curl -X POST http://127.0.0.1:7879/mission/wake?directory=/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4`

## Outcome

- Reverted the incorrect live-repair changes to `Config.update` and `Filesystem.write`; only the build-agent toolchain-preflight prompt change remains in source.
- `bun test packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts` passed.
- `bun run package:linux-binary` succeeded in WSL from the `/mnt/c` repository.
- Port 7878 was not restarted or reused for validation.
- Port 7879 validation passed:
  - `/ui/` returned successfully.
  - `/config?directory=/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4` returned successfully.
  - `/task/events?directory=/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_4` emitted `task-list.connected`.
- First `POST /mission/wake` failed with `MissingModelConfigError` because the task project config had no `model` or `agent.mission.model`.
- Fixed the task project config through `PATCH /config` on port 7879 with explicit `hexin/kimi-k2.6` model configuration.
- Mission wake then succeeded:
  - `missionID`: `4072463517b4eee1`
  - `sessionID`: `ses_13f195ab8ffeLhC4KJ4cp67JFT`
- Follow-up mission status on port 7879 showed the mission record exists and is `running`.
- Validation process on port 7879 was stopped after the startup checks.
