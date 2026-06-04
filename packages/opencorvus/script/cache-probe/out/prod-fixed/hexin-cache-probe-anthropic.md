# Hexin gateway cache probe

- Endpoint: `https://aimemodeldev.myhexin.com/litellm/v1`
- Model: `claude-sonnet-4-6`
- Date: 2026-04-27T08:43:36.668Z
- Total calls: 55 (0 errors)

## Summary by probe/variant

| Probe | Variant | N | avg prompt_tok | avg cached_tok | avg hit | errors |
|-------|---------|---|---------------:|---------------:|--------:|-------:|
| 0-response-cache | fresh-nonce | 4 | 4721 | 0 | 0.0% | 0 |
| 0-response-cache | same-body-repeat | 2 | 4711 | 0 | 0.0% | 0 |
| 1-sticky | with-sticky | 4 | 4721 | 0 | 0.0% | 0 |
| 2-no-sticky | no-sticky | 6 | 4721 | 2344 | 24.9% | 0 |
| 3-prefix-floor | tokens-1024 | 3 | 1240 | 0 | 0.0% | 0 |
| 3-prefix-floor | tokens-16384 | 3 | 18988 | 6318 | 16.7% | 0 |
| 3-prefix-floor | tokens-256 | 3 | 330 | 0 | 0.0% | 0 |
| 3-prefix-floor | tokens-4096 | 3 | 4833 | 1599 | 16.6% | 0 |
| 3-prefix-floor | tokens-60000 | 3 | 69359 | 0 | 0.0% | 0 |
| 4-sticky-isolation | key-alpha | 3 | 4730 | 0 | 0.0% | 0 |
| 4-sticky-isolation | key-beta | 3 | 4731 | 0 | 0.0% | 0 |
| 4-sticky-isolation | key-gamma | 3 | 4732 | 0 | 0.0% | 0 |
| 5-instability | baseline | 1 | 4722 | 0 | 0.0% | 0 |
| 5-instability | dynamic-timestamp | 1 | 4734 | 0 | 0.0% | 0 |
| 5-instability | temperature-changed | 1 | 4723 | 0 | 0.0% | 0 |
| 5-instability | trailing-newline | 1 | 4723 | 0 | 0.0% | 0 |
| 5-instability | warmup-baseline | 2 | 4722 | 0 | 0.0% | 0 |
| 5-instability | with-tools-A | 1 | 5297 | 0 | 0.0% | 0 |
| 5-instability | with-tools-B-reordered | 1 | 5302 | 0 | 0.0% | 0 |
| 7-tools-stable | tool-desc-changed | 1 | 5317 | 0 | 0.0% | 0 |
| 7-tools-stable | tools-expanded | 1 | 5348 | 0 | 0.0% | 0 |
| 7-tools-stable | tools-reordered | 1 | 5315 | 0 | 0.0% | 0 |
| 7-tools-stable | with-tools | 4 | 5314 | 1241 | 12.1% | 0 |

## Per-call detail

