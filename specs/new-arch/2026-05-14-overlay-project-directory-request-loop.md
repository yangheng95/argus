# Overlay Project Directory Request Loop

## Symptom

After opening the overlay, creating a new task does not reach task persistence.
The global database has no new `engine_task` row, while the active server log
shows repeated project-scoped `/skill/market` requests failing with
`DirectoryRequiredError`.

## Root Cause

Two overlay-side issues combine into a WebView2 request loop:

- The main API configuration effect can run before settings hydration and write
  an empty `directory` into the API client.
- `SkillMarketPanel` uses `market().length === 0` as its auto-load trigger.
  A failed marketplace request resets the market store to an empty array, which
  retriggers the same effect indefinitely.

The loop consumes the overlay event/render budget and keeps sending project
routes without a directory. Task creation then never reaches the server-side
`POST /task` handler, so no task row is created.

## Design

- API configuration that depends on persisted settings must wait for
  `settingsHydrated()`, matching the existing theme/zoom/opacity gate.
- Marketplace auto-load must be keyed by active project directory, not by
  whether the returned catalogue is empty. An empty catalogue is a valid loaded
  result.
- Missing directory is a visible precondition, not an implicit retry condition.
- Extension loaders must surface request failures to callers instead of
  rewriting stores to empty values and hiding the real error.

## Acceptance

- Opening the skill marketplace with no directory does not call
  `/skill/market`.
- Opening it with a directory calls `/skill/market` at most once per directory
  until the operator explicitly reloads or switches directory.
- A failing `/skill/market` request does not create a reactive retry loop.
- Project-scoped route injection coverage includes `task`, `skill/market`,
  `skill/installed`, `skill/directories`, and `mcp`.

## MCP Pending Status Follow-up

On 2026-06-04, `browser` MCP startup was verified to transition from
`connecting` to `connected` in the backend after the async startup completes.
The overlay still showed `connecting` because `McpPanel` mounted
`ExtensionSettingsPanel` without `active={true}`, while the pending-status
refresh effect explicitly requires `props.active === true`.

The fix is to make the mounted MCP settings panel active at its single call
site. This preserves the existing `/mcp` refresh behavior and avoids adding
any parallel status source.
