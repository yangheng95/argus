# Hexin gateway cache probe

- Endpoint: `https://aimemodeldev.myhexin.com/litellm/v1`
- Model: `claude-sonnet-4-6`
- Date: 2026-04-27T08:28:07.063Z
- Total calls: 55 (0 errors)

## Summary by probe/variant

| Probe              | Variant                | N   | avg prompt_tok | avg cached_tok | avg hit | errors |
| ------------------ | ---------------------- | --- | -------------: | -------------: | ------: | -----: |
| 0-response-cache   | fresh-nonce            | 4   |           4720 |              0 |    0.0% |      0 |
| 0-response-cache   | same-body-repeat       | 2   |           4711 |              0 |    0.0% |      0 |
| 1-sticky           | with-sticky            | 4   |           4721 |              0 |    0.0% |      0 |
| 2-no-sticky        | no-sticky              | 6   |           4722 |           1563 |   16.6% |      0 |
| 3-prefix-floor     | tokens-1024            | 3   |           1240 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-16384           | 3   |          18988 |           6318 |   16.7% |      0 |
| 3-prefix-floor     | tokens-256             | 3   |            314 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-4096            | 3   |           4832 |           1599 |   16.6% |      0 |
| 3-prefix-floor     | tokens-60000           | 3   |          69357 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-alpha              | 3   |           4729 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-beta               | 3   |           4730 |              0 |    0.0% |      0 |
| 4-sticky-isolation | key-gamma              | 3   |           4731 |              0 |    0.0% |      0 |
| 5-instability      | baseline               | 1   |           4722 |              0 |    0.0% |      0 |
| 5-instability      | dynamic-timestamp      | 1   |           4733 |              0 |    0.0% |      0 |
| 5-instability      | temperature-changed    | 1   |           4724 |              0 |    0.0% |      0 |
| 5-instability      | trailing-newline       | 1   |           4726 |              0 |    0.0% |      0 |
| 5-instability      | warmup-baseline        | 2   |           4722 |              0 |    0.0% |      0 |
| 5-instability      | with-tools-A           | 1   |           5299 |              0 |    0.0% |      0 |
| 5-instability      | with-tools-B-reordered | 1   |           5302 |              0 |    0.0% |      0 |
| 7-tools-stable     | tool-desc-changed      | 1   |           5314 |              0 |    0.0% |      0 |
| 7-tools-stable     | tools-expanded         | 1   |           5348 |              0 |    0.0% |      0 |
| 7-tools-stable     | tools-reordered        | 1   |           5314 |              0 |    0.0% |      0 |
| 7-tools-stable     | with-tools             | 4   |           5313 |           1241 |   12.1% |      0 |

## Per-call detail

