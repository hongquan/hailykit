# Error Handling & Fallback Strategies

## Error Codes

**404 Not Found**
- Topic-specific URL not available
- Library not on context7.com
- llms.txt doesn't exist

**Timeout**
- Network issues
- Large repository clone
- Slow API response

**Invalid Response**
- Malformed llms.txt
- Empty content
- Invalid URLs

**403 / Bot-blocked / Empty body**
- Bot wall (Cloudflare challenge, "Just a moment…") rejects the fetch
- JS-rendered SPA returns a near-empty HTML shell
- Host filters by User-Agent

## Fallback Chain

### For Topic-Specific Queries

```
1. Try topic-specific URL
   https://context7.com/{library}/llms.txt?topic={keyword}
   ↓ 404
2. Try general library URL
   https://context7.com/{library}/llms.txt
   ↓ 404
3. WebSearch for llms.txt
   "[library] llms.txt site:[official domain]"
   ↓ Not found
4. Repository analysis
   Use Repomix on GitHub repo
```

### For General Library Queries

```
1. Try context7.com
   https://context7.com/{library}/llms.txt
   ↓ 404
2. WebSearch for llms.txt
   "[library] llms.txt"
   ↓ Not found
3. Repository analysis
   Clone + Repomix
   ↓ No repo
4. Research agents
   Deploy multiple Researcher agents
```

### For Blocked or JS-Rendered Pages

A 403, a challenge page, or a near-empty body on a URL that search results confirm exists means a bot wall or client-side rendering — not a dead link. Do not retry WebFetch verbatim.

```
1. Real browser via {skill:hc-browser}
   agent-browser open <url> && agent-browser get text && agent-browser close
   (one-time setup: npm install -g agent-browser && agent-browser install)
   ↓ Still blocked (login wall)
2. Source-specific tool
   GitHub → gh api / raw.githubusercontent.com
   ↓ No tool for this source
3. WebSearch snippets covering the same claim (last resort)
```

## Timeout Handling

**Set limits:**
- WebFetch: 60s
- Repository clone: 5min
- Repomix: 10min

**Fail fast:** Don't retry failed methods

## Empty Results

**If llms.txt has 0 URLs:**
→ Note in report
→ Try repository analysis
→ Check official website manually
