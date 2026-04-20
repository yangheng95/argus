# Hexin cache benchmark

- mode: `synthetic cc-layout=fixed-invariant`
- endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/chat/completions`
- model: `claude-sonnet-4-6`  iterations: 8  sleep: 300ms  x-user: `hexin-bench-fixed-invariant-1776655759170`

## Overall

| metric | value |
|---|---|
| hit_ratio | **87.5%** (7/8) |
| miss      | 1 |
| error     | 0 |
| Σ cache_read     | 24142 |
| Σ cache_creation | 3490 |
| Σ input_tokens   | 28664 |
| Σ effective_input_billed | 7809 |
| avg_lat hit  | 4022 ms |
| avg_lat miss | 5316 ms |

## By routing fingerprint

| route_key | hits | misses |
|---|---|---|
| `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` | 7 | 1 |

## Per-iteration

| # | status | latency_ms | input | output | cache_read | cache_creation | effective_input_billed | route |
|---|---|---|---|---|---|---|---|---|
| 1 | HIT | 3183 | 3485 | 4 | 3445 | 9 | 387 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 2 | HIT | 5571 | 3513 | 4 | 3445 | 9 | 415 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 3 | HIT | 3992 | 3541 | 4 | 3445 | 9 | 443 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 4 | HIT | 2253 | 3569 | 4 | 3445 | 9 | 471 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 5 | HIT | 2693 | 3597 | 4 | 3454 | 0 | 488 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 6 | MISS | 5316 | 3625 | 8 | 0 | 3454 | 4489 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 7 | HIT | 2592 | 3653 | 8 | 3454 | 0 | 544 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 8 | HIT | 7873 | 3681 | 8 | 3454 | 0 | 572 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
