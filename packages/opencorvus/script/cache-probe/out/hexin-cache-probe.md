# Hexin gateway cache probe

- Endpoint: `https://aimemodeldev.myhexin.com/litellm/v1`
- Model: `gpt-5.4`
- Date: 2026-04-27T08:21:04.633Z
- Total calls: 55 (0 errors)

## Summary by probe/variant

| Probe              | Variant                | N   | avg prompt_tok | avg cached_tok | avg hit | errors |
| ------------------ | ---------------------- | --- | -------------: | -------------: | ------: | -----: |
| 0-response-cache   | fresh-nonce            | 4   |           4151 |           1984 |   47.8% |      0 |
| 0-response-cache   | same-body-repeat       | 2   |           4144 |              0 |    0.0% |      0 |
| 1-sticky           | with-sticky            | 4   |           4152 |           2976 |   71.7% |      0 |
| 2-no-sticky        | no-sticky              | 6   |           4153 |           3307 |   79.6% |      0 |
| 3-prefix-floor     | tokens-1024            | 3   |           1094 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-16384           | 3   |          16745 |          11008 |   65.7% |      0 |
| 3-prefix-floor     | tokens-256             | 3   |            294 |              0 |    0.0% |      0 |
| 3-prefix-floor     | tokens-4096            | 3   |           4277 |           2731 |   63.8% |      0 |
| 3-prefix-floor     | tokens-60000           | 3   |          61435 |          40875 |   66.5% |      0 |
| 4-sticky-isolation | key-alpha              | 3   |           4161 |           2645 |   63.6% |      0 |
| 4-sticky-isolation | key-beta               | 3   |           4161 |           2645 |   63.6% |      0 |
| 4-sticky-isolation | key-gamma              | 3   |           4162 |           3968 |   95.3% |      0 |
| 5-instability      | baseline               | 1   |           4152 |           3968 |   95.6% |      0 |
| 5-instability      | dynamic-timestamp      | 1   |           4164 |           3968 |   95.3% |      0 |
| 5-instability      | temperature-changed    | 1   |           4155 |           3968 |   95.5% |      0 |
| 5-instability      | trailing-newline       | 1   |           4155 |           3968 |   95.5% |      0 |
| 5-instability      | warmup-baseline        | 2   |           4154 |              0 |    0.0% |      0 |
| 5-instability      | with-tools-A           | 1   |           4272 |              0 |    0.0% |      0 |
| 5-instability      | with-tools-B-reordered | 1   |           4276 |           3968 |   92.8% |      0 |
| 7-tools-stable     | tool-desc-changed      | 1   |           4284 |           3968 |   92.6% |      0 |
| 7-tools-stable     | tools-expanded         | 1   |           4289 |           3968 |   92.5% |      0 |
| 7-tools-stable     | tools-reordered        | 1   |           4282 |           3968 |   92.7% |      0 |
| 7-tools-stable     | with-tools             | 4   |           4282 |           3168 |   74.0% |      0 |

## Per-call detail