| probe | variant | iter | status | prompt | cached | hit | latency_ms | sticky | upstream |
|-------|---------|-----:|-------:|-------:|-------:|----:|-----------:|--------|----------|
| 0-response-cache | same-body-repeat | 0 | 200 | 4711 | 0 | 0.0% | 2506 | probe-respcache-1777279210952 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache | same-body-repeat | 1 | 200 | 4711 | 0 | 0.0% | 120 | probe-respcache-1777279210952 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache | fresh-nonce | 0 | 200 | 4720 | 0 | 0.0% | 2758 | probe-respcache-1777279210952 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache | fresh-nonce | 1 | 200 | 4722 | 0 | 0.0% | 2149 | probe-respcache-1777279210952 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache | fresh-nonce | 2 | 200 | 4720 | 0 | 0.0% | 2805 | probe-respcache-1777279210952 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 0-response-cache | fresh-nonce | 3 | 200 | 4720 | 0 | 0.0% | 2439 | probe-respcache-1777279210952 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 1-sticky | with-sticky | 0 | 200 | 4721 | 0 | 0.0% | 2275 | probe-sticky-1777279223734 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 1-sticky | with-sticky | 1 | 200 | 4721 | 0 | 0.0% | 2754 | probe-sticky-1777279223734 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 1-sticky | with-sticky | 2 | 200 | 4721 | 0 | 0.0% | 8960 | probe-sticky-1777279223734 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 1-sticky | with-sticky | 3 | 200 | 4720 | 0 | 0.0% | 2472 | probe-sticky-1777279223734 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky | no-sticky | 0 | 200 | 4719 | 0 | 0.0% | 2252 | - | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky | no-sticky | 1 | 200 | 4721 | 0 | 0.0% | 2538 | - | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky | no-sticky | 2 | 200 | 4721 | 0 | 0.0% | 2255 | - | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky | no-sticky | 3 | 200 | 4722 | 4688 | 49.8% | 1991 | - | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky | no-sticky | 4 | 200 | 4720 | 4688 | 49.8% | 2740 | - | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 2-no-sticky | no-sticky | 5 | 200 | 4721 | 4688 | 49.8% | 1779 | - | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-256 | 0 | 200 | 330 | 0 | 0.0% | 3032 | probe-floor-256-1777279253757 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-256 | 1 | 200 | 330 | 0 | 0.0% | 35045 | probe-floor-256-1777279253757 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-256 | 2 | 200 | 329 | 0 | 0.0% | 1738 | probe-floor-256-1777279253757 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-1024 | 0 | 200 | 1239 | 0 | 0.0% | 2733 | probe-floor-1024-1777279293573 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-1024 | 1 | 200 | 1239 | 0 | 0.0% | 1763 | probe-floor-1024-1777279293573 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-1024 | 2 | 200 | 1241 | 0 | 0.0% | 1955 | probe-floor-1024-1777279293573 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-4096 | 0 | 200 | 4833 | 0 | 0.0% | 3242 | probe-floor-4096-1777279300026 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-4096 | 1 | 200 | 4832 | 0 | 0.0% | 2105 | probe-floor-4096-1777279300026 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-4096 | 2 | 200 | 4834 | 4798 | 49.8% | 2912 | probe-floor-4096-1777279300026 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-16384 | 0 | 200 | 18988 | 0 | 0.0% | 2974 | probe-floor-16384-1777279308290 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-16384 | 1 | 200 | 18988 | 18953 | 50.0% | 2354 | probe-floor-16384-1777279308290 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-16384 | 2 | 200 | 18987 | 0 | 0.0% | 8076 | probe-floor-16384-1777279308290 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-60000 | 0 | 200 | 69360 | 0 | 0.0% | 5291 | probe-floor-60000-1777279321732 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-60000 | 1 | 200 | 69359 | 0 | 0.0% | 5079 | probe-floor-60000-1777279321732 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 3-prefix-floor | tokens-60000 | 2 | 200 | 69357 | 0 | 0.0% | 5509 | probe-floor-60000-1777279321732 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-alpha | 0 | 200 | 4731 | 0 | 0.0% | 3170 | probe-iso-alpha-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-alpha | 1 | 200 | 4730 | 0 | 0.0% | 2418 | probe-iso-alpha-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-alpha | 2 | 200 | 4730 | 0 | 0.0% | 2699 | probe-iso-alpha-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-beta | 0 | 200 | 4732 | 0 | 0.0% | 3284 | probe-iso-beta-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-beta | 1 | 200 | 4732 | 0 | 0.0% | 3723 | probe-iso-beta-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-beta | 2 | 200 | 4729 | 0 | 0.0% | 2255 | probe-iso-beta-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-gamma | 0 | 200 | 4732 | 0 | 0.0% | 3882 | probe-iso-gamma-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-gamma | 1 | 200 | 4732 | 0 | 0.0% | 3415 | probe-iso-gamma-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 4-sticky-isolation | key-gamma | 2 | 200 | 4731 | 0 | 0.0% | 3032 | probe-iso-gamma-1777279337616 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability | warmup-baseline | 0 | 200 | 4722 | 0 | 0.0% | 2215 | probe-instab-1777279365502 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability | warmup-baseline | 1 | 200 | 4722 | 0 | 0.0% | 2356 | probe-instab-1777279365502 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability | baseline | 0 | 200 | 4722 | 0 | 0.0% | 2829 | probe-instab-1777279365502 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability | trailing-newline | 0 | 200 | 4723 | 0 | 0.0% | 2313 | probe-instab-1777279365502 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability | dynamic-timestamp | 0 | 200 | 4734 | 0 | 0.0% | 2618 | probe-instab-1777279365502 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability | temperature-changed | 0 | 200 | 4723 | 0 | 0.0% | 15751 | probe-instab-1777279365502 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability | with-tools-A | 0 | 200 | 5297 | 0 | 0.0% | 2114 | probe-instab-1777279365502 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 5-instability | with-tools-B-reordered | 0 | 200 | 5302 | 0 | 0.0% | 2133 | probe-instab-1777279365502 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable | with-tools | 0 | 200 | 5314 | 0 | 0.0% | 2432 | probe-tools-1777279397839 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable | with-tools | 1 | 200 | 5315 | 0 | 0.0% | 2367 | probe-tools-1777279397839 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable | with-tools | 2 | 200 | 5314 | 4964 | 48.3% | 2313 | probe-tools-1777279397839 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable | with-tools | 3 | 200 | 5314 | 0 | 0.0% | 2176 | probe-tools-1777279397839 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable | tools-reordered | 0 | 200 | 5315 | 0 | 0.0% | 2039 | probe-tools-1777279397839 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable | tools-expanded | 0 | 200 | 5348 | 0 | 0.0% | 4214 | probe-tools-1777279397839 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
| 7-tools-stable | tool-desc-changed | 0 | 200 | 5317 | 0 | 0.0% | 3273 | probe-tools-1777279397839 | 998ef4dd-d16a-429e-92e8-f77d5e4e30a7 |
