# Hexin gateway cache probe

- Endpoint: `https://aimemodeldev.myhexin.com/litellm/v1`
- Model: `claude-sonnet-4-6`
- Date: 2026-04-27T08:38:34.805Z
- Total calls: 55 (0 errors)

## Summary by probe/variant

| Probe              | Variant                | N   | avg prompt_tok | avg cached_tok | avg hit | errors |
| ------------------ | ---------------------- | --- | -------------: | -------------: | ------: | -----: |
| 0-response-cache   | fresh-nonce            | 4   |           4721 |              0 |    0.0% |      0 |
| 0-response-cache   | same-body-repeat       | 2   |           4711 |              0 |    0.0% |      0 |
| 1-sticky           | with-sticky            | 4   |           4614 |              0 |    0.0% |      0 |
| 2-no-sticky        | no-sticky              | 6   |           4650 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-1024            | 3   |           1238 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-16384           | 3   |          18988 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-256             | 3   |            329 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-4096            | 3   |           4833 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-60000           | 3   |          69360 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-alpha              | 3   |           4731 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-beta               | 3   |           4731 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-gamma              | 3   |           4731 |           1563 |   16.6% |      0 |
| 5-instability      | baseline               | 1   |           4722 |              0 |    0.0% |      0 |
| 5-instability      | dynamic-timestamp      | 1   |           4732 |              0 |    0.0% |      0 |
| 5-instability      | temperature-changed    | 1   |           4723 |              0 |    0.0% |      0 |
| 5-instability      | trailing-newline       | 1   |           4723 |              0 |    0.0% |      0 |
| 5-instability      | warmup-baseline        | 2   |           4722 |              0 |    0.0% |      0 |
| 5-instability      | with-tools-A           | 1   |           5297 |              0 |    0.0% |      0 |
| 5-instability      | with-tools-B-reordered | 1   |           5302 |              0 |    0.0% |      0 |
| 7-tools-stable     | tool-desc-changed      | 1   |           5317 |              0 |    0.0% |      0 |
| 7-tools-stable     | tools-expanded         | 1   |           5350 |              0 |    0.0% |      0 |
| 7-tools-stable     | tools-reordered        | 1   |           5315 |              0 |    0.0% |      0 |
| 7-tools-stable     | with-tools             | 4   |           5312 |              0 |    0.0% |      0 |

## Per-call detail