| probe              | variant                | iter | status | prompt | cached |   hit | latency_ms | sticky                          | upstream |
| ------------------ | ---------------------- | ---: | -----: | -----: | -----: | ----: | ---------: | ------------------------------- | -------- |
| 0-response-cache   | same-body-repeat       |    0 |    200 |   4144 |      0 |  0.0% |       1471 | probe-respcache-1777277988449   | -        |
| 0-response-cache   | same-body-repeat       |    1 |    200 |   4144 |      0 |  0.0% |         68 | probe-respcache-1777277988449   | -        |
| 0-response-cache   | fresh-nonce            |    0 |    200 |   4151 |   3968 | 95.6% |       2107 | probe-respcache-1777277988449   | -        |
| 0-response-cache   | fresh-nonce            |    1 |    200 |   4149 |      0 |  0.0% |       1153 | probe-respcache-1777277988449   | -        |
| 0-response-cache   | fresh-nonce            |    2 |    200 |   4152 |   3968 | 95.6% |       3353 | probe-respcache-1777277988449   | -        |
| 0-response-cache   | fresh-nonce            |    3 |    200 |   4151 |      0 |  0.0% |       2003 | probe-respcache-1777277988449   | -        |
| 1-sticky           | with-sticky            |    0 |    200 |   4150 |      0 |  0.0% |       1087 | probe-sticky-1777277998607      | -        |
| 1-sticky           | with-sticky            |    1 |    200 |   4152 |   3968 | 95.6% |       1848 | probe-sticky-1777277998607      | -        |
| 1-sticky           | with-sticky            |    2 |    200 |   4152 |   3968 | 95.6% |       1182 | probe-sticky-1777277998607      | -        |
| 1-sticky           | with-sticky            |    3 |    200 |   4152 |   3968 | 95.6% |       1105 | probe-sticky-1777277998607      | -        |
| 2-no-sticky        | no-sticky              |    0 |    200 |   4152 |      0 |  0.0% |       1199 | -                               | -        |
| 2-no-sticky        | no-sticky              |    1 |    200 |   4151 |   3968 | 95.6% |       1497 | -                               | -        |
| 2-no-sticky        | no-sticky              |    2 |    200 |   4153 |   3968 | 95.5% |       1195 | -                               | -        |
| 2-no-sticky        | no-sticky              |    3 |    200 |   4152 |   3968 | 95.6% |       1006 | -                               | -        |
| 2-no-sticky        | no-sticky              |    4 |    200 |   4155 |   3968 | 95.5% |       1194 | -                               | -        |
| 2-no-sticky        | no-sticky              |    5 |    200 |   4152 |   3968 | 95.6% |       1199 | -                               | -        |
| 3-prefix-floor     | tokens-256             |    0 |    200 |    294 |      0 |  0.0% |        715 | probe-floor-256-1777278011126   | -        |
| 3-prefix-floor     | tokens-256             |    1 |    200 |    295 |      0 |  0.0% |        679 | probe-floor-256-1777278011126   | -        |
| 3-prefix-floor     | tokens-256             |    2 |    200 |    293 |      0 |  0.0% |        836 | probe-floor-256-1777278011126   | -        |
| 3-prefix-floor     | tokens-1024            |    0 |    200 |   1095 |      0 |  0.0% |       1493 | probe-floor-1024-1777278013356  | -        |
| 3-prefix-floor     | tokens-1024            |    1 |    200 |   1095 |      0 |  0.0% |       1036 | probe-floor-1024-1777278013356  | -        |
| 3-prefix-floor     | tokens-1024            |    2 |    200 |   1093 |      0 |  0.0% |       1164 | probe-floor-1024-1777278013356  | -        |
| 3-prefix-floor     | tokens-4096            |    0 |    200 |   4276 |      0 |  0.0% |       1574 | probe-floor-4096-1777278017050  | -        |
| 3-prefix-floor     | tokens-4096            |    1 |    200 |   4276 |   4096 | 95.8% |       1040 | probe-floor-4096-1777278017050  | -        |
| 3-prefix-floor     | tokens-4096            |    2 |    200 |   4278 |   4096 | 95.7% |       3286 | probe-floor-4096-1777278017050  | -        |
| 3-prefix-floor     | tokens-16384           |    0 |    200 |  16744 |      0 |  0.0% |       1960 | probe-floor-16384-1777278022956 | -        |
| 3-prefix-floor     | tokens-16384           |    1 |    200 |  16745 |  16512 | 98.6% |       1404 | probe-floor-16384-1777278022956 | -        |
| 3-prefix-floor     | tokens-16384           |    2 |    200 |  16745 |  16512 | 98.6% |       1344 | probe-floor-16384-1777278022956 | -        |
| 3-prefix-floor     | tokens-60000           |    0 |    200 |  61436 |      0 |  0.0% |       4157 | probe-floor-60000-1777278027700 | -        |
| 3-prefix-floor     | tokens-60000           |    1 |    200 |  61437 |  61312 | 99.8% |       2252 | probe-floor-60000-1777278027700 | -        |
| 3-prefix-floor     | tokens-60000           |    2 |    200 |  61433 |  61312 | 99.8% |       2202 | probe-floor-60000-1777278027700 | -        |
| 4-sticky-isolation | key-alpha              |    0 |    200 |   4162 |      0 |  0.0% |       1233 | probe-iso-alpha-1777278036317   | -        |
| 4-sticky-isolation | key-alpha              |    1 |    200 |   4160 |   3968 | 95.4% |       1137 | probe-iso-alpha-1777278036317   | -        |
| 4-sticky-isolation | key-alpha              |    2 |    200 |   4162 |   3968 | 95.3% |       1103 | probe-iso-alpha-1777278036317   | -        |
| 4-sticky-isolation | key-beta               |    0 |    200 |   4162 |      0 |  0.0% |       1068 | probe-iso-beta-1777278036317    | -        |
| 4-sticky-isolation | key-beta               |    1 |    200 |   4162 |   3968 | 95.3% |        978 | probe-iso-beta-1777278036317    | -        |
| 4-sticky-isolation | key-beta               |    2 |    200 |   4160 |   3968 | 95.4% |       1600 | probe-iso-beta-1777278036317    | -        |
| 4-sticky-isolation | key-gamma              |    0 |    200 |   4161 |   3968 | 95.4% |       1038 | probe-iso-gamma-1777278036317   | -        |
| 4-sticky-isolation | key-gamma              |    1 |    200 |   4161 |   3968 | 95.4% |       1000 | probe-iso-gamma-1777278036317   | -        |
| 4-sticky-isolation | key-gamma              |    2 |    200 |   4163 |   3968 | 95.3% |        992 | probe-iso-gamma-1777278036317   | -        |
| 5-instability      | warmup-baseline        |    0 |    200 |   4156 |      0 |  0.0% |       1232 | probe-instab-1777278046473      | -        |
| 5-instability      | warmup-baseline        |    1 |    200 |   4152 |      0 |  0.0% |       1930 | probe-instab-1777278046473      | -        |
| 5-instability      | baseline               |    0 |    200 |   4152 |   3968 | 95.6% |       1323 | probe-instab-1777278046473      | -        |
| 5-instability      | trailing-newline       |    0 |    200 |   4155 |   3968 | 95.5% |       1436 | probe-instab-1777278046473      | -        |
| 5-instability      | dynamic-timestamp      |    0 |    200 |   4164 |   3968 | 95.3% |       1051 | probe-instab-1777278046473      | -        |
| 5-instability      | temperature-changed    |    0 |    200 |   4155 |   3968 | 95.5% |       1091 | probe-instab-1777278046473      | -        |
| 5-instability      | with-tools-A           |    0 |    200 |   4272 |      0 |  0.0% |       1128 | probe-instab-1777278046473      | -        |
| 5-instability      | with-tools-B-reordered |    0 |    200 |   4276 |   3968 | 92.8% |       1046 | probe-instab-1777278046473      | -        |
| 7-tools-stable     | with-tools             |    0 |    200 |   4282 |      0 |  0.0% |       1067 | probe-tools-1777278056715       | -        |
| 7-tools-stable     | with-tools             |    1 |    200 |   4282 |   4224 | 98.6% |       1383 | probe-tools-1777278056715       | -        |
| 7-tools-stable     | with-tools             |    2 |    200 |   4281 |   4224 | 98.7% |       1029 | probe-tools-1777278056715       | -        |
| 7-tools-stable     | with-tools             |    3 |    200 |   4281 |   4224 | 98.7% |       1045 | probe-tools-1777278056715       | -        |
| 7-tools-stable     | tools-reordered        |    0 |    200 |   4282 |   3968 | 92.7% |       1161 | probe-tools-1777278056715       | -        |
| 7-tools-stable     | tools-expanded         |    0 |    200 |   4289 |   3968 | 92.5% |       1120 | probe-tools-1777278056715       | -        |
| 7-tools-stable     | tool-desc-changed      |    0 |    200 |   4284 |   3968 | 92.6% |       1098 | probe-tools-1777278056715       | -        |
