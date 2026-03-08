# Coding Executor Compatibility

This folder now contains a small compatibility layer for coding-agent backends that do not share the same native API shape.

Current adapters:

- `opencode`: the existing in-process executor used by the orchestrator.
- `codex`: normalizes OpenAI Responses API streams into a common event model.
- `claude-code`: normalizes Claude Code / Claude Agent SDK message streams into the same event model.

## Why this exists

Codex and Claude Code expose different concepts:

- Codex is centered around the OpenAI Responses API and response IDs.
- Claude Code is centered around the Claude Agent SDK and session IDs.

The compatibility layer keeps the shared surface small:

- `run`
- `resume`
- `interrupt`
- `capabilities`
- normalized events:
  - `status`
  - `text_delta`
  - `tool_call`
  - `tool_result`
  - `done`
  - `error`

## Contract

Use the shared schemas from [`compat.ts`](./compat.ts):

- `CodingRunInput`
- `CodingResumeInput`
- `CodingCapabilities`
- `CodingEvent`

For orchestrator task execution, use the runtime registry from [`registry.ts`](./registry.ts).
`opencode` is registered by default. Other executor names such as `codex` and `claude-code`
must be registered explicitly before task creation.
If you already have a normalized `CodingProvider`, use `ExecutorRegistry.registerCoding(...)`
to wrap it into the same orchestrator-facing executor contract as `opencode`.

## Example

```ts
import { CodexExecutor } from "opencorvus/executor/codex"
import { ClaudeCodeExecutor } from "opencorvus/executor/claude-code"

const codex = CodexExecutor.create(openai)

const claude = ClaudeCodeExecutor.create(query)

for await (const event of codex.run({
  model: "gpt-5.2-codex",
  prompt: "Fix the failing tests",
})) {
  console.log(event)
}
```

```ts
import { ExecutorRegistry } from "opencorvus/executor/registry"

ExecutorRegistry.registerCoding("codex", codex, {
  cwd: "/repo",
})
```

## Orchestrator usage

Task creation now accepts an optional `executor` field:

```json
{
  "request": "Fix the failing tests",
  "executor": "codex"
}
```

If the named executor is not registered, task creation fails fast with `400 Bad Request`
instead of creating a run that cannot dispatch.

## External CLI discovery

When `OPENCORVUS_AUTO_DISCOVER_EXECUTORS=1` is set, OpenCorvus scans:

- `OPENCORVUS_EXECUTOR_SEARCH_PATHS`
- a sibling `tools/` directory next to the binary
- the user PATH
- common install directories such as `~/.local/bin` and Windows npm global bins

Detected `codex` and `claude code` installs are wrapped and registered automatically.
`opencode` remains available as the built-in default executor.

## Capability differences

- `codex` supports builtin tools and function tools in this layer.
- `claude-code` supports builtin Claude tools in this layer.
- `claude-code` does not map arbitrary function-tool JSON schemas yet; that remains provider-specific.
- `interrupt` is only marked available when the underlying transport exposes a real cancel primitive.
- For external CLI discovery, model selection is not hardcoded. If no model override is provided, the user's Codex or Claude Code CLI default config is used.

## Notes

- Anthropic renamed the public SDK surface from "Claude Code SDK" to "Claude Agent SDK". The adapter keeps the older `claude-code` name because that is still the clearest executor label in our runtime.
- This module is intentionally independent from the orchestrator runtime for now. It gives us a tested adapter contract before wiring a second executor into production task flow.
