# Hexin cache benchmark

- mode: `synthetic cc-layout=fixed-invariant`
- endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/chat/completions`
- model: `claude-sonnet-4-6`  iterations: 30  sleep: 300ms  x-user: `hexin-bench-fixed-invariant-1776656214462`

## Overall

| metric | value |
|---|---|
| hit_ratio | **100.0%** (30/30) |
| miss      | 0 |
| error     | 0 |
| Σ cache_read     | 103602 |
| Σ cache_creation | 18 |
| Σ input_tokens   | 116730 |
| Σ effective_input_billed | 23482 |
| avg_lat hit  | 3772 ms |
| avg_lat miss | 0 ms |

## By routing fingerprint

| route_key | hits | misses |
|---|---|---|
| `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` | 30 | 0 |

## Per-iteration

| # | status | latency_ms | input | output | cache_read | cache_creation | effective_input_billed | route |
|---|---|---|---|---|---|---|---|---|
| 1 | HIT | 4076 | 3485 | 4 | 3445 | 9 | 387 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 2 | HIT | 2552 | 3513 | 4 | 3454 | 0 | 404 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 3 | HIT | 3312 | 3541 | 4 | 3454 | 0 | 432 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 4 | HIT | 2597 | 3569 | 4 | 3454 | 0 | 460 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 5 | HIT | 4824 | 3597 | 4 | 3454 | 0 | 488 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 6 | HIT | 3345 | 3625 | 8 | 3454 | 0 | 516 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 7 | HIT | 4948 | 3653 | 8 | 3454 | 0 | 544 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 8 | HIT | 4007 | 3681 | 8 | 3454 | 0 | 572 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 9 | HIT | 2615 | 3709 | 8 | 3454 | 0 | 600 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 10 | HIT | 4552 | 3737 | 8 | 3454 | 0 | 628 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 11 | HIT | 4963 | 3765 | 8 | 3454 | 0 | 656 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 12 | HIT | 4503 | 3793 | 8 | 3454 | 0 | 684 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 13 | HIT | 2985 | 3821 | 8 | 3454 | 0 | 712 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 14 | HIT | 4130 | 3849 | 8 | 3454 | 0 | 740 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 15 | HIT | 3192 | 3877 | 8 | 3454 | 0 | 768 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 16 | HIT | 3388 | 3905 | 8 | 3454 | 0 | 796 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 17 | HIT | 3503 | 3933 | 8 | 3454 | 0 | 824 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 18 | HIT | 2592 | 3961 | 8 | 3454 | 0 | 852 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 19 | HIT | 5044 | 3989 | 8 | 3454 | 0 | 880 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 20 | HIT | 2182 | 4017 | 8 | 3454 | 0 | 908 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 21 | HIT | 3218 | 4045 | 8 | 3454 | 0 | 936 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 22 | HIT | 2567 | 4073 | 8 | 3445 | 9 | 975 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 23 | HIT | 6135 | 4101 | 8 | 3454 | 0 | 992 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 24 | HIT | 3811 | 4129 | 8 | 3454 | 0 | 1020 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 25 | HIT | 3308 | 4157 | 8 | 3454 | 0 | 1048 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 26 | HIT | 4539 | 4185 | 8 | 3454 | 0 | 1076 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 27 | HIT | 3787 | 4213 | 8 | 3454 | 0 | 1104 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 28 | HIT | 4599 | 4241 | 8 | 3454 | 0 | 1132 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 29 | HIT | 3750 | 4269 | 8 | 3454 | 0 | 1160 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 30 | HIT | 4123 | 4297 | 8 | 3454 | 0 | 1188 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
