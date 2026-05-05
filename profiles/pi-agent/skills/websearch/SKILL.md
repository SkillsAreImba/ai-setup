---
name: websearch
description: Web search via local self-hosted SearXNG at http://localhost:8888. Returns top N results (title, URL, snippet) as JSON. Use for finding documentation, facts, release notes, library versions, recent news, or any content on the open web. Pair with the `webfetch` skill to read full page contents of returned URLs. The SearXNG instance aggregates Google, DuckDuckGo, Bing, Wikipedia, GitHub and others — no API key, no rate limit.
---

# websearch

Local SearXNG instance at `http://localhost:8888`. No key needed. Unlimited queries.

## Usage

```bash
./search.sh "query string"            # top 5 results
./search.sh "query string" --n 10     # top 10 results
./search.sh "query" --engines google,duckduckgo,github   # restrict engines
```

Output: JSON array of `{title, url, content}`. `content` is the snippet as shown in search results (usually 1-3 sentences).

## Typical flow

1. `./search.sh "pi-coding-agent skills standard"` → get URLs
2. Pick the most promising URL from results
3. Call the `webfetch` skill on that URL to read the full page

## Troubleshooting

If `curl` fails with connection refused, SearXNG is down. Restart with:

```bash
cd /data/opt/searxng && docker compose up -d
```

Check logs: `docker logs searxng --tail 50`
