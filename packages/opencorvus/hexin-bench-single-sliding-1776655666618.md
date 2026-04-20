# Hexin cache benchmark

- mode: `synthetic cc-layout=single-sliding`
- endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/chat/completions`
- model: `claude-sonnet-4-6`  iterations: 8  sleep: 300ms  x-user: `hexin-bench-single-sliding-1776655666618`

## Overall

| metric | value |
|---|---|
| hit_ratio | **100.0%** (8/8) |
| miss      | 0 |
| error     | 0 |
| Σ cache_read     | 28472 |
| Σ cache_creation | 168 |
| Σ input_tokens   | 28664 |
| Σ effective_input_billed | 3081 |
| avg_lat hit  | 2730 ms |
| avg_lat miss | 0 ms |

## By routing fingerprint

| route_key | hits | misses |
|---|---|---|
| `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` | 8 | 0 |

## Per-iteration

| # | status | latency_ms | input | output | cache_read | cache_creation | effective_input_billed | route |
|---|---|---|---|---|---|---|---|---|
| 1 | HIT | 2314 | 3485 | 4 | 3482 | 0 | 351 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 2 | HIT | 2434 | 3513 | 4 | 3482 | 28 | 386 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 3 | HIT | 2627 | 3541 | 4 | 3510 | 28 | 389 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 4 | HIT | 2692 | 3569 | 4 | 3566 | 0 | 360 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 5 | HIT | 3054 | 3597 | 4 | 3566 | 28 | 395 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 6 | HIT | 2393 | 3625 | 8 | 3594 | 28 | 397 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 7 | HIT | 2692 | 3653 | 8 | 3622 | 28 | 400 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 8 | HIT | 3636 | 3681 | 8 | 3650 | 28 | 403 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
