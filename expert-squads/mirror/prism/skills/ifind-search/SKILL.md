---
name: ifind-search
description: Search current financial news, reports, announcements, filings, calls, investor Q&A, academic papers, knowledge, and international web evidence through the package-configured iFind provider.
---

# iFind Search

Use the projected `prism/shared/ifind-search` package tool. It is the single network implementation for this Skill and accepts exactly three arguments:

- `query`: one explicit non-empty research query.
- `channels`: one or more unique declared channels.
- `size`: requested provider result count from 1 through 10.

The tool statically imports its immutable configuration from the active self-contained expert-squad package, sends one request to the one configured endpoint, and returns provider `summary` evidence without post-response truncation or provider substitution. Callers do not supply a path, endpoint, credential, identity, request policy, environment lookup, or alternate configuration. A missing or invalid package asset and a failed request are caller-visible failures.

```json
{
  "query": "Nvidia earnings",
  "channels": ["usnotice", "teleconference", "report"],
  "size": 10
}
```

## Channels

| Channel | Use for |
|---|---|
| `news` | Current company and market news |
| `report` | Broker and analyst research |
| `announcement` | China A-share disclosures |
| `usnotice` | United States regulatory filings |
| `teleconference` | Earnings-call transcripts |
| `interact` | Investor Q&A |
| `community` | Retail-investor discussion |
| `knowledge` | Provider knowledge entries |
| `yike` | Provider concept entries |
| `en_paper` | English academic papers |
| `web` | International product, industry, policy, and general web evidence |

Choose channels before the call according to the finite evidence plan. There is no implicit default, pagination mode, offset, slot filter, alternate endpoint, alternate provider, or additional request field.

## Evidence contract

The canonical JSON result contains `schema_version: 1`, `provider: "ifind-search"`, the exact query/channels/size/request ID, provider status, and result rows with channel, title, exact HTTPS URL, optional publish date, `evidence_field: "summary"`, and exact provider summary.

Treat an empty successful provider response as explicit zero-result evidence. Do not fabricate facts, call a different search provider, relax channels, or convert a configuration, transport, schema, size, channel, or response-boundary failure into a successful result. See `references/advanced_usage.md` for channel selection details.
