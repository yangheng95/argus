# Hexin cache benchmark

- mode: `synthetic cc-layout=single-sliding`
- endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/chat/completions`
- model: `claude-sonnet-4-6`  iterations: 30  sleep: 300ms  x-user: `hexin-bench-single-sliding-1776656064074`

## Overall

| metric | value |
|---|---|
| hit_ratio | **93.3%** (28/30) |
| miss      | 2 |
| error     | 0 |
| Σ cache_read     | 107007 |
| Σ cache_creation | 9633 |
| Σ input_tokens   | 116730 |
| Σ effective_input_billed | 22833 |
| avg_lat hit  | 3480 ms |
| avg_lat miss | 2562 ms |

## By routing fingerprint

| route_key | hits | misses |
|---|---|---|
| `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` | 28 | 2 |

## Per-iteration

| # | status | latency_ms | input | output | cache_read | cache_creation | effective_input_billed | route |
|---|---|---|---|---|---|---|---|---|
| 1 | HIT | 3352 | 3485 | 4 | 3454 | 28 | 383 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 2 | HIT | 3200 | 3513 | 4 | 3510 | 0 | 354 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 3 | HIT | 3847 | 3541 | 4 | 3482 | 56 | 421 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 4 | HIT | 3941 | 3569 | 4 | 3566 | 0 | 360 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 5 | HIT | 2177 | 3597 | 4 | 3510 | 84 | 459 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 6 | HIT | 2834 | 3625 | 8 | 3538 | 84 | 462 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 7 | HIT | 2581 | 3653 | 8 | 3650 | 0 | 368 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 8 | HIT | 4247 | 3681 | 8 | 3678 | 0 | 371 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 9 | HIT | 4057 | 3709 | 8 | 3706 | 0 | 374 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 10 | HIT | 2825 | 3737 | 8 | 3706 | 28 | 409 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 11 | HIT | 2784 | 3765 | 8 | 3734 | 28 | 411 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 12 | HIT | 3115 | 3793 | 8 | 3790 | 0 | 382 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 13 | HIT | 4061 | 3821 | 8 | 3818 | 0 | 385 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 14 | HIT | 3852 | 3849 | 8 | 3846 | 0 | 388 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 15 | HIT | 2209 | 3877 | 8 | 3734 | 140 | 551 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 16 | HIT | 3156 | 3905 | 8 | 3874 | 28 | 425 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 17 | HIT | 4726 | 3933 | 8 | 3902 | 28 | 428 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 18 | MISS | 1974 | 3961 | 8 | 0 | 3958 | 4951 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 19 | HIT | 4087 | 3989 | 8 | 3986 | 0 | 402 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 20 | HIT | 2262 | 4017 | 8 | 4014 | 0 | 404 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 21 | HIT | 4348 | 4045 | 8 | 3986 | 56 | 472 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 22 | HIT | 4947 | 4073 | 8 | 4042 | 28 | 442 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 23 | HIT | 4952 | 4101 | 8 | 4070 | 28 | 445 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 24 | MISS | 3150 | 4129 | 8 | 0 | 4126 | 5161 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 25 | HIT | 4298 | 4157 | 8 | 4154 | 0 | 418 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 26 | HIT | 4106 | 4185 | 8 | 4182 | 0 | 421 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 27 | HIT | 2671 | 4213 | 8 | 4070 | 140 | 585 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 28 | HIT | 3336 | 4241 | 8 | 3445 | 793 | 1339 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 29 | HIT | 2366 | 4269 | 8 | 4266 | 0 | 430 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 30 | HIT | 3106 | 4297 | 8 | 4294 | 0 | 432 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
