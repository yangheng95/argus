# Hexin cache benchmark

- mode: `synthetic cc-layout=current-4slot`
- endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/chat/completions`
- model: `claude-sonnet-4-6`  iterations: 30  sleep: 300ms  x-user: `hexin-bench-current-4slot-1776655930820`

## Overall

| metric | value |
|---|---|
| hit_ratio | **93.3%** (28/30) |
| miss      | 2 |
| error     | 0 |
| Σ cache_read     | 106699 |
| Σ cache_creation | 9941 |
| Σ input_tokens   | 116730 |
| Σ effective_input_billed | 23187 |
| avg_lat hit  | 3757 ms |
| avg_lat miss | 2680 ms |

## By routing fingerprint

| route_key | hits | misses |
|---|---|---|
| `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` | 28 | 2 |

## Per-iteration

| # | status | latency_ms | input | output | cache_read | cache_creation | effective_input_billed | route |
|---|---|---|---|---|---|---|---|---|
| 1 | HIT | 4520 | 3485 | 4 | 3454 | 28 | 383 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 2 | HIT | 1999 | 3513 | 4 | 3454 | 56 | 418 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 3 | MISS | 2339 | 3541 | 4 | 0 | 3538 | 4426 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 4 | HIT | 2586 | 3569 | 4 | 3538 | 28 | 392 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 5 | HIT | 4933 | 3597 | 8 | 3594 | 0 | 362 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 6 | HIT | 2899 | 3625 | 8 | 3454 | 168 | 558 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 7 | HIT | 3679 | 3653 | 8 | 3650 | 0 | 368 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 8 | HIT | 3413 | 3681 | 8 | 3482 | 196 | 596 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 9 | HIT | 2638 | 3709 | 8 | 3678 | 28 | 406 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 10 | HIT | 3707 | 3737 | 8 | 3678 | 56 | 441 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 11 | MISS | 3021 | 3765 | 8 | 0 | 3762 | 4706 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 12 | HIT | 2361 | 3793 | 8 | 3706 | 84 | 479 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 13 | HIT | 3566 | 3821 | 8 | 3678 | 140 | 546 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 14 | HIT | 2656 | 3849 | 8 | 3818 | 28 | 420 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 15 | HIT | 3338 | 3877 | 8 | 3846 | 28 | 423 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 16 | HIT | 4760 | 3905 | 8 | 3762 | 140 | 554 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 17 | HIT | 2718 | 3933 | 8 | 3790 | 140 | 557 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 18 | HIT | 4513 | 3961 | 8 | 3874 | 84 | 495 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 19 | HIT | 4302 | 3989 | 8 | 3958 | 28 | 434 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 20 | HIT | 5205 | 4017 | 8 | 3930 | 84 | 501 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 21 | HIT | 4751 | 4045 | 8 | 4014 | 28 | 439 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 22 | HIT | 3418 | 4073 | 8 | 4042 | 28 | 442 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 23 | HIT | 3372 | 4101 | 8 | 3445 | 653 | 1164 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 24 | HIT | 4397 | 4129 | 8 | 4098 | 28 | 448 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 25 | HIT | 3810 | 4157 | 8 | 3986 | 168 | 612 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 26 | HIT | 4090 | 4185 | 8 | 4154 | 28 | 453 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 27 | HIT | 3745 | 4213 | 8 | 4182 | 28 | 456 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 28 | HIT | 4523 | 4241 | 8 | 4070 | 168 | 620 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 29 | HIT | 5948 | 4269 | 8 | 4238 | 28 | 462 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
| 30 | HIT | 3341 | 4297 | 8 | 4126 | 168 | 626 | `998ef4dd-d16a-429e-92e8-f77d5e4e30a7` |
