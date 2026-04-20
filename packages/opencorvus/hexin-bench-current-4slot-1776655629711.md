# Hexin cache benchmark

- mode: `synthetic cc-layout=current-4slot`
- endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/chat/completions`
- model: `claude-sonnet-4-6`  iterations: 8  sleep: 300ms  x-user: `hexin-bench-current-4slot-1776655629711`

## Overall

| metric | value |
|---|---|
| hit_ratio | **50.0%** (4/8) |
| miss      | 4 |
| error     | 0 |
| Σ cache_read     | 14264 |
| Σ cache_creation | 14376 |
| Σ input_tokens   | 28664 |
| Σ effective_input_billed | 19422 |
| avg_lat hit  | 2697 ms |
| avg_lat miss | 3033 ms |

## By routing fingerprint

| route_key | hits | misses |
|---|---|---|
| `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` | 4 | 4 |

## Per-iteration

| # | status | latency_ms | input | output | cache_read | cache_creation | effective_input_billed | route |
|---|---|---|---|---|---|---|---|---|
| 1 | MISS | 2691 | 3485 | 4 | 0 | 3482 | 4356 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 2 | MISS | 2749 | 3513 | 4 | 0 | 3510 | 4391 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 3 | MISS | 2454 | 3541 | 4 | 0 | 3538 | 4426 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 4 | HIT | 2980 | 3569 | 4 | 3482 | 84 | 456 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 5 | MISS | 4239 | 3597 | 4 | 0 | 3594 | 4496 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 6 | HIT | 2672 | 3625 | 8 | 3594 | 28 | 397 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 7 | HIT | 2882 | 3653 | 8 | 3538 | 112 | 497 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 8 | HIT | 2252 | 3681 | 8 | 3650 | 28 | 403 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
