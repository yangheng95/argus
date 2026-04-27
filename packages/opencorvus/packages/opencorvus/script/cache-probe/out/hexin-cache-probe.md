# Hexin gateway cache probe

- Endpoint: `https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1`
- Model: `gpt-5.4`
- Date: 2026-04-26T16:53:22.044Z
- Total calls: 4 (0 errors)

## Summary by probe/variant

| Probe | Variant | N | avg prompt_tok | avg cached_tok | avg hit | errors |
|-------|---------|---|---------------:|---------------:|--------:|-------:|
| 1-sticky | with-sticky | 4 | 4132 | 0 | 0.0% | 0 |

## Per-call detail

| probe | variant | iter | status | prompt | cached | hit | latency_ms | sticky | upstream |
|-------|---------|-----:|-------:|-------:|-------:|----:|-----------:|--------|----------|
| 1-sticky | with-sticky | 0 | 200 | 4132 | 0 | 0.0% | 1931 | probe-sticky-1777222399960 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 1-sticky | with-sticky | 1 | 200 | 4132 | 0 | 0.0% | 51 | probe-sticky-1777222399960 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 1-sticky | with-sticky | 2 | 200 | 4132 | 0 | 0.0% | 42 | probe-sticky-1777222399960 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
| 1-sticky | with-sticky | 3 | 200 | 4132 | 0 | 0.0% | 48 | probe-sticky-1777222399960 | 85278ea1-1d99-4742-a2da-3dbcdb25d941 |
