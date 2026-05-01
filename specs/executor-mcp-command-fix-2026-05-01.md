# Executor MCP Command Fix - 2026-05-01

## Verified root cause

External executors receive the OpenCorvus MCP server through `MCPServe.command()`.
The current command always builds:

```text
<process.execPath> <import.meta.dir>/stdio.ts --cwd <worktree> --toolset executor
```

That is valid only when OpenCorvus is running from Bun source, where
`process.execPath` is the Bun executable and `stdio.ts` is a real file.

In the packaged Windows runtime, the active Claude Code process was launched
with:

```text
opencorvus-*.exe B:\~BUN\root\src\stdio.ts --cwd <goal-worktree> --toolset executor
```

`B:\~BUN\root\src\stdio.ts` is a Bun virtual source path, not a host file.
Running that command prints the OpenCorvus CLI help instead of starting the MCP
stdio server. As a result, Claude Code never connects to the OpenCorvus MCP
server and cannot see tools such as `mcp__opencorvus__task_report`.

Database evidence from task `tsk_de3db7236001q3ZD0IlgOUxYxg` shows multiple
goal sessions searching for `task_report` / `mcp__opencorvus__task_report`,
including a failed tool call with `No such tool available`. This is systemic
executor MCP startup failure, not a single goal prompt issue.

## Fix

Keep one command source: `MCPServe.command()`.

- Bun source runtime: keep launching `stdio.ts` through Bun.
- Packaged runtime: launch the embedded CLI subcommand instead:

```text
opencorvus mcp serve --cwd <worktree> --toolset executor
```

The CLI route already exists and calls the same `MCPServe.serve()` implementation,
so this removes the invalid virtual-file dependency without creating a second
MCP server implementation.

Also stop serializing the full process environment into Claude Code MCP config.
Claude Code already receives the intended environment from the SDK options, and
its MCP subprocess inherits that environment. Embedding the full environment in
`--mcp-config` makes Windows command lines large and exposes secrets in process
metadata.

## Regression tests

- `MCPServe.command()` returns `stdio.ts` only for Bun source runtime.
- `MCPServe.command()` returns `mcp serve` for packaged Windows executables.
- `MCPServe.command()` returns `mcp serve` for packaged POSIX executables.
- Claude SDK MCP server config omits explicit `env` when none is required.

## Manual verification target

After the patch, a packaged executor MCP config must contain:

```text
command: <opencorvus executable>
args: ["mcp", "serve", "--cwd", <worktree>, "--toolset", "executor"]
```

It must not contain a `B:\~BUN` or `/$bunfs` source path.
