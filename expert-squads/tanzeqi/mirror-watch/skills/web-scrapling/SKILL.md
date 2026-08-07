---
name: web-scrapling
description: Scrape web pages using Scrapling with anti-bot bypass (like Cloudflare Turnstile), stealth headless browsing, spiders framework, adaptive scraping, and JavaScript rendering. Use when asked to scrape, crawl, or extract data from websites; webfetch fails; the site has anti-bot protections.
---

# Scrapling

Scrapling is an adaptive Web Scraping framework that handles everything from a single request to a full-scale crawl.

Its parser learns from website changes and can relocate elements when pages update. Its fetchers support browser-backed retrieval, and its spider framework supports concurrent, multi-session crawls. In this package each request uses one preselected source and treats blocked or failed responses as terminal evidence.

Blazing fast crawls with real-time stats and streaming. Built by Web Scrapers for Web Scrapers and regular users, there's something for everyone.

## CLI Usage

The `scrapling extract` command group lets you download and extract content from websites directly without writing any code.

```bash
Usage: scrapling extract [OPTIONS] COMMAND [ARGS]...

Commands:
  get             Perform a GET request and save the content to a file.
  post            Perform a POST request and save the content to a file.
  put             Perform a PUT request and save the content to a file.
  delete          Perform a DELETE request and save the content to a file.
  fetch           Use a browser to fetch content with browser automation and flexible options.
  stealthy-fetch  Use a stealthy browser to fetch content with advanced stealth features.
```

### Usage pattern
- Choose your output format by changing the file extension. Here are some examples for the `scrapling extract get` command:
  - Convert the HTML content to Markdown, then save it to the file (great for documentation): `scrapling extract get "https://blog.example.com" article.md`
  - Save the HTML content as it is to the file: `scrapling extract get "https://example.com" page.html`
  - Save a clean version of the text content of the webpage to the file: `scrapling extract get "https://example.com" content.txt`
- Output to a temp file, read it back, then clean up.
- All commands can use CSS selectors to extract specific parts of the page through `--css-selector` or `-s`.

Which command to use generally:
- Use **`get`** with simple websites, blogs, or news articles.
- Use **`fetch`** with modern web apps, or sites with dynamic content.
- Use **`stealthy-fetch`** with protected sites, Cloudflare, or anti-bot systems.

> When unsure, start with `get`. If it fails or returns empty content, escalate to `fetch`, then `stealthy-fetch`. The speed of `fetch` and `stealthy-fetch` is nearly the same, so you are not sacrificing anything.

`get` Examples:

```bash
# Basic download
scrapling extract get "https://news.site.com" news.md

# Download with custom timeout
scrapling extract get "https://example.com" content.txt --timeout 60

# Extract only specific content using CSS selectors
scrapling extract get "https://blog.example.com" articles.md --css-selector "article"

# Send a request with cookies
scrapling extract get "https://scrapling.requestcatcher.com" content.md --cookies "session=abc123; user=john"

# Add user agent
scrapling extract get "https://api.site.com" data.json -H "User-Agent: MyBot 1.0"

# Add multiple headers
scrapling extract get "https://site.com" page.html -H "Accept: text/html" -H "Accept-Language: en-US"
```

#### Key options (browsers)

`fetch` and `stealthy-fetch` Examples:

```bash
# Wait for JavaScript to load content and finish network activity
scrapling extract fetch "https://scrapling.requestcatcher.com/" content.md --network-idle

# Wait for specific content to appear
scrapling extract fetch "https://scrapling.requestcatcher.com/" data.txt --wait-selector ".content-loaded"

# Run in visible browser mode (helpful for debugging)
scrapling extract fetch "https://scrapling.requestcatcher.com/" page.html --no-headless --disable-resources

# Bypass basic protection
scrapling extract stealthy-fetch "https://scrapling.requestcatcher.com" content.md

# Solve Cloudflare challenges
scrapling extract stealthy-fetch "https://nopecha.com/demo/cloudflare" data.txt --solve-cloudflare --css-selector "#padded_content a"

# Use a proxy for anonymity.
scrapling extract stealthy-fetch "https://site.com" content.md --proxy "http://proxy-server:8080"
```

### Notes

- ALWAYS clean up temp files after reading
- Prefer `.md` output for readability; use `.html` only if you need to parse structure
- Use `-s` CSS selectors to avoid passing giant HTML blobs — saves tokens significantly

## References
You already had a good glimpse of what the library can do. Use the references below to dig deeper when needed
- `references/mcp-server.md` — MCP server tools and capabilities
- `references/parsing` — Everything you need for parsing HTML
- `references/fetching` — Everything you need to fetch websites and session persistence
- `references/spiders` — Spider architecture, request/response handling, terminal blocked-response evidence, and advanced features. It follows a Scrapy-like format
- `references/migrating_from_beautifulsoup.md` — A quick API comparison between scrapling and Beautifulsoup
- `https://github.com/D4Vinci/Scrapling/tree/main/docs` — Full official docs in Markdown for quick access (use only if current references do not look up-to-date).

This skill encapsulates almost all the published documentation in Markdown, so don't check external sources or search online without the user's permission.
