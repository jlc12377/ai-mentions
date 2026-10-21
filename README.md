# AI Mentions

Free AI visibility check for [ai-mentions.com](https://www.ai-mentions.com/). A visitor enters a company, website, category, and optional city. The site asks a few buyer-style questions of each AI assistant that has an API key configured, then scores the real answers.

The business name is not included in the questions. If no assistants are connected, or every call fails, the page says **score temporarily unavailable** and still submits the lead form. It does not invent a score.

## How the score is calculated

Formula version 1. Each successful answer is scored from 0 to 100:

**Mention (70%)**

| What the answer does | Mention points |
| --- | --- |
| Business is absent | 0 |
| Named, but not in a list | 50 |
| List position 1 | 100 |
| Each step lower in the list | minus 12, with a floor of 20 |

Position 2 is 88, position 3 is 76, and position 8 or lower is 20. Matching is case-insensitive. Suffixes such as Inc, LLC, Ltd, Corp, and Co are ignored. A short name has to match a whole word, so "SAP" does not match "sapling". The domain counts as a mention when it appears in the answer.

**Citation (30%)**

100 if a source URL uses the company's domain (including a subdomain), otherwise 0. `blog.hubspot.com` counts for `hubspot.com`. `nothubspot.com` does not. Citations come from the provider's source list (OpenAI URL citations, Perplexity search results, Gemini grounding chunks, Claude citation objects and web search result URLs) and from URLs written in the answer. This part stays 0 when the visitor leaves the website blank.

One answer is `round(0.70 × mention points + 0.30 × citation points)`. The visibility score is the rounded average of every answer that actually came back. Each answer counts equally. Calls that time out, return an error, or come back empty are left out — an empty or failed call is not treated as "not mentioned". If none succeed, `score` is `null`.

Very short or generic names (for example "AI") can match ordinary words. The questions also ask the model to use a numbered list, which is disclosed on the page, so list position is easier to read. That nudge is small, but it is not a raw consumer chat transcript.

## API

`POST /api/score`

```json
{
  "businessName": "HubSpot",
  "domain": "hubspot.com",
  "category": "CRM Software",
  "city": "Austin"
}
```

`domain` and `city` are optional. Limits: company, category, and city 80 characters; website 200 characters.

A hit looks like `{ "ok": true, "score": 42, "providers": [...], "prompts": [...], "competitors": [...], "timestamp": "..." }`. An outage looks like `{ "ok": false, "unavailable": true, "score": null, "message": "Score temporarily unavailable" }` with HTTP 503 (no keys or every call failed), 429 (rate limit), or 400 (bad input).

## Deploy on Vercel

The site is static files plus one Node function, `api/score.js`. Deploy from `main` the same way as today. After the function is live, add environment variables in the Vercel project (**Settings → Environment Variables**) and redeploy so the function can see them. Do not commit keys. `.env` is gitignored. `.env.example` lists the names with empty values.

### Keys that turn a provider on

Leave a key unset to skip that assistant. With none set, the checker returns "score temporarily unavailable".

| Env var | Provider | Default model | Grounding |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | ChatGPT | `gpt-4.1-mini` (`OPENAI_MODEL`) | Responses API `web_search`, `search_context_size: low`, tool choice required |
| `PERPLEXITY_API_KEY` | Perplexity | `perplexity/sonar` (`PERPLEXITY_MODEL`) | `POST /v1/responses` `web_search` with `search_type: fast`, one prompt at a time |
| `GEMINI_API_KEY` | Gemini | `gemini-2.5-flash-lite` (`GEMINI_MODEL`) | `google_search` grounding |
| `ANTHROPIC_API_KEY` | Claude | `claude-haiku-5-5` (`ANTHROPIC_MODEL`) | `web_search_20250305` (`ANTHROPIC_WEB_SEARCH_TOOL`), one search |

Every Perplexity call is `POST https://api.perplexity.ai/v1/responses`. A model name without a slash, such as `sonar`, is sent as `perplexity/sonar`. The old `/chat/completions` path now returns 403 and tells callers to use `/v1/responses`.

Perplexity prompts run one at a time. A new account is tier 0, which allows about one Agent API request per second, so four prompts fired together come back as HTTP 429. The checker waits `PERPLEXITY_PROMPT_DELAY_MS` (default 1100) between prompts and retries a 429 up to `PERPLEXITY_429_RETRIES` times (default 2), honoring `Retry-After` when the response includes it. The whole sequence stops at `PERPLEXITY_BUDGET_MS` (default 50 seconds) so it stays inside the 60 second function cap. Prompts that do not fit are reported as timed out. A 429 on some questions does not zero the provider: those questions are shown with the error and left out of the average.

Claude asks with the web search tool (`web_search_20250305` by default, one search, at least 1600 output tokens so the tool result does not crowd out the answer). The checker keeps every text block and takes source URLs from both citation objects and `web_search_tool_result` entries. If that call has no answer text, the turn was paused, or the tool is rejected, a second call without the tool is scored and labeled "answered without web search". A rejected key, a timeout, or a 429 is not retried that way. Gemini grounding has to be allowed on the Google AI key. A provider that returns an error is dropped from the average. If the others answer, their answers are still scored. Questions that fail inside an otherwise successful provider are shown on the page and left out of that provider's score.

### Optional settings

| Env var | Default | What it does |
| --- | --- | --- |
| `PROVIDER_TIMEOUT_MS` | `20000` | Per-call timeout. ChatGPT, Gemini, and Claude still run in parallel. Perplexity runs its prompts one at a time inside its own budget. |
| `PERPLEXITY_BUDGET_MS` | `50000` | Wall-clock budget for every Perplexity prompt, including 429 retries and the delay between prompts. |
| `PERPLEXITY_PROMPT_DELAY_MS` | `1100` | Pause between Perplexity prompts. Sized for a tier 0 limit of about one request per second. |
| `PERPLEXITY_429_RETRIES` | `2` | Extra attempts after HTTP 429. Backoff is 1s then 2s, or the `Retry-After` header when it fits the budget. |
| `SCORE_PROMPT_COUNT` | `4` | Buyer prompts per provider. Clamped to 3–5. |
| `SCORE_MAX_OUTPUT_TOKENS` | `600` | Output cap. Claude's web search call uses at least 1600 so the tool result does not replace the answer. |
| `SCORE_CACHE_TTL_SEC` | `86400` | How long an identical successful check is reused (24 hours). |
| `RATE_LIMIT_MAX` | `8` | Checks per IP per window. |
| `RATE_LIMIT_WINDOW_SEC` | `3600` | Rate-limit window. |
| `GEMINI_THINKING_BUDGET` | unset | Sent only when set. `0` disables thinking on Gemini models that accept `thinkingBudget`. |
| `KV_REST_API_URL` and `KV_REST_API_TOKEN` | unset | Vercel KV / Upstash Redis REST. Shared 24-hour cache and shared rate limit. |
| `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` | unset | Same as the KV pair, if you created the database as Upstash directly. |

`vercel.json` caps the function at 60 seconds. The platform default is longer; the cap is there so a stuck call cannot run for minutes. Four prompts times four providers is 16 calls. ChatGPT, Gemini, and Claude fire together. Perplexity is the long pole: up to its budget, default 50 seconds, still under the cap. The page waits up to 58 seconds before it gives up on the request.

### Rough cost per check

Prices below are list prices as of October 2026 and move. Confirm them before turning traffic on:

- [OpenAI pricing](https://developers.openai.com/api/docs/pricing) and [web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing) and [web search](https://docs.perplexity.ai/docs/agent-api/tools/web-search)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

Assume 4 prompts, short answers, and one web search each.

| Provider | About what one prompt costs | 4 prompts |
| --- | --- | --- |
| OpenAI `gpt-4.1-mini` + web search | about $0.014. The search tool is $10 / 1,000 calls. On this mini model, search content is billed as a fixed 8,000 input tokens ($0.40 / 1M) even at `low` context size, plus a few hundred output tokens ($1.60 / 1M). | about $0.06 |
| Perplexity `perplexity/sonar` + fast web search | about $0.003. Fast search is $1 / 1,000 calls. Sonar tokens are $0.25 / 1M input and $2.50 / 1M output. | about $0.01 |
| Gemini `gemini-2.5-flash-lite` + Google Search grounding | tokens are well under $0.001 ($0.10 / 1M input, $0.40 / 1M output). Grounding on the paid tier includes 1,500 grounded prompts per day shared with Flash, then **$35 / 1,000 grounded prompts** ($0.035 each). | about $0 inside the free grounding quota, otherwise about $0.14 |
| Anthropic `claude-haiku-5-5` + web search | about $0.01–$0.02. Web search is $10 / 1,000 searches. Haiku 5.5 text is $0.10 / 1M input and $0.50 / 1M output under 100K tokens, and retrieved pages count as input tokens. | about $0.05–$0.08 |

All four providers, four prompts: about **$0.12** when Gemini grounding is inside the daily free quota, or about **$0.25** when those Gemini prompts are billed. A cache hit within 24 hours does not call the providers again. Eight checks an hour from one IP, all cache misses, all four providers, Gemini billed: on the order of $2 per hour from that IP.

The Gemini free-tier API can also ground searches, with a smaller daily cap, and Google may use that traffic to improve its products. Use a paid key if you do not want that.

### Rate limit and cache

Without KV, the limit and the 24-hour cache live in the function instance's memory. On Vercel that memory is not shared across instances, and it disappears when the instance goes cold. A visitor who lands on another instance gets a fresh limit and a fresh check. Treat the in-memory limiter as a basic brake, not a hard global cap.

With `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the Upstash pair), both the cache and the counter are shared. If KV errors, the function falls back to memory for that request instead of failing the check. Only successful scores are cached. An outage is not cached, so adding a key takes effect on the next request. The cache key is a hash of the normalized name, domain, category, city, prompt count, formula version, and the configured model names.

The limiter reads the first address in `x-forwarded-for`, which Vercel sets. It is per IP, default 8 requests per hour, including cache hits.

## Local development

```bash
npm test
npm start
```

`npm start` serves the site and `POST /api/score` on port 3000. It reads the environment of the shell. With no provider keys, a check returns the unavailable state:

```bash
curl -s -X POST http://127.0.0.1:3000/api/score \
  -H 'Content-Type: application/json' \
  -d '{"businessName":"HubSpot","category":"CRM Software","domain":"hubspot.com"}'
```

Unit tests cover mention detection, list position, citations, the scoring formula, mocked provider responses, the no-keys response, total failure, partial failure, validation, the rate limit, and the 24-hour cache. They do not call the real providers.

The lead form still posts to the existing Formspree endpoint after the check resolves (including when the score is unavailable). The payload includes the real score, or `unavailable`. No score is sent to the provider APIs, and the email address stays on the form post.
