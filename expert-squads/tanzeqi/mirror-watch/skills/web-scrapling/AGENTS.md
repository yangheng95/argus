# WEB-SCRAPLING KNOWLEDGE BASE

**Generated:** 2026-05-12

## OVERVIEW
The most comprehensive skill in the repo. Documents the Scrapling adaptive web scraping framework — from single requests to full-scale crawls.

## STRUCTURE

```
web-scrapling/
├── SKILL.md
├── examples/
│   ├── 01_fetcher_session.py
│   ├── 02_dynamic_session.py
│   ├── 03_stealthy_session.py
│   ├── 04_spider.py
│   └── README.md
└── references/
    ├── fetching/
    │   ├── choosing.md
    │   ├── dynamic.md
    │   ├── static.md
    │   └── stealthy.md
    ├── parsing/
    │   ├── adaptive.md
    │   ├── main_classes.md
    │   └── selection.md
    ├── spiders/
    │   ├── advanced.md
    │   ├── architecture.md
    │   ├── getting-started.md
    │   ├── proxy-blocking.md
    │   ├── requests-responses.md
    │   └── sessions.md
    ├── mcp-server.md
    └── migrating_from_beautifulsoup.md
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| CLI quick reference | `SKILL.md` lines 14-89 |
| Which fetcher to use | `references/fetching/choosing.md` |
| HTML parsing API | `references/parsing/` |
| Spider/crawl framework | `references/spiders/` |
| MCP server capabilities | `references/mcp-server.md` |
| BeautifulSoup migration | `references/migrating_from_beautifulsoup.md` |
| Code examples | `examples/` |

## CONVENTIONS

**Escalation strategy:** `get` → `fetch` → `stealthy-fetch`. Speed is nearly identical; start simple and escalate on failure.

**Output format by extension:**
- `.md` — Converted to Markdown (preferred for readability)
- `.html` — Raw HTML
- `.txt` — Clean text only

**CLI pattern:**
```bash
scrapling extract <command> "<URL>" <output.file> [options]
```

## NOTES

- Always clean up temp files after reading.
- Use `--css-selector` / `-s` to avoid passing giant HTML blobs — saves tokens.
- This skill encapsulates almost all published Scrapling documentation. Do not search external sources without user permission.
