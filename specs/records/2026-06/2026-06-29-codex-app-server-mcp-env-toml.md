# Codex app-server MCP env TOML fix - 2026-06-29

## Evidence

- Local `codex --version` reports `codex-cli 0.141.0`.
- Focused non-live executor tests passed before the fix: `bun test packages/opencorvus/test/executor/request-mapping.test.ts packages/opencorvus/test/executor/external-cli.test.ts packages/opencorvus/test/executor/json-rpc.test.ts packages/opencorvus/test/executor/codex-app-server.test.ts packages/opencorvus/test/executor/bootstrap.test.ts packages/opencorvus/test/executor/managed.test.ts packages/opencorvus/test/executor/runtime-env.test.ts packages/opencorvus/test/executor/discovery.test.ts`.
- Live Codex smoke failed before model execution: `OPENCORVUS_RUN_LIVE_EXECUTOR_TESTS=1 bun test packages/opencorvus/test/executor/live-official.test.ts --test-name-pattern "codex app-server"`.
- Direct child stderr: `invalid type: string "{\"OPENCORVUS_SESSION_ID\":\"live_codex\"}", expected a map in mcp_servers.opencorvus.env`.
- `codex app-server --help` says `-c` values are parsed as TOML; JSON object syntax is not a TOML map.
- After the env fix, a marker-only live smoke could still pass by having Codex run Bash against the fixture MCP server manually. That is not a valid Codex executor integration pass because the proxied OpenCorvus MCP tool was not invoked.
- Codex `0.141.0` model-side tool search did not expose the OpenCorvus MCP tools with only `command`, `args`, and `env` configured.
- `default_tools_enabled` is an app/connector setting, not an MCP server setting. The MCP server tool exposure control is `enabled_tools`.

## Call-point Inventory

| Area | File | Decision |
| --- | --- | --- |
| Codex app-server bootstrap | `packages/opencorvus/src/executor/bootstrap.ts` | Replace JSON object serialization for `mcp_servers.opencorvus.env` with a TOML inline table. Keep command and args on their existing TOML-compatible string/array values. |
| Runtime env source | `packages/opencorvus/src/executor/contract.ts` | Keep `codingRuntimeEnv(...)` as the single source for OpenCorvus executor env keys. |
| Executor-facing MCP definitions | `packages/opencorvus/src/mcp/serve.ts` | Use `MCPServe.toolDefinitions("executor")` as the single source for Codex `enabled_tools`, including runtime tools and allowed project proxied tools. |
| Bootstrap regression | `packages/opencorvus/test/executor/bootstrap.test.ts` | Assert the env argument is a TOML inline table, including empty and populated runtime env cases. |
| Live smoke | `packages/opencorvus/test/executor/live-official.test.ts` | Require the event stream to contain `fixture_magic_lookup` and reject Bash, so the smoke cannot pass through a shell workaround. |
| MCP serving regression | `packages/opencorvus/test/mcp/serve.test.ts` | Assert project-configured external MCP tools are loaded into executor-facing tool definitions and callable through the OpenCorvus proxy. |

## Fix Shape

- Add a small local TOML literal serializer for string maps in `bootstrap.ts`.
- Use double-quoted TOML strings with escaped backslash, quote, and control characters.
- Configure the trusted OpenCorvus MCP server with `enabled_tools=[...]` generated from `MCPServe.toolDefinitions("executor")` so Codex exposes the executor-facing tools to the model.
- Keep `default_tools_approval_mode="approve"` as the existing per-call approval suppression for this trusted local server.
- Do not add fallback parsing, compatibility branches, or alternate Codex launch paths.

## Verification

- Focused bootstrap unit tests.
- Focused executor suite.
- MCP serving regression.
- Direct `codex app-server` minimal startup with the generated env form.
- Codex-only live smoke that verifies the real proxied MCP tool call in events.
