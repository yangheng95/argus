# Providers and models

OpenCorvus's LLM layer sits on top of [Vercel AI SDK](https://sdk.vercel.ai/), using `@ai-sdk/*` packages for each provider.

## Built-in providers

From `packages/opencorvus/package.json:52-90`:

Authority source: `BUNDLED_PROVIDERS` in `packages/opencorvus/src/provider/bundled.ts`.

| Provider | Package |
|---|---|
| Anthropic | `@ai-sdk/anthropic` + `@anthropic-ai/claude-agent-sdk` |
| OpenAI / compatible | `@ai-sdk/openai` + `@ai-sdk/openai-compatible` |
| Google Generative AI | `@ai-sdk/google` |
| Google Vertex / Vertex Anthropic | `@ai-sdk/google-vertex` + `@ai-sdk/google-vertex/anthropic` |
| Amazon Bedrock | `@ai-sdk/amazon-bedrock` |
| Azure OpenAI | `@ai-sdk/azure` |
| xAI | `@ai-sdk/xai` |
| Mistral | `@ai-sdk/mistral` |
| Groq | `@ai-sdk/groq` |
| DeepInfra | `@ai-sdk/deepinfra` |
| Cerebras | `@ai-sdk/cerebras` |
| Cohere | `@ai-sdk/cohere` |
| TogetherAI | `@ai-sdk/togetherai` |
| Perplexity | `@ai-sdk/perplexity` |
| Vercel | `@ai-sdk/vercel` |
| Vercel AI Gateway | `@ai-sdk/gateway` |
| GitLab AI | `@gitlab/gitlab-ai-provider` |
| OpenRouter | `@openrouter/ai-sdk-provider` |

China-region aliases (declared in `channel-runtime/.env.example`):

| Alias | Underlying |
|---|---|
| `alibaba-cn` | DashScope |
| `alibaba-coding-plan-cn` | DashScope Coding Plan |
| `moonshotai-cn` | Moonshot |
| `deepseek` | DeepSeek |

## Configuration

### A. Environment variables

Each provider's canonical key name works out of the box:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_GENERATIVE_AI_API_KEY=...
export DEEPSEEK_API_KEY=...
export OPENROUTER_API_KEY=...

# Alibaba DashScope (routed by key prefix)
export CODING_DASHSCOPE_API_KEY=sk-sp-...   # Coding Plan
export DASHSCOPE_API_KEY=sk-...             # Intl
```

### B. Custom provider (OpenAI-compatible)

In `opencorvus.jsonc`:

```jsonc
{
  "provider": {
    "myhub": {
      "api": "https://your-gateway/v1",
      "env": ["MYHUB_API_KEY"],
      "models": {
        "custom-1": { "name": "Custom 1", "tool_call": true }
      }
    }
  },
  "model": "myhub/custom-1"
}
```

`env` declares required env names; missing keys fail loud — no fallback.

## Model selection

| Scenario | Config |
|---|---|
| Default execution model | `model` field or `OPENCORVUS_DEFAULT_MODEL` |
| Lightweight tasks (title / summary) | `small_model` |
| Per-agent override | `assistant.<agent>.model` |
| Vision / screenshot understanding | `OPENCORVUS_VISION_MODEL` |

Splitting per-agent models from the execution default lets you **plan with a strong/slow model and execute with a fast/cheaper one**:

```jsonc
{
  "model": "alibaba-cn/qwen3.5-plus",
  "small_model": "alibaba-cn/qwen2.5-7b",
  "assistant": {
    "requirements": { "model": "anthropic/claude-sonnet-4-6" },
    "architect":    { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

> `assistant.planner.model` is no longer valid — the planning tool role has been removed.

## Reasoning-model constraints

For Claude reasoning, qwq, o1, and similar:

1. **Must use `streamText`** — `generateText` hangs while reasoning tokens stream.
2. **Must use `toolChoice: "auto"`**, not `"required"`.
3. **Prompt caching** matters (5-minute TTL for Anthropic reasoning models). Reuse system prompts across turns.

## Excluding / forcing a provider

Use the explicit `disabled_providers` list or simply omit the provider's API key. OpenCorvus removes keyless providers from the available list. To force-enable a provider regardless of key detection, add it to `enabled_providers`. Do not rely on heuristic filtering alone.

See also [Configuration → `enabled_providers` / `disabled_providers`](./configuration.md#enabled_providers--disabled_providers).
