---
name: search-anything
description: Independent general web-search skill for information, news, web content, or other current external topics when the concrete Task explicitly authorizes this provider.
---

# Search Anything

## Overview

This Skill provides a task-authorized general search provider distinct from iFind. The bundled diagnostic sends one request to one environment-configured endpoint and returns that provider's response unchanged. It contains no endpoint, identity, credential, channel, output-format, or result-count default.

## Quick Start

### Basic Search

Supply the endpoint and provider identity outside the prompt through `SEARCH_ANYTHING_ENDPOINT`, `SEARCH_ANYTHING_AUTH_HEADER`, `SEARCH_ANYTHING_USER_ID`, and `SEARCH_ANYTHING_APP_ID`, then pass all request values explicitly:

```bash
bash scripts/web_search "your search query here" '["web_en"]' 10 block
```

### Customizing Result Count

Choose the result count explicitly as the third argument:

```bash
bash scripts/web_search "your search query" '["web_en"]' 15 block
```

### Search Strategy
#### Current Date Awareness
- **Always include the current year** in search queries for time-sensitive data (e.g., "EV market size 2026"). Use BASH `date +%Y` to dynamically insert the current year.
- **Specify date ranges** when searching for recent news or developments
- **Use "latest" or current year** keywords to ensure up-to-date results
- **Avoid outdated data** — prioritize sources from the last 12 months

Search Query Examples:
- ❌ Bad: "electric vehicle market size"
- ✅ Good: "electric vehicle market size 2026"

#### Multilingual Search Strategy
**For comprehensive research, search in BOTH Chinese and English:**

| Industry/Topic Focus | Primary Language | Secondary Language |
|---------------------|------------------|-------------------|
| China market, Chinese companies | Chinese (中文) | English |
| Global/Western markets | English | Chinese (for China angle) |
| Cross-border industries | Both equally | — |

**Bilingual Search Examples:**

| Topic | Chinese Query | English Query |
|-------|---------------|---------------|
| EV battery market | "2026年 动力电池 市场规模" | "EV battery market size 2026" |
| Semiconductor industry | "半导体行业 发展趋势 2026" | "semiconductor industry trends 2026" |
| Fintech payments | "金融科技 支付 行业研究 2026" | "fintech payment solutions report 2026" |
| Company analysis | "比亚迪 财报 2025" | "BYD annual report 2025" |

#### Source Language Priority:
- **Tier 1 Chinese**: 国家统计局, 中国人民银行, 证监会, 工信部
- **Tier 1 English**: Federal Reserve, SEC, IMF, World Bank
- **Tier 2 Chinese**: 艾瑞咨询, 前瞻产业研究院, 中金研究
- **Tier 2 English**: Bloomberg, Reuters, McKinsey, BCG


## Usage Guidelines

### When to Use

- User needs comprehensive search results on a topic
- Research tasks requiring external data
