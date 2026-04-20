# Hexin cache benchmark

- mode: `synthetic cc-layout=system-only`
- endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/chat/completions`
- model: `claude-sonnet-4-6`  iterations: 8  sleep: 300ms  x-user: `hexin-bench-system-only-1776655726995`

## Overall

| metric | value |
|---|---|
| hit_ratio | **100.0%** (8/8) |
| miss      | 0 |
| error     | 0 |
| Σ cache_read     | 27560 |
| Σ cache_creation | 0 |
| Σ input_tokens   | 28664 |
| Σ effective_input_billed | 3864 |
| avg_lat hit  | 2514 ms |
| avg_lat miss | 0 ms |

## By routing fingerprint

| route_key | hits | misses |
|---|---|---|
| `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` | 8 | 0 |

## Per-iteration

| # | status | latency_ms | input | output | cache_read | cache_creation | effective_input_billed | route |
|---|---|---|---|---|---|---|---|---|
| 1 | HIT | 2414 | 3485 | 4 | 3445 | 0 | 385 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 2 | HIT | 2491 | 3513 | 4 | 3445 | 0 | 413 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 3 | HIT | 2267 | 3541 | 4 | 3445 | 0 | 441 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 4 | HIT | 2257 | 3569 | 4 | 3445 | 0 | 469 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 5 | HIT | 2570 | 3597 | 4 | 3445 | 0 | 497 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 6 | HIT | 2978 | 3625 | 8 | 3445 | 0 | 525 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 7 | HIT | 2435 | 3653 | 8 | 3445 | 0 | 553 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 8 | HIT | 2699 | 3681 | 8 | 3445 | 0 | 581 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
