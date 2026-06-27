# Hexin Model Info Limit Audit

## Evidence

Authenticated Hexin probes on 2026-06-27:

- `GET https://aimemodeldev.myhexin.com/litellm/v1/models` returned 44 model IDs.
- `GET https://aimemodeldev.myhexin.com/litellm/v1/model/info` returned 67 metadata rows.
- Every `/models` ID had at least one `/model/info` row.
- Ten `/models` IDs had no limit fields in `/model/info`: `ths-auto-v2`,
  `ths-auto`, `gpt-image-2`, `glm-5`, `Doubao-Seed-2.0-pro`,
  `qwen3.6-plus`, `dashscope/qwen3.5-397b-a17b`,
  `doubao-seedream-4-5-251128`, `tts`, and
  `volcengine/doubao-seedream-5-0-260128`.

For text/chat models with explicit limit fields, `max_input_tokens` is the
provider input boundary and `max_output_tokens` is the provider output
boundary. `max_tokens` is not a generic context field; for GPT, Qwen, and
Claude rows it equals the output limit.

## Updated Exact Profiles

| Model IDs | Hexin metadata | Local profile |
| --- | --- | --- |
| `gpt-5.4`, `gpt-5.5` | `max_input_tokens=1050000`, `max_output_tokens=128000` | `context=1050000`, `input=1050000`, `output=128000` |
| `gpt-5.4-mini` | `max_input_tokens=272000`, `max_output_tokens=128000` | already matched |
| `kimi-k2.5`, `kimi-k2.6`, `kimi-k2.7-code` | `max_input_tokens=262144`, `max_output_tokens=262144` | `context=262144`, `input=262144`, `output=262144` |
| `glm-5.1`, `openai/glm-5.1` | `max_input_tokens=200000`, `max_output_tokens=128000` | already matched |
| `qwen3.7-max` | `max_input_tokens=1000000`, `max_output_tokens=65536` | `context=1000000`, `input=1000000`, `output=65536` |
| `claude-sonnet-4-6`, `claude-sonnet-4-6-bak`, `cy-claude-sonnet-4-6`, `cy-claude-sonnet-4-6-v2` | `max_input_tokens=1000000`, `max_output_tokens=64000` | `context=1000000`, `input=1000000`, `output=64000` |

`gpt-5.4-nano` is not present in current `/models` or `/model/info`, so this
change does not claim a verified limit for it.

`glm-5` is present but has no limit fields in `/model/info`; this change does
not update its existing local profile.

## Decision

Update exact profiles only where Hexin supplied explicit limit metadata. Do not
spread those values to generic family matchers.

Replace the local hard-coded `claude-sonnet-4-6-v2` ID with the current Hexin
`cy-claude-sonnet-4-6-v2` ID. The former is not present in `/models`; the latter
is present and has model-info limits.

## Validation

- Profile unit tests assert the exact limits for updated model IDs.
- Hexin discovery tests assert refreshed model materialization carries the same
  `Provider.Model.limit` values.
- The `/provider/refresh` route test exercises the `ProviderRoutes` handler
  inside an explicit project instance so provider cache refresh is verified
  without unrelated full-server bootstrap.
- Snapshot helper tests assert newly generated local Hexin providers use
  `cy-claude-sonnet-4-6-v2`, not stale `claude-sonnet-4-6-v2`.
