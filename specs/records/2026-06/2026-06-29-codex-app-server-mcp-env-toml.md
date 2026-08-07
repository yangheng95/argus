# Codex app-server MCP env TOML fix - 2026-06-29

## Recall

- User request: fix Codex app-server MCP startup so live executor smoke uses
  the configured OpenCorvus MCP tool rather than a shell workaround.
- Acceptance: Codex receives TOML-valid MCP server config, exposes the
  executor-facing OpenCorvus tools, and live smoke proves an MCP tool call
  rather than Bash.
- Hard constraints: no alternate launch fallback, no compatibility parser, no
  broad git reset, and failing advertised MCP capabilities must remain fatal.
- Read before implementation: `AGENTS.md`, Codex app-server help output,
  executor bootstrap, MCP serve/index code, and existing executor/MCP tests.
- Repository sweep: `mcp_servers.opencorvus`, runtime env, `enabled_tools`,
  prompt/resource listing, source-mode Bun command, and live executor smoke
  call sites.
- Independent feedback: direct SDK stdio smoke reproduced the startup failure,
  proving the root defect was OpenCorvus MCP startup rather than Codex tool
  choice.

## Evidence

- Local `codex --version` reports `codex-cli 0.141.0`.
- Focused non-live executor tests passed before the fix: `bun test packages/opencorvus/test/executor/request-mapping.test.ts packages/opencorvus/test/executor/external-cli.test.ts packages/opencorvus/test/executor/json-rpc.test.ts packages/opencorvus/test/executor/codex-app-server.test.ts packages/opencorvus/test/executor/bootstrap.test.ts packages/opencorvus/test/executor/managed.test.ts packages/opencorvus/test/executor/runtime-env.test.ts packages/opencorvus/test/executor/discovery.test.ts`.
- Live Codex smoke failed before model execution: `OPENCORVUS_RUN_LIVE_EXECUTOR_TESTS=1 bun test packages/opencorvus/test/executor/live-official.test.ts --test-name-pattern "codex app-server"`.
- Direct child stderr: `invalid type: string "{\"OPENCORVUS_SESSION_ID\":\"live_codex\"}", expected a map in mcp_servers.opencorvus.env`.
- `codex app-server --help` says `-c` values are parsed as TOML; JSON object syntax is not a TOML map.
- After the env fix, a marker-only live smoke could still pass by having Codex run Bash against the fixture MCP server manually. That is not a valid Codex executor integration pass because the proxied OpenCorvus MCP tool was not invoked.
- Codex `0.141.0` model-side tool search did not expose the OpenCorvus MCP tools with only `command`, `args`, and `env` configured.
- `default_tools_enabled` is an app/connector setting, not an MCP server setting. The MCP server tool exposure control is `enabled_tools`.
- After configuring `enabled_tools`, Codex surfaced OpenCorvus MCP startup telemetry. The server still failed to start because `MCPServe.serve()` prewarmed prompts and resources for every configured MCP client, including clients that did not advertise those capabilities. The SDK returned `MCP error -32601: Method not found`, causing stdio initialization to close before Codex could list tools.
- A direct SDK stdio smoke against `MCPServe.command(...)` reproduced the startup failure outside Codex, proving the remaining defect was in the OpenCorvus MCP server startup path rather than Codex tool choice.
- Source-mode Bun command construction also needed to run from the package root so `@/` imports and `tsconfig.json` resolution are stable, while preserving the target project directory as the explicit `--cwd` argument to the MCP server.
- Final combined MCP regression exposed a test-tooling defect: `prompt-resource-fail-fast.test.ts` installed top-level SDK module mocks, which polluted same-process `serve.test.ts` and hid the real SDK. The mocked suite now runs in an isolated child process with its own test home and portable data root.

## Call-point Inventory

