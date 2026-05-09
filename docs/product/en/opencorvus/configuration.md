# Configuration

OpenCorvus config layers: **CLI flag > environment variable > `opencorvus.jsonc` file**. The file has lowest precedence but is the most durable.

## File locations

| Location | Purpose |
|---|---|
| `~/.opencorvus/config/opencorvus.json` | Global defaults |
| `<repo>/.opencorvus/opencorvus.jsonc` | Project-level override (JSONC comments supported) |
| `OPENCORVUS_CONFIG_CONTENT` env | Runtime injection (recommended for CI/containers) |

Same-name fields: later wins.

## Minimal config

```jsonc
{
  "$schema": "https://opencorvus.ai/config.json",
  "model": "alibaba-cn/qwen3.5-plus"
}
```

## Complete example

Modeled on the real `packages/opencorvus/.opencorvus/opencorvus.jsonc`:

```jsonc
{
  "$schema": "https://opencorvus.ai/config.json",
  "model": "github-copilot/claude-haiku-4.5",

  "skills": {
    "paths": ["<abs-path>/skills-market/github.com-anthropics-skills"],
    "urls": []
  },

  "plugin": [],

  "permission": {
    "skill": {
      "local-note": "deny",
      "sora": "ask",
      "figma": "ask"
    }
  },

  "experimental": {
    "auto_question": true
  }
}
```

## Key fields

### `model`

Default LLM. Format `<providerId>/<modelId>`; provider must be registered in `provider` or built-in.

### `skills.paths` / `skills.urls`

Local skill market paths and remote skill URLs. Loaded at startup.

### `permission`

Per-skill / per-tool `allow / ask / deny`. **Rule order matters, last declaration wins** (last-match-wins).

See [Permissions](./permissions.md).

### `experimental.auto_question`

Fine-grained switch for stale clarification questions. Permission prompts are not controlled here; built-in agent permissions default to `allow`, and explicit `ask` rules wait for an operator reply until the reject timeout fires.

### `assistant` block

Fine-tunes each agent (merged in `OrchestratorConfig.get()` — see `src/orchestrator/config.ts:67`):

```jsonc
{
  "assistant": {
    "requirements": { "max_steps": 20 },
    "evaluator": { "tier": "standard" },  // core | standard | full
    "max_executor_groups": 3
  }
}
```

## Load order

1. `~/.opencorvus/config/opencorvus.json`
2. `$OPENCORVUS_CONFIG_DIR/opencorvus.json` (if set)
3. `<repo>/.opencorvus/opencorvus.jsonc`
4. Merge `OPENCORVUS_CONFIG_CONTENT` env (JSON string)
5. CLI flags override

Env snapshot: `Env.state()` snapshots `process.env` on instance creation. `.env` files must be loaded **before** the process starts — benchmarks inject env explicitly for this reason. See [Benchmark](../operations/benchmark.md).

## Hot reload

Not supported today. Restart `opencorvus serve` after config changes.
