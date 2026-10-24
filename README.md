# AI Mentions

Free AI visibility check for [ai-mentions.com](https://www.ai-mentions.com/). A visitor enters a company, website, category, and optional city. The site asks a few buyer-style questions of each AI assistant that has an API key configured, then scores the real answers.

The business name is not included in the buyer questions. A separate awareness question does include it. If no assistants are connected, or every call fails, the page says **score temporarily unavailable** and still submits the lead form. It does not invent a score.

## How the score is calculated

Formula version 2. A recommendation answer is still scored from 0 to 100:

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

One recommendation answer is `round(0.70 × mention points + 0.30 × citation points)`. R is the rounded average of every recommendation answer that actually came back. Each of those answers counts equally. The awareness question is not included in R.

Each provider is also asked, in the same parallel batch, `What do you know about <business> (<domain>)?` and told to reply `UNKNOWN` if it does not know the business. That reply is **known** only when it identifies the business by name or domain. `UNKNOWN`, a disclaimer, and a sentence that only repeats the name while saying the business was not found do not count. A recommendation mention uses the same rule. A is `100 × known / awareness answers that came back`. A timed-out awareness call is left out of A. If no awareness answer came back, the visibility score is R. Otherwise it is `round(0.75 × R + 0.25 × A)`.

Recommendation mentions stay the dominant weight. Known by every assistant that answered, and recommended by none, is 25 (the 20–30 band). Known by 2 of 3 is 17. Known by 1 of 3 is 8. Unknown everywhere, with no recommendation, is 0 (the 0–5 band). Calls that time out, return an error, or come back empty are left out — an empty or failed call is not treated as "not mentioned" or "never heard of you". If no recommendation answer succeeds, `score` is `null`.

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

A hit looks like `{ "ok": true, "score": 25, "businessName": "Example", "providers": [{ "id": "openai", "label": "ChatGPT", "answered": true, "mentioned": false, "known": true, "recommends": ["PR Newswire", "eReleases"] }], "timestamp": "..." }`. That public JSON is the free result only: the score, whether each assistant knows the business (`known`), whether it recommended the business (`mentioned`), and up to three other names. It does not include the questions, awareness answers, answer excerpts, citation URLs, per-question scores, or the formula. An outage looks like `{ "ok": false, "unavailable": true, "score": null, "message": "Score temporarily unavailable" }` with HTTP 503 (no keys or every call failed), 429 (rate limit), or 400 (bad input). The paid report is built on the server from the full checks, including the awareness answers, not from this response.

## Deploy on Vercel

The site is static files plus one Node function, `api/score.js`. Deploy from `main` the same way as today. After the function is live, add environment variables in the Vercel project (**Settings → Environment Variables**) and redeploy so the function can see them. Do not commit keys. `.env` is gitignored. `.env.example` lists the names with empty values.

### Keys that turn a provider on

Leave a key unset to skip that assistant. With none set, the checker returns "score temporarily unavailable".

| Env var | Provider | Default model | Grounding |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | ChatGPT | `gpt-4.1-mini` (`OPENAI_MODEL`) | Responses API `web_search`, `search_context_size: low`, tool choice required |
| `PERPLEXITY_API_KEY` | Perplexity | `perplexity/sonar` (`PERPLEXITY_MODEL`) | `POST /v1/responses` `web_search` with `search_type: fast` |
| `GEMINI_API_KEY` | Gemini | `gemini-2.5-flash-lite` (`GEMINI_MODEL`) | `google_search` grounding |
| `ANTHROPIC_API_KEY` | Claude | `claude-haiku-5-5` (`ANTHROPIC_MODEL`) | `web_search_20250305` (`ANTHROPIC_WEB_SEARCH_TOOL`), one search |

Every Perplexity call is `POST https://api.perplexity.ai/v1/responses`. A model name without a slash, such as `sonar`, is sent as `perplexity/sonar`. The old `/chat/completions` path now returns 403 and tells callers to use `/v1/responses`.

Every configured provider, every buyer prompt, and the awareness prompt start at the same time. Each call is capped at `PROVIDER_TIMEOUT_MS` (default 20 seconds) and the whole check is capped at `SCORE_BUDGET_MS` (default 35 seconds), so the extra question does not add a round trip. `api/score.js` allows 45 seconds, which leaves room for the score email. The page stops waiting at 40 seconds and offers a retry. A failed assistant is left out of the average. It is not scored as zero, and the free result says "Did not answer" rather than "Recommends you: No".

Perplexity can still return HTTP 429 when several prompts run together. A 429 is retried up to `PERPLEXITY_429_RETRIES` times (default 2) inside that same per-call deadline, honoring `Retry-After` when the response includes it. A retry that does not fit is a failed question. Those questions stay out of the average. The free page does not list them. The paid report does.

Claude asks with the web search tool (`web_search_20250305` by default, one search, at least 1600 output tokens so the tool result does not crowd out the answer). The checker keeps every text block and takes source URLs from both citation objects and `web_search_tool_result` entries. If that call has no answer text, the turn was paused, or the tool is rejected, a second call without the tool is scored when the same deadline still has time. A rejected key, a timeout, or a 429 is not retried that way. Gemini grounding has to be allowed on the Google AI key. A provider that returns an error is dropped from the average. If the others answer, their answers are still scored. Questions that fail inside an otherwise successful provider are left out of that provider's score. The paid report shows those questions. The free result does not.

### Optional settings

| Env var | Default | What it does |
| --- | --- | --- |
| `PROVIDER_TIMEOUT_MS` | `20000` | Per-call timeout. Claude's search call and its fallback share this deadline. |
| `SCORE_BUDGET_MS` | `35000` | Wall-clock cap for the whole check. Each call uses the shorter of this and `PROVIDER_TIMEOUT_MS`. |
| `PERPLEXITY_429_RETRIES` | `2` | Extra attempts after HTTP 429. Backoff is 1s then 2s, or the `Retry-After` header when it fits the same per-call deadline. |
| `SCORE_PROMPT_COUNT` | `4` | Buyer prompts per provider. Clamped to 3–5. |
| `SCORE_MAX_OUTPUT_TOKENS` | `600` | Output cap. Claude's web search call uses at least 1600 so the tool result does not replace the answer. |
| `SCORE_CACHE_TTL_SEC` | `86400` | How long an identical successful check is reused (24 hours). |
| `RATE_LIMIT_MAX` | `8` | Checks per IP per window. |
| `RATE_LIMIT_WINDOW_SEC` | `3600` | Rate-limit window. |
| `GEMINI_THINKING_BUDGET` | unset | Sent only when set. `0` disables thinking on Gemini models that accept `thinkingBudget`. |

`vercel.json` caps `api/score.js` at 45 seconds. The platform default is longer; the cap is there so a stuck call cannot run for minutes. Four buyer prompts plus one awareness prompt, times four providers, is 20 calls, all in flight together, each limited to about 20 seconds. The page waits up to 40 seconds, then shows a retry. Nothing is filled in when the check does not finish.

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

The free-score limit and the 24-hour cache live in the function instance's memory. On Vercel that memory is not shared across instances, and it disappears when the instance goes cold. A visitor who lands on another instance gets a fresh limit and a fresh check. Treat the in-memory limiter as a basic brake, not a hard global cap. Only successful scores are cached. An outage is not cached. The cache key is `aim:score:v3:` plus a hash of the normalized name, domain, category, city, prompt count, formula version, awareness prompt version, and the configured model names. Formula version 2 and the v3 prefix mean scores cached before the awareness credit are not reused.

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

The page keeps `utm_source`, `utm_campaign`, and `gclid` in `localStorage` under `aim_attribution` and sends them with `POST /api/score`. Payment Links cannot take that metadata, so the checkout URLs are unchanged. GA4 is already on the page as measurement ID `G-P8P36G6MZV`. The free check fires `score_started` when the form is submitted, `generate_lead` when that submit includes an accepted email, `score_completed` with `score_bucket` (`low`, `moderate`, `strong`, or `unavailable`) and no business name when the result renders, and `upsell_click` with `plan` of `report_150` or `tracking_65` on the report and tracking links under the score.

The lead form still posts to the existing Formspree endpoint after the check resolves (including when the score is unavailable). The payload includes the real score, or `unavailable`, plus the stored utm and gclid values. When the score exists and the form included an email address, the same request also sends that score through Resend from `REPORT_FROM_EMAIL`. The message has the score, whether each assistant knows the business, whether it recommends the business, up to three businesses that assistant recommended, one sentence on how the score works, then “Want to see more insights? Get the full report: every answer AI gave, the sources it trusts, and what to fix. $150” and “Or track it monthly for $65/mo”. It does not include the questions, awareness answers, excerpts, or source URLs. The send is awaited so the serverless function can finish it, and a failed send still returns the score. `RESEND_API_KEY` is sending-only. The response may include `emailSent` and a Resend `emailId`. It never includes the answer text.

Every free-score request with an email that passes the same check as the score email is inserted into Supabase `public.free_scores`: email, business name, domain, category, city, score, each assistant's `known` / `mentioned` / `recommends`, `utm_source`, `utm_campaign`, `gclid`, `email_sent`, and `created_at`. The insert is awaited with an 8 second cap. A missing Supabase config, a timeout, or an insert error is logged and does not change the score response. Rows are not cached with the score, so a repeat check from another visitor is a new lead. A project that already ran `supabase/schema.sql` should run `supabase/migrations/free_scores.sql` once. A fresh setup gets the table from `supabase/schema.sql`.

## Paid reports

The free score stays free. Three Stripe Payment Links take payment and return the buyer to `https://ai-mentions.com/report?session_id={CHECKOUT_SESSION_ID}`:

| Product | Price | Link |
| --- | --- | --- |
| Full AI Visibility Report | $150 one-time | `https://buy.stripe.com/cNieVeclZ8MrbkX15ld7q0u` |
| AI Visibility Tracking | $65/month, 3-month minimum | `https://buy.stripe.com/9B63cw71Fe6LfBd4hxd7q0v` |
| Add-on tracking, sold with packages on other network sites | $49/month | `https://buy.stripe.com/6oU5kEclZgeT1Kng0fd7q0w` |

`/report` reads `session_id` and checks the Checkout Session with `STRIPE_RESTRICTED_KEY` (read-only: Checkout Sessions, Customers, and Subscriptions). The session has to be complete and paid. A one-time payment is the $150 report. A subscription is tracking; an amount of $49 is the add-on, and any other subscription amount is the $65 plan. The buyer enters one business. The server runs ChatGPT, Perplexity, and Claude through the same scorer as `/api/score`, stores the report, and returns a private link `/r/<token>`. The same payment cannot run a second business. Opening the checkout page again, or the private link, shows the saved report.

The report on screen includes each assistant's mentions and list rank, answer excerpts, what that assistant knows about the business, competitors named instead, source URLs, and a plain-English "What to do next" list drawn from those results. That detail stays on the private report. It is not in the free score or in `POST /api/score`. Resend emails a summary and the private link to the checkout email. `RESEND_API_KEY` is a sending-only key, and the app only calls `POST https://api.resend.com/emails`. `REPORT_FROM_EMAIL` is `AI Mentions <reports@ai-mentions.com>`. The domain `ai-mentions.com` is verified in Resend. If either email variable is missing, the report is still saved and the page says to keep the link.

Reports, subscribers, report history, and used checkout sessions are stored in Supabase (Postgres). The Vercel project already has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for production and preview. The service key is the new `sb_secret_` key. The server sends that value only in the PostgREST `apikey` header, the same place supabase-js puts a secret key, and never in `Authorization`. It is not a JWT. Supabase maps it to `service_role`. The server reads `SUPABASE_URL` first and falls back to `NEXT_PUBLIC_SUPABASE_URL` for the project URL only. The key is not read by the browser and is not written into the pages. A publishable key in `SUPABASE_SERVICE_ROLE_KEY` is rejected.

Before the first paid report, open the SQL editor and paste `supabase/schema.sql` once. That file is the whole setup: `reports`, `subscribers`, `report_history`, `checkout_sessions`, a short-lived `report_locks` table, and `free_scores` for free-score leads. If `schema.sql` was already applied, run `supabase/migrations/free_scores.sql` once instead of pasting the whole file again. Row level security is enabled and forced, grants for `anon` and `authenticated` are revoked, and there are no policies, so the public Data API cannot read the rows. `service_role` bypasses row level security, which is why the secret key stays on the server. If the tables are missing, the paid endpoints say to run that file and do not pretend a report was saved.

These six names are set on the ai-mentions Vercel project: `STRIPE_RESTRICTED_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `REPORT_FROM_EMAIL`, and `CRON_SECRET`. The app reads those names and no aliases.

Subscribers (the $65 and $49 plans) are stored with email, Stripe subscription id, business, and a `report_history` row per report. Vercel Cron calls `GET /api/cron/reports` daily at 14:00 UTC. The route requires `Authorization: Bearer <CRON_SECRET>`. It runs a subscriber whose last report is at least 30 days old, after Stripe says the subscription is still `active`. Canceled, unpaid, expired, or paused subscriptions are marked inactive and are not checked again. The new email includes the score change since the previous report. A full check can take about a minute, so the default `CRON_BUDGET_MS` of 65000 runs one subscriber per day and leaves the rest for the next day. Raise that value, up to the cron function's 300 second limit, to clear more than one in a run.

Paid reports are not stored in the free-score cache.

### Env vars for paid reports

Set these in Vercel. Do not commit values. Do not put `SUPABASE_SERVICE_ROLE_KEY` in any `NEXT_PUBLIC_` variable or in the browser.

| Env var | Required | What it does |
| --- | --- | --- |
| `STRIPE_RESTRICTED_KEY` | yes | Read-only Stripe key for Checkout Sessions, Customers, and Subscriptions. |
| `SUPABASE_URL` | yes, unless `NEXT_PUBLIC_SUPABASE_URL` is set | Supabase project URL. Injected by the Vercel integration. |
| `NEXT_PUBLIC_SUPABASE_URL` | the URL, if `SUPABASE_URL` is unset | Same project URL. Used only as a fallback. The anon key is not used. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes, already set | Server-only `sb_secret_` key. Sent as the PostgREST `apikey`. Never send it to the browser. |
| `RESEND_API_KEY` | yes, already set | Sending-only Resend key. Used only to send the report email. |
| `REPORT_FROM_EMAIL` | yes, already set | `AI Mentions <reports@ai-mentions.com>`. `ai-mentions.com` is verified in Resend. |
| `CRON_SECRET` | yes, already set | Bearer token Vercel sends on the cron request. The route rejects every call when this is unset. |
| `PUBLIC_BASE_URL` | no | Link host in emails. Default `https://ai-mentions.com`. |
| `CRON_BUDGET_MS` | no | Time budget for the daily job. Default `65000` (one report). |
| `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY` | yes, for a report to run | The paid check uses these three engines. Gemini is not part of the paid report. |

The free score still uses the provider keys, rate limit, and cache documented above.
