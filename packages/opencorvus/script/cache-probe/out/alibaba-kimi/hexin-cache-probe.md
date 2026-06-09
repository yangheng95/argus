# Hexin gateway cache probe

- Endpoint: `https://coding.dashscope.aliyuncs.com/v1`
- Model: `kimi-k2.5`
- Date: 2026-04-27T08:49:47.468Z
- Total calls: 55 (0 errors)

## Summary by probe/variant

| Probe              | Variant                | N   | avg prompt_tok | avg cached_tok | avg hit | errors |
| ------------------ | ---------------------- | --- | -------------: | -------------: | ------: | -----: |
| 0-response-cache   | fresh-nonce            | 4   |           4081 |              0 |    0.0% |      0 |
| 0-response-cache   | same-body-repeat       | 2   |           4074 |              0 |    0.0% |      0 |
| 1-sticky           | with-sticky            | 4   |           4081 |              0 |    0.0% |      0 |
| 2-no-sticky        | no-sticky              | 6   |           4082 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-1024            | 3   |           1080 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-16384           | 3   |          16464 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-256             | 3   |            292 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-4096            | 3   |           4207 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-60000           | 3   |          60410 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-alpha              | 3   |           4091 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-beta               | 3   |           4089 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-gamma              | 3   |           4091 |              0 |    0.0% |      0 |
| 5-instability      | baseline               | 1   |           4079 |              0 |    0.0% |      0 |
| 5-instability      | dynamic-timestamp      | 1   |           4090 |              0 |    0.0% |      0 |
| 5-instability      | temperature-changed    | 1   |           4082 |              0 |    0.0% |      0 |
| 5-instability      | trailing-newline       | 1   |           4083 |              0 |    0.0% |      0 |
| 5-instability      | warmup-baseline        | 2   |           4083 |              0 |    0.0% |      0 |
| 5-instability      | with-tools-A           | 1   |           4124 |              0 |    0.0% |      0 |
| 5-instability      | with-tools-B-reordered | 1   |           4127 |              0 |    0.0% |      0 |
| 7-tools-stable     | tool-desc-changed      | 1   |           4135 |              0 |    0.0% |      0 |
| 7-tools-stable     | tools-expanded         | 1   |           4146 |              0 |    0.0% |      0 |
| 7-tools-stable     | tools-reordered        | 1   |           4136 |              0 |    0.0% |      0 |
| 7-tools-stable     | with-tools             | 4   |           4135 |              0 |    0.0% |      0 |

## Per-call detail