| Area                            | File                                                                                                                                      | Decision                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex app-server bootstrap      | `packages/opencorvus/src/executor/bootstrap.ts`                                                                                           | Replace JSON object serialization for `mcp_servers.opencorvus.env` with a TOML inline table. Keep command and args on their existing TOML-compatible string/array values.                                                     |
| Runtime env source              | `packages/opencorvus/src/executor/contract.ts`                                                                                            | Keep `codingRuntimeEnv(...)` as the single source for OpenCorvus executor env keys.                                                                                                                                           |
| Executor-facing MCP definitions | `packages/opencorvus/src/mcp/serve.ts`                                                                                                    | Use `MCPServe.toolDefinitions("executor")` as the single source for Codex `enabled_tools`, including runtime tools and allowed project proxied tools.                                                                         |
| Executor MCP source command     | `packages/opencorvus/src/mcp/serve.ts`                                                                                                    | Launch source-mode Bun with Bun's process cwd set to the OpenCorvus package root, and pass the target project cwd only through the server argument.                                                                           |
| MCP prompt/resource listing     | `packages/opencorvus/src/mcp/index.ts`                                                                                                    | Use the MCP client's advertised capabilities as the single source for whether prompts/resources exist. If a capability is advertised, list failures still fail fast and close the connection.                                 |
| Bootstrap regression            | `packages/opencorvus/test/executor/bootstrap.test.ts`                                                                                     | Assert the env argument is a TOML inline table, including empty and populated runtime env cases.                                                                                                                              |
| Live smoke                      | `packages/opencorvus/test/executor/live-official.test.ts`                                                                                 | Require the event stream to contain `fixture_magic_lookup` and reject Bash, so the smoke cannot pass through a shell workaround.                                                                                              |
| MCP serving regression          | `packages/opencorvus/test/mcp/serve.test.ts`                                                                                              | Assert project-configured external MCP tools are loaded into executor-facing tool definitions and callable through the OpenCorvus proxy, including direct stdio startup through the generated command.                        |
| Prompt/resource regression      | `packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts` and `packages/opencorvus/test/mcp/prompt-resource-fail-fast.isolated.ts` | Assert unsupported prompt/resource capabilities are skipped without calling unsupported methods, and advertised prompt/resource list failures remain fatal. Keep SDK module mocks isolated from same-process MCP serve tests. |

## Fix Shape

- Add a small local TOML literal serializer for string maps in `bootstrap.ts`.
- Use double-quoted TOML strings with escaped backslash, quote, and control characters.
- Configure the trusted OpenCorvus MCP server with `enabled_tools=[...]` generated from `MCPServe.toolDefinitions("executor")` so Codex exposes the executor-facing tools to the model.
- Keep `default_tools_approval_mode="approve"` as the existing per-call approval suppression for this trusted local server.
- Surface Codex `mcpServer/startupStatus/updated` notifications as executor progress events so MCP startup failures are observable in the event stream.
- Respect MCP prompt/resource capability advertisement before listing those surfaces. This is not a fallback: unsupported capabilities are absent by protocol declaration, while advertised-but-failing capabilities still fail the connection.
- Make the generated Bun stdio command run from the package root and keep the project directory as the server's explicit `--cwd`.
- Move the SDK-mocked prompt/resource fail-fast checks into an isolated helper process so normal test files retain the real MCP SDK modules.
- Do not add fallback parsing, compatibility branches, or alternate Codex launch paths.

## Verification

- `bun test packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts packages/opencorvus/test/mcp/serve.test.ts` passed: 15 pass in the parent process; the isolated child suite reported 10 pass / 0 fail, and `serve.test.ts` reported 14 pass / 0 fail with the real SDK.
- `bun test packages/opencorvus/test/executor/request-mapping.test.ts packages/opencorvus/test/executor/external-cli.test.ts packages/opencorvus/test/executor/json-rpc.test.ts packages/opencorvus/test/executor/codex-app-server.test.ts packages/opencorvus/test/executor/bootstrap.test.ts packages/opencorvus/test/executor/managed.test.ts packages/opencorvus/test/executor/runtime-env.test.ts packages/opencorvus/test/executor/discovery.test.ts` passed: 44 pass.
- `OPENCORVUS_RUN_LIVE_EXECUTOR_TESTS=1 bun test packages/opencorvus/test/executor/live-official.test.ts --test-name-pattern "codex app-server"` passed: Codex `0.141.0` reported `opencorvus` MCP startup `ready`, emitted `mcpToolCall` for `fixture_magic_lookup`, and returned the marker `mcp-live-codex-mqypi31f`.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check` passed for the touched files.