| probe              | variant                | iter | status | prompt | cached |   hit | latency_ms | sticky                          | upstream                             |
| ------------------ | ---------------------- | ---: | -----: | -----: | -----: | ----: | ---------: | ------------------------------- | ------------------------------------ |
| 0-response-cache   | same-body-repeat       |    0 |    200 |   4711 |      0 |  0.0% |       2583 | probe-respcache-1777278790130   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache   | same-body-repeat       |    1 |    200 |   4711 |      0 |  0.0% |         89 | probe-respcache-1777278790130   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache   | fresh-nonce            |    0 |    200 |   4721 |      0 |  0.0% |       2311 | probe-respcache-1777278790130   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache   | fresh-nonce            |    1 |    200 |   4721 |      0 |  0.0% |       4378 | probe-respcache-1777278790130   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache   | fresh-nonce            |    2 |    200 |   4721 |      0 |  0.0% |       3332 | probe-respcache-1777278790130   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache   | fresh-nonce            |    3 |    200 |   4722 |      0 |  0.0% |       2255 | probe-respcache-1777278790130   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 1-sticky           | with-sticky            |    0 |    200 |   4721 |      0 |  0.0% |       2940 | probe-sticky-1777278805083      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 1-sticky           | with-sticky            |    1 |    200 |   4295 |      0 |  0.0% |      53481 | probe-sticky-1777278805083      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 1-sticky           | with-sticky            |    2 |    200 |   4720 |      0 |  0.0% |       3704 | probe-sticky-1777278805083      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 1-sticky           | with-sticky            |    3 |    200 |   4719 |      0 |  0.0% |       2828 | probe-sticky-1777278805083      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky        | no-sticky              |    0 |    200 |   4720 |      0 |  0.0% |       2626 | -                               | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky        | no-sticky              |    1 |    200 |   4295 |      0 |  0.0% |      77238 | -                               | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky        | no-sticky              |    2 |    200 |   4722 |      0 |  0.0% |       2826 | -                               | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky        | no-sticky              |    3 |    200 |   4722 |      0 |  0.0% |       2489 | -                               | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky        | no-sticky              |    4 |    200 |   4720 |      0 |  0.0% |       1877 | -                               | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky        | no-sticky              |    5 |    200 |   4721 |      0 |  0.0% |       2264 | -                               | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-256             |    0 |    200 |    328 |      0 |  0.0% |       1961 | probe-floor-256-1777278957364   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-256             |    1 |    200 |    329 |      0 |  0.0% |       1572 | probe-floor-256-1777278957364   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-256             |    2 |    200 |    330 |      0 |  0.0% |       2086 | probe-floor-256-1777278957364   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-1024            |    0 |    200 |   1239 |      0 |  0.0% |       1603 | probe-floor-1024-1777278962982  | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-1024            |    1 |    200 |   1237 |      0 |  0.0% |       2062 | probe-floor-1024-1777278962982  | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-1024            |    2 |    200 |   1238 |      0 |  0.0% |       1884 | probe-floor-1024-1777278962982  | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-4096            |    0 |    200 |   4833 |      0 |  0.0% |       3287 | probe-floor-4096-1777278968532  | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-4096            |    1 |    200 |   4833 |      0 |  0.0% |       2532 | probe-floor-4096-1777278968532  | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-4096            |    2 |    200 |   4832 |      0 |  0.0% |       2791 | probe-floor-4096-1777278968532  | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-16384           |    0 |    200 |  18989 |      0 |  0.0% |       2792 | probe-floor-16384-1777278977147 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-16384           |    1 |    200 |  18987 |      0 |  0.0% |       3318 | probe-floor-16384-1777278977147 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-16384           |    2 |    200 |  18989 |      0 |  0.0% |       2770 | probe-floor-16384-1777278977147 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-60000           |    0 |    200 |  69361 |      0 |  0.0% |       4957 | probe-floor-60000-1777278986065 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-60000           |    1 |    200 |  69360 |      0 |  0.0% |       5217 | probe-floor-60000-1777278986065 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor     | tokens-60000           |    2 |    200 |  69359 |      0 |  0.0% |       5618 | probe-floor-60000-1777278986065 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-alpha              |    0 |    200 |   4731 |      0 |  0.0% |       3101 | probe-iso-alpha-1777279001862   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-alpha              |    1 |    200 |   4729 |      0 |  0.0% |      12026 | probe-iso-alpha-1777279001862   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-alpha              |    2 |    200 |   4732 |      0 |  0.0% |       2243 | probe-iso-alpha-1777279001862   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-beta               |    0 |    200 |   4732 |      0 |  0.0% |       2207 | probe-iso-beta-1777279001862    | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-beta               |    1 |    200 |   4730 |      0 |  0.0% |       2348 | probe-iso-beta-1777279001862    | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-beta               |    2 |    200 |   4731 |      0 |  0.0% |       2363 | probe-iso-beta-1777279001862    | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-gamma              |    0 |    200 |   4730 |      0 |  0.0% |       4607 | probe-iso-gamma-1777279001862   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-gamma              |    1 |    200 |   4732 |      0 |  0.0% |       2305 | probe-iso-gamma-1777279001862   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-gamma              |    2 |    200 |   4730 |   4688 | 49.8% |       2878 | probe-iso-gamma-1777279001862   | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability      | warmup-baseline        |    0 |    200 |   4721 |      0 |  0.0% |       3053 | probe-instab-1777279035947      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability      | warmup-baseline        |    1 |    200 |   4722 |      0 |  0.0% |       2115 | probe-instab-1777279035947      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability      | baseline               |    0 |    200 |   4722 |      0 |  0.0% |       2153 | probe-instab-1777279035947      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability      | trailing-newline       |    0 |    200 |   4723 |      0 |  0.0% |       2007 | probe-instab-1777279035947      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability      | dynamic-timestamp      |    0 |    200 |   4732 |      0 |  0.0% |       2752 | probe-instab-1777279035947      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability      | temperature-changed    |    0 |    200 |   4723 |      0 |  0.0% |       1856 | probe-instab-1777279035947      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability      | with-tools-A           |    0 |    200 |   5297 |      0 |  0.0% |       2312 | probe-instab-1777279035947      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability      | with-tools-B-reordered |    0 |    200 |   5302 |      0 |  0.0% |       2371 | probe-instab-1777279035947      | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable     | with-tools             |    0 |    200 |   5312 |      0 |  0.0% |       2287 | probe-tools-1777279054571       | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable     | with-tools             |    1 |    200 |   5312 |      0 |  0.0% |      46199 | probe-tools-1777279054571       | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable     | with-tools             |    2 |    200 |   5312 |      0 |  0.0% |       2567 | probe-tools-1777279054571       | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable     | with-tools             |    3 |    200 |   5313 |      0 |  0.0% |       2639 | probe-tools-1777279054571       | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable     | tools-reordered        |    0 |    200 |   5315 |      0 |  0.0% |       2538 | probe-tools-1777279054571       | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable     | tools-expanded         |    0 |    200 |   5350 |      0 |  0.0% |       1926 | probe-tools-1777279054571       | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable     | tool-desc-changed      |    0 |    200 |   5317 |      0 |  0.0% |       2049 | probe-tools-1777279054571       | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
