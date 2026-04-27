# Hexin gateway cache probe

- Endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1`
- Model: `gpt-5.4`
- Date: 2026-04-26T16:59:34.817Z
- Total calls: 55 (0 errors)

## Summary by probe/variant

| Probe | Variant | N | avg prompt_tok | avg cached_tok | avg hit | errors |
|-------|---------|---|---------------:|---------------:|--------:|-------:|
| 0-response-cache | fresh-nonce | 4 | 4151 | 3968 | 95.6% | 0 |
| 0-response-cache | same-body-repeat | 2 | 4144 | 3968 | 95.8% | 0 |
| 1-sticky | with-sticky | 4 | 4151 | 3968 | 95.6% | 0 |
| 2-no-sticky | no-sticky | 6 | 4154 | 2645 | 63.7% | 0 |
| 3-prefix-floor | tokens-1024 | 3 | 1096 | 0 | 0.0% | 0 |
| 3-prefix-floor | tokens-16384 | 3 | 16746 | 16512 | 98.6% | 0 |
| 3-prefix-floor | tokens-256 | 3 | 294 | 0 | 0.0% | 0 |
| 3-prefix-floor | tokens-4096 | 3 | 4277 | 4096 | 95.8% | 0 |
| 3-prefix-floor | tokens-60000 | 3 | 61435 | 61312 | 99.8% | 0 |
| 4-sticky-isolation | key-alpha | 3 | 4160 | 3968 | 95.4% | 0 |
| 4-sticky-isolation | key-beta | 3 | 4161 | 3968 | 95.4% | 0 |
| 4-sticky-isolation | key-gamma | 3 | 4163 | 3968 | 95.3% | 0 |
| 5-instability | baseline | 1 | 4152 | 3968 | 95.6% | 0 |
| 5-instability | dynamic-timestamp | 1 | 4162 | 3968 | 95.3% | 0 |
| 5-instability | temperature-changed | 1 | 4152 | 3968 | 95.6% | 0 |
| 5-instability | trailing-newline | 1 | 4155 | 3968 | 95.5% | 0 |
| 5-instability | warmup-baseline | 2 | 4152 | 3968 | 95.6% | 0 |
| 5-instability | with-tools-A | 1 | 4271 | 4224 | 98.9% | 0 |
| 5-instability | with-tools-B-reordered | 1 | 4274 | 4224 | 98.8% | 0 |
| 7-tools-stable | tool-desc-changed | 1 | 4283 | 4224 | 98.6% | 0 |
| 7-tools-stable | tools-expanded | 1 | 4290 | 4224 | 98.5% | 0 |
| 7-tools-stable | tools-reordered | 1 | 4283 | 4224 | 98.6% | 0 |
| 7-tools-stable | with-tools | 4 | 4281 | 4224 | 98.7% | 0 |

## Per-call detail

| probe | variant | iter | status | prompt | cached | hit | latency_ms | sticky | upstream |
|-------|---------|-----:|-------:|-------:|-------:|----:|-----------:|--------|----------|
| 0-response-cache | same-body-repeat | 0 | 200 | 4144 | 3968 | 95.8% | 1817 | probe-respcache-1777222712577 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 0-response-cache | same-body-repeat | 1 | 200 | 4144 | 3968 | 95.8% | 40 | probe-respcache-1777222712577 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 0-response-cache | fresh-nonce | 0 | 200 | 4151 | 3968 | 95.6% | 981 | probe-respcache-1777222712577 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 0-response-cache | fresh-nonce | 1 | 200 | 4152 | 3968 | 95.6% | 959 | probe-respcache-1777222712577 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 0-response-cache | fresh-nonce | 2 | 200 | 4152 | 3968 | 95.6% | 938 | probe-respcache-1777222712577 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 0-response-cache | fresh-nonce | 3 | 200 | 4150 | 3968 | 95.6% | 1073 | probe-respcache-1777222712577 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 1-sticky | with-sticky | 0 | 200 | 4152 | 3968 | 95.6% | 1281 | probe-sticky-1777222718390 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 1-sticky | with-sticky | 1 | 200 | 4150 | 3968 | 95.6% | 1018 | probe-sticky-1777222718390 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 1-sticky | with-sticky | 2 | 200 | 4152 | 3968 | 95.6% | 923 | probe-sticky-1777222718390 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 1-sticky | with-sticky | 3 | 200 | 4150 | 3968 | 95.6% | 1963 | probe-sticky-1777222718390 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 2-no-sticky | no-sticky | 0 | 200 | 4153 | 3968 | 95.5% | 1039 | - | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 2-no-sticky | no-sticky | 1 | 200 | 4155 | 0 | 0.0% | 1040 | - | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 2-no-sticky | no-sticky | 2 | 200 | 4153 | 3968 | 95.5% | 916 | - | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 2-no-sticky | no-sticky | 3 | 200 | 4153 | 3968 | 95.5% | 984 | - | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 2-no-sticky | no-sticky | 4 | 200 | 4154 | 0 | 0.0% | 1111 | - | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 2-no-sticky | no-sticky | 5 | 200 | 4154 | 3968 | 95.5% | 1237 | - | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-256 | 0 | 200 | 295 | 0 | 0.0% | 786 | probe-floor-256-1777222729909 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-256 | 1 | 200 | 293 | 0 | 0.0% | 687 | probe-floor-256-1777222729909 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-256 | 2 | 200 | 294 | 0 | 0.0% | 964 | probe-floor-256-1777222729909 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-1024 | 0 | 200 | 1096 | 0 | 0.0% | 654 | probe-floor-1024-1777222732346 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-1024 | 1 | 200 | 1097 | 0 | 0.0% | 654 | probe-floor-1024-1777222732346 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-1024 | 2 | 200 | 1096 | 0 | 0.0% | 747 | probe-floor-1024-1777222732346 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-4096 | 0 | 200 | 4277 | 4096 | 95.8% | 1054 | probe-floor-4096-1777222734402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-4096 | 1 | 200 | 4277 | 4096 | 95.8% | 1925 | probe-floor-4096-1777222734402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-4096 | 2 | 200 | 4277 | 4096 | 95.8% | 1270 | probe-floor-4096-1777222734402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-16384 | 0 | 200 | 16747 | 16512 | 98.6% | 1228 | probe-floor-16384-1777222738658 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-16384 | 1 | 200 | 16745 | 16512 | 98.6% | 1469 | probe-floor-16384-1777222738658 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-16384 | 2 | 200 | 16746 | 16512 | 98.6% | 1326 | probe-floor-16384-1777222738658 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-60000 | 0 | 200 | 61436 | 61312 | 99.8% | 2320 | probe-floor-60000-1777222742727 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-60000 | 1 | 200 | 61435 | 61312 | 99.8% | 2238 | probe-floor-60000-1777222742727 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 3-prefix-floor | tokens-60000 | 2 | 200 | 61435 | 61312 | 99.8% | 2110 | probe-floor-60000-1777222742727 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-alpha | 0 | 200 | 4162 | 3968 | 95.3% | 941 | probe-iso-alpha-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-alpha | 1 | 200 | 4160 | 3968 | 95.4% | 930 | probe-iso-alpha-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-alpha | 2 | 200 | 4159 | 3968 | 95.4% | 889 | probe-iso-alpha-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-beta | 0 | 200 | 4161 | 3968 | 95.4% | 944 | probe-iso-beta-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-beta | 1 | 200 | 4161 | 3968 | 95.4% | 943 | probe-iso-beta-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-beta | 2 | 200 | 4160 | 3968 | 95.4% | 961 | probe-iso-beta-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-gamma | 0 | 200 | 4163 | 3968 | 95.3% | 934 | probe-iso-gamma-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-gamma | 1 | 200 | 4162 | 3968 | 95.3% | 948 | probe-iso-gamma-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 4-sticky-isolation | key-gamma | 2 | 200 | 4163 | 3968 | 95.3% | 1007 | probe-iso-gamma-1777222749402 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 5-instability | warmup-baseline | 0 | 200 | 4152 | 3968 | 95.6% | 1060 | probe-instab-1777222757904 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 5-instability | warmup-baseline | 1 | 200 | 4152 | 3968 | 95.6% | 1033 | probe-instab-1777222757904 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 5-instability | baseline | 0 | 200 | 4152 | 3968 | 95.6% | 1121 | probe-instab-1777222757904 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 5-instability | trailing-newline | 0 | 200 | 4155 | 3968 | 95.5% | 1034 | probe-instab-1777222757904 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 5-instability | dynamic-timestamp | 0 | 200 | 4162 | 3968 | 95.3% | 999 | probe-instab-1777222757904 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 5-instability | temperature-changed | 0 | 200 | 4152 | 3968 | 95.6% | 1066 | probe-instab-1777222757904 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 5-instability | with-tools-A | 0 | 200 | 4271 | 4224 | 98.9% | 1009 | probe-instab-1777222757904 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 5-instability | with-tools-B-reordered | 0 | 200 | 4274 | 4224 | 98.8% | 1029 | probe-instab-1777222757904 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 7-tools-stable | with-tools | 0 | 200 | 4281 | 4224 | 98.7% | 2329 | probe-tools-1777222766263 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 7-tools-stable | with-tools | 1 | 200 | 4279 | 4224 | 98.7% | 925 | probe-tools-1777222766263 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 7-tools-stable | with-tools | 2 | 200 | 4283 | 4224 | 98.6% | 1226 | probe-tools-1777222766263 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 7-tools-stable | with-tools | 3 | 200 | 4281 | 4224 | 98.7% | 1008 | probe-tools-1777222766263 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 7-tools-stable | tools-reordered | 0 | 200 | 4283 | 4224 | 98.6% | 1011 | probe-tools-1777222766263 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 7-tools-stable | tools-expanded | 0 | 200 | 4290 | 4224 | 98.5% | 984 | probe-tools-1777222766263 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 7-tools-stable | tool-desc-changed | 0 | 200 | 4283 | 4224 | 98.6% | 1056 | probe-tools-1777222766263 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