| probe              | variant                | iter | status | prompt | cached |  hit | latency_ms | sticky                          | upstream |
| ------------------ | ---------------------- | ---: | -----: | -----: | -----: | ---: | ---------: | ------------------------------- | -------- |
| 0-response-cache   | same-body-repeat       |    0 |    200 |   4074 |      0 | 0.0% |       5994 | probe-respcache-1777279619961   | -        |
| 0-response-cache   | same-body-repeat       |    1 |    200 |   4074 |      0 | 0.0% |        875 | probe-respcache-1777279619961   | -        |
| 0-response-cache   | fresh-nonce            |    0 |    200 |   4082 |      0 | 0.0% |       3321 | probe-respcache-1777279619961   | -        |
| 0-response-cache   | fresh-nonce            |    1 |    200 |   4081 |      0 | 0.0% |       2757 | probe-respcache-1777279619961   | -        |
| 0-response-cache   | fresh-nonce            |    2 |    200 |   4080 |      0 | 0.0% |       1020 | probe-respcache-1777279619961   | -        |
| 0-response-cache   | fresh-nonce            |    3 |    200 |   4080 |      0 | 0.0% |       1226 | probe-respcache-1777279619961   | -        |
| 1-sticky           | with-sticky            |    0 |    200 |   4082 |      0 | 0.0% |       2065 | probe-sticky-1777279635160      | -        |
| 1-sticky           | with-sticky            |    1 |    200 |   4081 |      0 | 0.0% |        761 | probe-sticky-1777279635160      | -        |
| 1-sticky           | with-sticky            |    2 |    200 |   4080 |      0 | 0.0% |       3012 | probe-sticky-1777279635160      | -        |
| 1-sticky           | with-sticky            |    3 |    200 |   4081 |      0 | 0.0% |       2588 | probe-sticky-1777279635160      | -        |
| 2-no-sticky        | no-sticky              |    0 |    200 |   4081 |      0 | 0.0% |       1956 | -                               | -        |
| 2-no-sticky        | no-sticky              |    1 |    200 |   4080 |      0 | 0.0% |       3161 | -                               | -        |
| 2-no-sticky        | no-sticky              |    2 |    200 |   4081 |      0 | 0.0% |       2531 | -                               | -        |
| 2-no-sticky        | no-sticky              |    3 |    200 |   4082 |      0 | 0.0% |       4572 | -                               | -        |
| 2-no-sticky        | no-sticky              |    4 |    200 |   4082 |      0 | 0.0% |       1299 | -                               | -        |
| 2-no-sticky        | no-sticky              |    5 |    200 |   4083 |      0 | 0.0% |       2665 | -                               | -        |
| 3-prefix-floor     | tokens-256             |    0 |    200 |    291 |      0 | 0.0% |       1430 | probe-floor-256-1777279659780   | -        |
| 3-prefix-floor     | tokens-256             |    1 |    200 |    293 |      0 | 0.0% |        656 | probe-floor-256-1777279659780   | -        |
| 3-prefix-floor     | tokens-256             |    2 |    200 |    292 |      0 | 0.0% |       1168 | probe-floor-256-1777279659780   | -        |
| 3-prefix-floor     | tokens-1024            |    0 |    200 |   1080 |      0 | 0.0% |       1709 | probe-floor-1024-1777279663035  | -        |
| 3-prefix-floor     | tokens-1024            |    1 |    200 |   1080 |      0 | 0.0% |        827 | probe-floor-1024-1777279663035  | -        |
| 3-prefix-floor     | tokens-1024            |    2 |    200 |   1079 |      0 | 0.0% |       6866 | probe-floor-1024-1777279663035  | -        |
| 3-prefix-floor     | tokens-4096            |    0 |    200 |   4206 |      0 | 0.0% |       1043 | probe-floor-4096-1777279672437  | -        |
| 3-prefix-floor     | tokens-4096            |    1 |    200 |   4207 |      0 | 0.0% |       2536 | probe-floor-4096-1777279672437  | -        |
| 3-prefix-floor     | tokens-4096            |    2 |    200 |   4208 |      0 | 0.0% |       1163 | probe-floor-4096-1777279672437  | -        |
| 3-prefix-floor     | tokens-16384           |    0 |    200 |  16463 |      0 | 0.0% |       7090 | probe-floor-16384-1777279677186 | -        |
| 3-prefix-floor     | tokens-16384           |    1 |    200 |  16465 |      0 | 0.0% |       6840 | probe-floor-16384-1777279677186 | -        |
| 3-prefix-floor     | tokens-16384           |    2 |    200 |  16463 |      0 | 0.0% |       2254 | probe-floor-16384-1777279677186 | -        |
| 3-prefix-floor     | tokens-60000           |    0 |    200 |  60410 |      0 | 0.0% |       8184 | probe-floor-60000-1777279693408 | -        |
| 3-prefix-floor     | tokens-60000           |    1 |    200 |  60411 |      0 | 0.0% |      12308 | probe-floor-60000-1777279693408 | -        |
| 3-prefix-floor     | tokens-60000           |    2 |    200 |  60409 |      0 | 0.0% |       5400 | probe-floor-60000-1777279693408 | -        |
| 4-sticky-isolation | key-alpha              |    0 |    200 |   4091 |      0 | 0.0% |       1175 | probe-iso-alpha-1777279719305   | -        |
| 4-sticky-isolation | key-alpha              |    1 |    200 |   4091 |      0 | 0.0% |       8507 | probe-iso-alpha-1777279719305   | -        |
| 4-sticky-isolation | key-alpha              |    2 |    200 |   4090 |      0 | 0.0% |       2469 | probe-iso-alpha-1777279719305   | -        |
| 4-sticky-isolation | key-beta               |    0 |    200 |   4089 |      0 | 0.0% |       1483 | probe-iso-beta-1777279719305    | -        |
| 4-sticky-isolation | key-beta               |    1 |    200 |   4090 |      0 | 0.0% |       1926 | probe-iso-beta-1777279719305    | -        |
| 4-sticky-isolation | key-beta               |    2 |    200 |   4089 |      0 | 0.0% |       1439 | probe-iso-beta-1777279719305    | -        |
| 4-sticky-isolation | key-gamma              |    0 |    200 |   4090 |      0 | 0.0% |       2363 | probe-iso-gamma-1777279719305   | -        |
| 4-sticky-isolation | key-gamma              |    1 |    200 |   4092 |      0 | 0.0% |       3453 | probe-iso-gamma-1777279719305   | -        |
| 4-sticky-isolation | key-gamma              |    2 |    200 |   4091 |      0 | 0.0% |       1465 | probe-iso-gamma-1777279719305   | -        |
| 5-instability      | warmup-baseline        |    0 |    200 |   4082 |      0 | 0.0% |       2899 | probe-instab-1777279743591      | -        |
| 5-instability      | warmup-baseline        |    1 |    200 |   4083 |      0 | 0.0% |       5996 | probe-instab-1777279743591      | -        |
| 5-instability      | baseline               |    0 |    200 |   4079 |      0 | 0.0% |        975 | probe-instab-1777279743591      | -        |
| 5-instability      | trailing-newline       |    0 |    200 |   4083 |      0 | 0.0% |       2822 | probe-instab-1777279743591      | -        |
| 5-instability      | dynamic-timestamp      |    0 |    200 |   4090 |      0 | 0.0% |        903 | probe-instab-1777279743591      | -        |
| 5-instability      | temperature-changed    |    0 |    200 |   4082 |      0 | 0.0% |       1065 | probe-instab-1777279743591      | -        |
| 5-instability      | with-tools-A           |    0 |    200 |   4124 |      0 | 0.0% |       2150 | probe-instab-1777279743591      | -        |
| 5-instability      | with-tools-B-reordered |    0 |    200 |   4127 |      0 | 0.0% |       1494 | probe-instab-1777279743591      | -        |
| 7-tools-stable     | with-tools             |    0 |    200 |   4135 |      0 | 0.0% |      13345 | probe-tools-1777279761901       | -        |
| 7-tools-stable     | with-tools             |    1 |    200 |   4134 |      0 | 0.0% |       1315 | probe-tools-1777279761901       | -        |
| 7-tools-stable     | with-tools             |    2 |    200 |   4133 |      0 | 0.0% |       2291 | probe-tools-1777279761901       | -        |
| 7-tools-stable     | with-tools             |    3 |    200 |   4136 |      0 | 0.0% |        994 | probe-tools-1777279761901       | -        |
| 7-tools-stable     | tools-reordered        |    0 |    200 |   4136 |      0 | 0.0% |       1098 | probe-tools-1777279761901       | -        |
| 7-tools-stable     | tools-expanded         |    0 |    200 |   4146 |      0 | 0.0% |       5017 | probe-tools-1777279761901       | -        |
| 7-tools-stable     | tool-desc-changed      |    0 |    200 |   4135 |      0 | 0.0% |       1491 | probe-tools-1777279761901       | -        |
