---
name: webfetch
description: Fetches a URL and returns it as clean readable markdown (nav, ads, boilerplate stripped) via Jina Reader (r.jina.ai). Use when you need to read the full contents of a webpage — documentation, articles, GitHub READMEs, blog posts, API references, release notes. No API key required. Pair with the `websearch` skill to first find URLs, then fetch them. Output is truncated to ~8k tokens by default; raise with --max-tokens for long pages.
---

# webfetch

Clean-markdown fetch via [Jina Reader](https://jina.ai/reader) (`r.jina.ai` prefix). Keyless, free tier.

## Usage

```bash
./fetch.sh https://example.com/article
./fetch.sh https://example.com/article --max-tokens 16000
./fetch.sh https://example.com/article --raw          # no truncation
```

Output: markdown with title, source URL, publication time, and body text.

## Rate limits

Jina Reader free tier is ~20 req/min. If you hit 429, wait a minute and retry. For bulk fetching, throttle to 1 req every 3 seconds.

## Typical flow

1. `websearch/search.sh "topic"` → get URLs
2. `webfetch/fetch.sh <url>` on the best-looking result
3. Read the returned markdown; quote relevant bits in your answer

## When NOT to use this

- JS-heavy pages requiring interaction (login, buttons): use the browser-automation route instead.
- Binary files (PDFs, images): Jina can extract PDF text but won't handle images well.
- Sites that block datacenter IPs: Jina may return an error; try a different source URL.
