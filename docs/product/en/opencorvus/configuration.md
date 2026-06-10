# Configuration

OpenCorvus config layers: **CLI flag > environment variable > `opencorvus.jsonc` file**. The file has lowest precedence but is the most durable.

## File locations

| Location                               | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| `~/.opencorvus/config/opencorvus.json` | Global defaults                                   |
| `<repo>/.opencorvus/opencorvus.jsonc`  | Project-level override (JSONC comments supported) |
| `OPENCORVUS_CONFIG_CONTENT` env        | Runtime injection (recommended for CI/containers) |

Same-name fields: later wins.

## Minimal config

```jsonc
{
  "$schema": "https://opencorvus.ai/config.json",
  "model": "alibaba-cn/qwen3.5-plus",
}
```

## Complete example

Modeled on the real `packages/opencorvus/.opencorvus/opencorvus.jsonc`:

```jsonc
{
  "$schema": "https://opencorvus.ai/config.json",
  "model": "github-copilot/claude-haiku-4.5",

  "network": {
    "proxy": {
      "enabled": true,
      "url": "http://127.0.0.1:7890",
    },
  },

  "skills": {
    "paths": ["<abs-path>/skills-market/github.com-anthropics-skills"],
    "urls": [],
  },

  "plugin": [],

  "permission": {
    "skill": {
      "local-note": "deny",
      "sora": "ask",
      "figma": "ask",
    },
  },

  "assistant": {
    "auto_iteration": false,
    "max_executor_groups": 3,
    "default_workflow": "pipeline",
  },

  "experimental": {
    "auto_question": true,
  },
}
```

## Key fields

### `model`

Default LLM. Format `<providerId>/<modelId>`; provider must be registered in `provider` or built-in.

### `small_model`

Lightweight model used for summary / title generation and similar low-stakes tasks. Falls back to `model` when unset.

### `locale`

`"en-US" | "zh-CN"` — operator-selected system language; influences LLM reply language and SDK pass-through. Distinct from the Overlay UI locale preference (localStorage, front-end text only).

### `network.proxy`

HTTP(S) proxy for model provider requests. `enabled: false` or an empty `url` means direct fetch. `url` supports `http://` and `https://`.

```jsonc
{
  "network": {
    "proxy": {
      "enabled": true,
      "url": "http://127.0.0.1:7890",
    },
  },
}
```

### `skills.paths` / `skills.urls`

Local skill market paths and remote skill URLs. Loaded at startup.

### `permission`

Per-skill / per-tool `allow / ask / deny`. **Rule order matters, last declaration wins** (last-match-wins).

See [Permissions](./permissions.md).

### `enabled_providers` / `disabled_providers`

Explicit allow-list / deny-list for providers. `enabled_providers` (when non-empty) restricts the active set to only the named providers; `disabled_providers` is a deny-list. Both take priority over the "no API key → skip" heuristic. See [Providers](./providers.md).

### `tool_permissions`

Task-level tool permission defaults (snapshot at task creation time). Distinct from `permission.tool`, which is a project-persistent declarative rule.

### `experimental.auto_question`

Fine-grained switch for stale clarification questions. Permission prompts are not controlled here; built-in agent permissions default to `allow`, and explicit `ask` rules wait for an operator reply until the reject timeout fires.

### `assistant` block

Fine-tunes orchestration policy and each agent (merged in `EngineConfig.get()` — see `src/engine/config.ts`):

```jsonc
{
  "assistant": {
    "auto_iteration": false,
    "requirements": { "max_steps": 20 },
    "architect": { "max_steps": 40 },
    "build": { "max_steps": 80, "skills": [] },
    "acceptance": { "max_retries": 2 },
    "max_executor_groups": 3,
  },
}
```

`assistant.auto_iteration` defaults to `false`. When disabled, failed goal waves
and rejected `deliver` verdicts are reported as visible endpoints and OpenCorvus
waits for operator follow-up. Set it to `true` only when OpenCorvus should
automatically reopen rework attempts and continue the build/deliver repair loop.

## Load order

1. `~/.opencorvus/config/opencorvus.json`
2. `$OPENCORVUS_CONFIG_DIR/opencorvus.json` (if set)
3. `<repo>/.opencorvus/opencorvus.jsonc`
4. Merge `OPENCORVUS_CONFIG_CONTENT` env (JSON string)
5. CLI flags override

Env snapshot: `Env.state()` snapshots `process.env` on instance creation. `.env` files must be loaded **before** the process starts — benchmarks inject env explicitly for this reason. See [Benchmark](../operations/benchmark.md).

## Hot reload

`PATCH /config` accepts a JSON Merge Patch (RFC 7396). After writing, the server publishes a `config.changed` event via SSE (`Bus.publish("config.changed")`); all connected Overlay instances automatically refresh their config store. Overlay sends only a partial diff — it does **not** do a full GET → clone → mutate → PATCH round-trip.
