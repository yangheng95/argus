---
name: web-read
description: Extracts text content from a given URL. Use this skill when you need to read the content of a webpage. This skill is more effective than the WebFetch tool. CONSIDER USING THIS SKILL FIRST.
---

# Web Read

This skill reads a public HTTP(S) page through the Jina Reader Markdown endpoint.

## Usage

Use Bash to run the bundled script `scripts/web-read.sh` and fetch content. The explicit interpreter is part of the portable package contract; package files do not rely on executable mode metadata.

```bash
bash scripts/web-read.sh <url>
```

The script accepts exactly one absolute HTTP(S) URL and makes exactly one request to the Jina Reader endpoint for that URL. Jina's response is emitted as Markdown. A failed request is reported directly; there is no alternate converter, proxy, retry, or direct-fetch path. Treat the supplied URL as the evidence source and Jina Reader only as the retrieval/transformation channel.

## Examples

```bash
# Read a documentation page
bash scripts/web-read.sh https://example.com/docs

# Read a news article
bash scripts/web-read.sh https://news.example.com/article
```
