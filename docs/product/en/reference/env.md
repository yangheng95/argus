# Environment variables

All variables, grouped by category. Sources: `packages/opencorvus/src/flag/flag.ts`, `script/benchmark/env.ts`, `packages/channel-runtime/.env.example`.

## Core

| Variable                    | Purpose                      | Default                 |
| --------------------------- | ---------------------------- | ----------------------- |
| `OPENCORVUS_HOME`           | Local data directory         | `~/.opencorvus`         |
| `OPENCORVUS_CONFIG_DIR`     | Config directory             | system managed          |
| `OPENCORVUS_CONFIG_CONTENT` | Runtime-injected JSON config | —                       |
| `OPENCORVUS_PROJECT_DIR`    | Default working directory    | `cwd()`                 |
| `OPENCORVUS_CHANNEL`        | Runtime channel              | `local` \| `slack` \| … |
| `OPENCORVUS_DEFAULT_MODEL`  | Default LLM model            | auto-detect             |

## Server

| Variable                     | Purpose                                | Default                 |
| ---------------------------- | -------------------------------------- | ----------------------- |
| `OPENCORVUS_SERVER_PASSWORD` | HTTP Basic Auth (required when public) | —                       |
| `OPENCORVUS_SERVER_URL`      | Default client URL                     | `http://127.0.0.1:7878` |

## Executor / timeouts

| Variable                                     | Purpose                           | Default                             |
| -------------------------------------------- | --------------------------------- | ----------------------------------- |
| `OPENCORVUS_AUTO_DISCOVER_EXECUTORS`         | Auto-discover codex / claude-code | `0`                                 |
| `OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE` | Claude executor permission        | `ask`                               |
| `OPENCORVUS_EXECUTOR_CODEX_PERMISSION_MODE`  | Codex executor permission         | `ask`                               |
| `OPENCORVUS_TOOL_TIMEOUT_MS`                 | Per-tool inactivity timeout       | no global default (per-tool)        |
| `OPENCORVUS_INTERACTION_TIMEOUT_MS`          | Interaction request timeout       | 300000 (`src/engine/runtime.ts:48`) |

## Permission

| Variable                                | Purpose                                       | Default    |
| --------------------------------------- | --------------------------------------------- | ---------- |
| `OPENCORVUS_PERMISSION_TIMEOUT_MS`      | Reject timeout for unanswered permission asks | 300000     |
| `OPENCORVUS_CHANNEL_PERMISSION_PROFILE` | Channel template                              | `standard` |

Valid profiles: `restricted / standard / permissive / passthrough`.

## Plugins / skills

| Variable                                  | Purpose                                        |
| ----------------------------------------- | ---------------------------------------------- |
| `OPENCORVUS_DISABLE_EXTERNAL_SKILLS=1`    | Skip `.claude/` and `.agents/` skill discovery |
| `OPENCORVUS_DISABLE_CLAUDE_CODE_SKILLS=1` | Skip Claude Code skill discovery               |

## Overlay

| Variable                            | Purpose                         |
| ----------------------------------- | ------------------------------- |
| `OPENCORVUS_OVERLAY_BIN`            | Overlay binary path override    |
| `OPENCORVUS_OVERLAY_DISABLED=1`     | Disable overlay entirely        |
| `OPENCORVUS_OVERLAY_SINGLETON_MODE` | `kill-old-start-new` \| `reuse` |
| `OPENCORVUS_OVERLAY_RETRY_BASE_MS`  | Retry backoff base              |
| `OPENCORVUS_OVERLAY_CIRCUIT_*`      | Circuit-breaker tuning          |

## LLM providers

### Generic

| Variable                       | Provider   |
| ------------------------------ | ---------- |
| `ANTHROPIC_API_KEY`            | Anthropic  |
| `OPENAI_API_KEY`               | OpenAI     |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI  |
| `DEEPSEEK_API_KEY`             | DeepSeek   |
| `OPENROUTER_API_KEY`           | OpenRouter |

### DashScope (Alibaba)

| Variable                      | Notes                         |
| ----------------------------- | ----------------------------- |
| `DASHSCOPE_API_KEY`           | Intl endpoint (`sk-` prefix)  |
| `CODING_DASHSCOPE_API_KEY`    | Coding Plan (`sk-sp-` prefix) |
| `DASHSCOPE_CODING_BASE_URL`   | Coding URL                    |
| `DASHSCOPE_INTL_BASE_URL`     | Intl URL                      |
| `ALIBABA_CODING_PLAN_API_KEY` | Coding Plan key               |

### Model overrides

| Variable                      | Purpose                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| `OPENCORVUS_MODEL_ALIBABA`    | Alibaba interactive default                                               |
| `OPENCORVUS_MODEL_ANTHROPIC`  | Anthropic default                                                         |
| `OPENCORVUS_MODEL_OPENAI`     | OpenAI default                                                            |
| `OPENCORVUS_MODEL_GOOGLE`     | Google default                                                            |
| `OPENCORVUS_MODEL_DEEPSEEK`   | DeepSeek default                                                          |
| `OPENCORVUS_MODEL_OPENROUTER` | OpenRouter default                                                        |
| `OPENCORVUS_VISION_MODEL`     | Vision / screenshot model                                                 |
| `OPENCORVUS_BENCHMARK_MODEL`  | Benchmark model (Gateway does **not** read this; set `cfg.model` instead) |

## STT

| Variable                                                | Purpose                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `STT_PROVIDERS`                                         | Priority list (`groq,openai-whisper,deepgram,google-gemini,local-cli`) |
| `STT_LANGUAGE`                                          | Recognition language                                                   |
| `GROQ_API_KEY` / `STT_GROQ_MODEL` / `STT_GROQ_BASE_URL` | Groq                                                                   |
| `STT_OPENAI_MODEL` / `STT_OPENAI_BASE_URL`              | OpenAI Whisper                                                         |
| `DEEPGRAM_API_KEY` / `STT_DEEPGRAM_*`                   | Deepgram                                                               |
| `GOOGLE_API_KEY` / `STT_GOOGLE_*`                       | Google Gemini                                                          |
| `STT_LOCAL_COMMAND`                                     | Local CLI (e.g., whisper)                                              |

## Channels

Per-channel env is documented in each [channel page](../channels/overview.md).

## Benchmark / testing

| Variable           | Purpose                            |
| ------------------ | ---------------------------------- |
| `TEST_PROMPT`      | Auto-inject prompt after startup   |
| `SLACK_CHANNEL_ID` | Paired with `TEST_PROMPT`          |
| `SSL_CERT_FILE`    | Extra CA bundle for enterprise TLS |

## Shared session / overlay integration

| Variable                           | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `OPENCORVUS_CHANNEL_SERVER_URL`    | Backend URL for channel-runtime (usually injected by overlay) |
| `OPENCORVUS_SHARED_SESSION_MODE=1` | Shared session mode                                           |
| `OPENCORVUS_SHARED_SESSION_FILE`   | Shared session file path                                      |
| `OPENCORVUS_MIRROR_STDOUT=1`       | Mirror stdout upstream                                        |

## Internal (do not set manually)

`OPENCORVUS_OVERLAY_MODE`, `OPENCORVUS_OVERLAY_STDIN_EXIT`, `OPENCORVUS_EMBEDDED_OVERLAY_B64`, `OPENCORVUS_EMBEDDED_OVERLAY_HASH` — injected by the parent process.