| probe              | variant                | iter | status | prompt | cached |   hit | latency_ms | sticky                          | upstream |
| ------------------ | ---------------------- | ---: | -----: | -----: | -----: | ----: | ---------: | ------------------------------- | -------- |
| 0-response-cache   | same-body-repeat       |    0 |    200 |   4711 |      0 |  0.0% |       2428 | probe-respcache-1777278326378   | -        |
| 0-response-cache   | same-body-repeat       |    1 |    200 |   4711 |      0 |  0.0% |         78 | probe-respcache-1777278326378   | -        |
| 0-response-cache   | fresh-nonce            |    0 |    200 |   4719 |      0 |  0.0% |       2183 | probe-respcache-1777278326378   | -        |
| 0-response-cache   | fresh-nonce            |    1 |    200 |   4720 |      0 |  0.0% |       2050 | probe-respcache-1777278326378   | -        |
| 0-response-cache   | fresh-nonce            |    2 |    200 |   4721 |      0 |  0.0% |       2371 | probe-respcache-1777278326378   | -        |
| 0-response-cache   | fresh-nonce            |    3 |    200 |   4718 |      0 |  0.0% |       2535 | probe-respcache-1777278326378   | -        |
| 1-sticky           | with-sticky            |    0 |    200 |   4721 |      0 |  0.0% |       2424 | probe-sticky-1777278338028      | -        |
| 1-sticky           | with-sticky            |    1 |    200 |   4720 |      0 |  0.0% |       2089 | probe-sticky-1777278338028      | -        |
| 1-sticky           | with-sticky            |    2 |    200 |   4720 |      0 |  0.0% |       2248 | probe-sticky-1777278338028      | -        |
| 1-sticky           | with-sticky            |    3 |    200 |   4721 |      0 |  0.0% |       2498 | probe-sticky-1777278338028      | -        |
| 2-no-sticky        | no-sticky              |    0 |    200 |   4721 |      0 |  0.0% |       1839 | -                               | -        |
| 2-no-sticky        | no-sticky              |    1 |    200 |   4721 |      0 |  0.0% |       2782 | -                               | -        |
| 2-no-sticky        | no-sticky              |    2 |    200 |   4720 |      0 |  0.0% |       2029 | -                               | -        |
| 2-no-sticky        | no-sticky              |    3 |    200 |   4723 |   4688 | 49.8% |       2524 | -                               | -        |
| 2-no-sticky        | no-sticky              |    4 |    200 |   4724 |   4688 | 49.8% |       2583 | -                               | -        |
| 2-no-sticky        | no-sticky              |    5 |    200 |   4722 |      0 |  0.0% |       1866 | -                               | -        |
| 3-prefix-floor     | tokens-256             |    0 |    200 |    331 |      0 |  0.0% |       3618 | probe-floor-256-1777278360918   | -        |
| 3-prefix-floor     | tokens-256             |    1 |    200 |    328 |      0 |  0.0% |       1648 | probe-floor-256-1777278360918   | -        |
| 3-prefix-floor     | tokens-256             |    2 |    200 |    283 |      0 |  0.0% |      16847 | probe-floor-256-1777278360918   | -        |
| 3-prefix-floor     | tokens-1024            |    0 |    200 |   1239 |      0 |  0.0% |       2558 | probe-floor-1024-1777278383031  | -        |
| 3-prefix-floor     | tokens-1024            |    1 |    200 |   1241 |      0 |  0.0% |       1898 | probe-floor-1024-1777278383031  | -        |
| 3-prefix-floor     | tokens-1024            |    2 |    200 |   1240 |      0 |  0.0% |       2328 | probe-floor-1024-1777278383031  | -        |
| 3-prefix-floor     | tokens-4096            |    0 |    200 |   4833 |      0 |  0.0% |       2360 | probe-floor-4096-1777278389817  | -        |
| 3-prefix-floor     | tokens-4096            |    1 |    200 |   4832 |      0 |  0.0% |       2901 | probe-floor-4096-1777278389817  | -        |
| 3-prefix-floor     | tokens-4096            |    2 |    200 |   4832 |   4798 | 49.8% |       2414 | probe-floor-4096-1777278389817  | -        |
| 3-prefix-floor     | tokens-16384           |    0 |    200 |  18988 |      0 |  0.0% |       3217 | probe-floor-16384-1777278397498 | -        |
| 3-prefix-floor     | tokens-16384           |    1 |    200 |  18988 |      0 |  0.0% |       2409 | probe-floor-16384-1777278397498 | -        |
| 3-prefix-floor     | tokens-16384           |    2 |    200 |  18988 |  18953 | 50.0% |       3151 | probe-floor-16384-1777278397498 | -        |
| 3-prefix-floor     | tokens-60000           |    0 |    200 |  69358 |      0 |  0.0% |       4774 | probe-floor-60000-1777278406312 | -        |
| 3-prefix-floor     | tokens-60000           |    1 |    200 |  69357 |      0 |  0.0% |       4842 | probe-floor-60000-1777278406312 | -        |
| 3-prefix-floor     | tokens-60000           |    2 |    200 |  69357 |      0 |  0.0% |       5589 | probe-floor-60000-1777278406312 | -        |
| 4-sticky-isolation | key-alpha              |    0 |    200 |   4729 |      0 |  0.0% |       2192 | probe-iso-alpha-1777278421522   | -        |
| 4-sticky-isolation | key-alpha              |    1 |    200 |   4728 |      0 |  0.0% |       3397 | probe-iso-alpha-1777278421522   | -        |
| 4-sticky-isolation | key-alpha              |    2 |    200 |   4730 |      0 |  0.0% |       2237 | probe-iso-alpha-1777278421522   | -        |
| 4-sticky-isolation | key-beta               |    0 |    200 |   4730 |      0 |  0.0% |       2214 | probe-iso-beta-1777278421522    | -        |
| 4-sticky-isolation | key-beta               |    1 |    200 |   4730 |      0 |  0.0% |       3001 | probe-iso-beta-1777278421522    | -        |
| 4-sticky-isolation | key-beta               |    2 |    200 |   4730 |      0 |  0.0% |       2712 | probe-iso-beta-1777278421522    | -        |
| 4-sticky-isolation | key-gamma              |    0 |    200 |   4731 |      0 |  0.0% |       3427 | probe-iso-gamma-1777278421522   | -        |
| 4-sticky-isolation | key-gamma              |    1 |    200 |   4731 |      0 |  0.0% |       2145 | probe-iso-gamma-1777278421522   | -        |
| 4-sticky-isolation | key-gamma              |    2 |    200 |   4730 |      0 |  0.0% |       2266 | probe-iso-gamma-1777278421522   | -        |
| 5-instability      | warmup-baseline        |    0 |    200 |   4722 |      0 |  0.0% |       1847 | probe-instab-1777278445119      | -        |
| 5-instability      | warmup-baseline        |    1 |    200 |   4722 |      0 |  0.0% |       3067 | probe-instab-1777278445119      | -        |
| 5-instability      | baseline               |    0 |    200 |   4722 |      0 |  0.0% |       2321 | probe-instab-1777278445119      | -        |
| 5-instability      | trailing-newline       |    0 |    200 |   4726 |      0 |  0.0% |       2296 | probe-instab-1777278445119      | -        |
| 5-instability      | dynamic-timestamp      |    0 |    200 |   4733 |      0 |  0.0% |       3003 | probe-instab-1777278445119      | -        |
| 5-instability      | temperature-changed    |    0 |    200 |   4724 |      0 |  0.0% |       2404 | probe-instab-1777278445119      | -        |
| 5-instability      | with-tools-A           |    0 |    200 |   5299 |      0 |  0.0% |       2167 | probe-instab-1777278445119      | -        |
| 5-instability      | with-tools-B-reordered |    0 |    200 |   5302 |      0 |  0.0% |       2141 | probe-instab-1777278445119      | -        |
| 7-tools-stable     | with-tools             |    0 |    200 |   5313 |      0 |  0.0% |       6030 | probe-tools-1777278464372       | -        |
| 7-tools-stable     | with-tools             |    1 |    200 |   5314 |      0 |  0.0% |       2022 | probe-tools-1777278464372       | -        |
| 7-tools-stable     | with-tools             |    2 |    200 |   5313 |      0 |  0.0% |       2237 | probe-tools-1777278464372       | -        |
| 7-tools-stable     | with-tools             |    3 |    200 |   5313 |   4964 | 48.3% |       5411 | probe-tools-1777278464372       | -        |
| 7-tools-stable     | tools-reordered        |    0 |    200 |   5314 |      0 |  0.0% |       2424 | probe-tools-1777278464372       | -        |
| 7-tools-stable     | tools-expanded         |    0 |    200 |   5348 |      0 |  0.0% |       2067 | probe-tools-1777278464372       | -        |
| 7-tools-stable     | tool-desc-changed      |    0 |    200 |   5314 |      0 |  0.0% |       2484 | probe-tools-1777278464372       | -        |
