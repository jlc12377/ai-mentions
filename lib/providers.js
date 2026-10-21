'use strict';

const { averageScores, judgeAnswer } = require('./score');

const SYSTEM = [
  'Answer a buyer who is comparing specific companies.',
  'When you recommend more than one company, use a numbered list with the company name first on each line.',
  'Keep the answer under 180 words.',
].join(' ');

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readConfig(env) {
  const source = env || {};
  return {
    openaiKey: present(source.OPENAI_API_KEY) ? source.OPENAI_API_KEY.trim() : '',
    openaiModel: collapseEnv(source.OPENAI_MODEL, 'gpt-4.1-mini'),
    perplexityKey: present(source.PERPLEXITY_API_KEY) ? source.PERPLEXITY_API_KEY.trim() : '',
    perplexityModel: collapseEnv(source.PERPLEXITY_MODEL, 'perplexity/sonar'),
    geminiKey: present(source.GEMINI_API_KEY) ? source.GEMINI_API_KEY.trim() : '',
    geminiModel: collapseEnv(source.GEMINI_MODEL, 'gemini-2.5-flash-lite'),
    geminiThinkingBudget: source.GEMINI_THINKING_BUDGET,
    anthropicKey: present(source.ANTHROPIC_API_KEY) ? source.ANTHROPIC_API_KEY.trim() : '',
    anthropicModel: collapseEnv(source.ANTHROPIC_MODEL, 'claude-haiku-5-5'),
    anthropicSearchTool: collapseEnv(source.ANTHROPIC_WEB_SEARCH_TOOL, 'web_search_20250305'),
    timeoutMs: clampInt(source.PROVIDER_TIMEOUT_MS, 20000, 1000, 55000),
    // Tier 0 is 1 request/second. The whole sequence has to finish inside the 60s function cap.
    perplexityBudgetMs: clampInt(source.PERPLEXITY_BUDGET_MS, 50000, 1000, 55000),
    perplexityDelayMs: clampInt(source.PERPLEXITY_PROMPT_DELAY_MS, 1100, 0, 10000),
    perplexityRetries: clampInt(source.PERPLEXITY_429_RETRIES, 2, 0, 4),
    promptCount: clampInt(source.SCORE_PROMPT_COUNT, 4, 3, 5),
    maxOutputTokens: clampInt(source.SCORE_MAX_OUTPUT_TOKENS, 600, 150, 1200),
    rateLimitMax: clampInt(source.RATE_LIMIT_MAX, 8, 1, 100),
    rateLimitWindowSec: clampInt(source.RATE_LIMIT_WINDOW_SEC, 3600, 60, 86400),
    cacheTtlSec: clampInt(source.SCORE_CACHE_TTL_SEC, 86400, 60, 604800),
  };
}

function collapseEnv(value, fallback) {
  if (!present(value)) return fallback;
  return value.trim();
}

class ProviderError extends Error {
  constructor(message, status, retryAfterMs) {
    super(message);
    this.name = 'ProviderError';
    this.status = status || 0;
    this.retryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : null;
  }
}

function safeHttpError(status, bodyText) {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.error?.status || parsed?.message || '';
  } catch {
    detail = '';
  }
  detail = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (/sk-|api[_-]?key|bearer |AIza/i.test(detail)) detail = '';
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

function headerValue(response, name) {
  const headers = response && response.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || '';
  }
  return headers[name] || headers[name.toLowerCase()] || '';
}

function parseRetryAfter(response) {
  const raw = String(headerValue(response, 'retry-after') || '').trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new ProviderError(safeHttpError(response.status, text), response.status, parseRetryAfter(response));
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('invalid JSON response');
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new ProviderError('timed out');
    }
    throw new ProviderError('request failed');
  } finally {
    clearTimeout(timer);
  }
}

function parseOpenAI(data) {
  const citations = [];
  const parts = [];
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) parts.push(part.text);
      for (const annotation of part?.annotations || []) {
        if (annotation?.url) citations.push(annotation.url);
      }
    }
    for (const source of item?.action?.sources || []) {
      if (source?.url) citations.push(source.url);
    }
  }
  if (!parts.length && typeof data?.output_text === 'string') parts.push(data.output_text);
  const text = parts.join('\n').trim();
  if (!text) throw new ProviderError('empty answer');
  return { text, citations };
}

function parsePerplexity(data) {
  const citations = [];
  const parts = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === 'string' && part.text.trim()) parts.push(part.text);
      for (const annotation of part?.annotations || []) {
        if (annotation?.url) citations.push(annotation.url);
      }
    }
    const results = item?.results || item?.search_results || [];
    if (item?.type === 'search_results' || Array.isArray(item?.results)) {
      for (const result of results) {
        if (result?.url) citations.push(result.url);
      }
    }
  }
  const legacy = data?.choices?.[0]?.message?.content;
  if (!parts.length && typeof legacy === 'string') parts.push(legacy);
  for (const citation of data?.citations || []) {
    if (typeof citation === 'string') citations.push(citation);
  }
  for (const result of data?.search_results || []) {
    if (result?.url) citations.push(result.url);
  }
  if (!parts.length && typeof data?.output_text === 'string') parts.push(data.output_text);
  const text = parts.join('\n').trim();
  if (!text) throw new ProviderError('empty answer');
  return { text, citations };
}

function parseGemini(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .filter((part) => typeof part?.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('\n')
    .trim();
  const citations = [];
  for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
    const web = chunk?.web || {};
    if (web.uri) citations.push(web.uri);
    if (web.domain) citations.push(`https://${String(web.domain).replace(/^www\./, '')}`);
  }
  if (!text) {
    const reason = candidate?.finishReason || data?.promptFeedback?.blockReason || 'empty answer';
    throw new ProviderError(String(reason).slice(0, 180));
  }
  return { text, citations };
}

function citationUrl(citation) {
  if (!citation) return '';
  if (typeof citation === 'string') return citation;
  if (typeof citation.url === 'string') return citation.url;
  if (typeof citation.source === 'string') return citation.source;
  if (citation.source && typeof citation.source.url === 'string') return citation.source.url;
  return '';
}

function collectSearchResult(result, citations) {
  if (!result || typeof result !== 'object') return false;
  if (result.type === 'web_search_tool_result_error' || result.error_code) return true;
  const url = result.url || result.uri;
  if (typeof url === 'string' && url) citations.push(url);
  return false;
}

function collectAnthropic(data) {
  const citations = [];
  const searchCitations = [];
  const parts = [];
  let searchError = false;
  const blocks = Array.isArray(data?.content) ? data.content : [];
  if (!blocks.length && typeof data?.content === 'string' && data.content.trim()) {
    parts.push(data.content);
  }
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const isText = block.type === 'text' || block.type === 'output_text';
    if (isText && typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text);
      for (const citation of block.citations || []) {
        const url = citationUrl(citation);
        if (url) citations.push(url);
      }
    }
    if (block.type !== 'web_search_tool_result') continue;
    const content = block.content;
    if (Array.isArray(content)) {
      for (const result of content) {
        if (collectSearchResult(result, searchCitations)) searchError = true;
      }
    } else if (collectSearchResult(content, searchCitations)) {
      searchError = true;
    }
  }
  return {
    text: parts.join('\n').trim(),
    citations: citations.concat(searchCitations),
    searchError,
    stopReason: typeof data?.stop_reason === 'string' ? data.stop_reason : '',
  };
}

function parseAnthropic(data) {
  const collected = collectAnthropic(data);
  if (!collected.text) throw new ProviderError('empty answer');
  return {
    text: collected.text,
    citations: collected.citations,
    grounded: collected.stopReason !== 'pause_turn' && !collected.searchError,
  };
}

function jsonHeaders(headers) {
  return { 'Content-Type': 'application/json', ...headers };
}

async function askOpenAI(prompt, config, fetchImpl) {
  const data = await fetchJson(fetchImpl, 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: jsonHeaders({ Authorization: `Bearer ${config.openaiKey}` }),
    body: JSON.stringify({
      model: config.openaiModel,
      instructions: SYSTEM,
      input: prompt,
      max_output_tokens: config.maxOutputTokens,
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      tool_choice: 'required',
    }),
  }, config.timeoutMs);
  return parseOpenAI(data);
}

function perplexityRequestModel(model) {
  const name = String(model || '').trim();
  if (!name) return 'perplexity/sonar';
  return name.includes('/') ? name : `perplexity/${name}`;
}

function remainingMs(deadline, now) {
  return deadline - now();
}

async function askPerplexity(prompt, config, fetchImpl, options = {}) {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Number.isFinite(options.deadline) ? options.deadline : now() + config.timeoutMs;
  const retries = config.perplexityRetries;
  const body = JSON.stringify({
    model: perplexityRequestModel(config.perplexityModel),
    instructions: SYSTEM,
    input: prompt,
    max_output_tokens: config.maxOutputTokens,
    tools: [{ type: 'web_search', search_type: 'fast', max_results: 5 }],
  });
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const budgetLeft = remainingMs(deadline, now);
    if (budgetLeft < 1000) throw lastError || new ProviderError('timed out');
    try {
      const data = await fetchJson(fetchImpl, 'https://api.perplexity.ai/v1/responses', {
        method: 'POST',
        headers: jsonHeaders({ Authorization: `Bearer ${config.perplexityKey}` }),
        body,
      }, Math.min(config.timeoutMs, budgetLeft));
      return parsePerplexity(data);
    } catch (error) {
      lastError = error instanceof ProviderError ? error : new ProviderError('request failed');
      const canRetry = lastError.status === 429 && attempt < retries;
      if (!canRetry) throw lastError;
      const backoff = lastError.retryAfterMs != null ? lastError.retryAfterMs : 1000 * (2 ** attempt);
      if (remainingMs(deadline, now) - backoff < 1000) throw lastError;
      await sleep(backoff);
    }
  }
  throw lastError || new ProviderError('request failed');
}

async function askGemini(prompt, config, fetchImpl) {
  const generationConfig = {
    maxOutputTokens: config.maxOutputTokens,
    temperature: 1,
  };
  if (present(config.geminiThinkingBudget)) {
    const budget = Number.parseInt(config.geminiThinkingBudget, 10);
    if (Number.isFinite(budget)) generationConfig.thinkingConfig = { thinkingBudget: budget };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const data = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: jsonHeaders({ 'x-goog-api-key': config.geminiKey }),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig,
    }),
  }, config.timeoutMs);
  return parseGemini(data);
}

function anthropicTool(config) {
  const tool = {
    type: config.anthropicSearchTool,
    name: 'web_search',
    max_uses: 1,
  };
  // Newer web search versions default to code execution. Haiku needs a direct call.
  if (config.anthropicSearchTool !== 'web_search_20250305') {
    tool.allowed_callers = ['direct'];
  }
  return tool;
}

function anthropicSearchUnavailable(error) {
  if (!(error instanceof ProviderError)) return false;
  if (error.status === 401 || error.status === 429) return false;
  if (error.message === 'timed out' || error.message === 'request failed') return false;
  if (error.status === 400 || error.status === 403 || error.status === 404) {
    return /search|tool|usage|credit|permission|unavailable/i.test(error.message);
  }
  return false;
}

async function postAnthropic(prompt, config, fetchImpl, withSearch) {
  const body = {
    model: config.anthropicModel,
    max_tokens: withSearch ? Math.max(config.maxOutputTokens, 1600) : config.maxOutputTokens,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  };
  if (withSearch) body.tools = [anthropicTool(config)];
  return fetchJson(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: jsonHeaders({
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    }),
    body: JSON.stringify(body),
  }, config.timeoutMs);
}

function anthropicAnswer(collected, grounded) {
  return {
    text: collected.text,
    citations: collected.citations,
    grounded,
  };
}

async function askAnthropic(prompt, config, fetchImpl) {
  let collected = null;
  try {
    const data = await postAnthropic(prompt, config, fetchImpl, true);
    collected = collectAnthropic(data);
    // pause_turn with only a short preamble means the search turn was cut off.
    const paused = collected.stopReason === 'pause_turn' && collected.text.length < 80;
    if (collected.text && !paused) return anthropicAnswer(collected, !collected.searchError);
  } catch (error) {
    if (!anthropicSearchUnavailable(error)) throw error;
  }

  try {
    const plain = await postAnthropic(prompt, config, fetchImpl, false);
    const fallback = collectAnthropic(plain);
    if (fallback.text) return anthropicAnswer(fallback, false);
  } catch (error) {
    if (collected && collected.text) return anthropicAnswer(collected, false);
    throw error;
  }
  if (collected && collected.text) return anthropicAnswer(collected, false);
  throw new ProviderError('empty answer');
}

const PROVIDERS = [
  {
    id: 'openai',
    label: 'ChatGPT',
    mode: 'web_search',
    configured: (config) => Boolean(config.openaiKey),
    model: (config) => config.openaiModel,
    ask: askOpenAI,
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    mode: 'sonar',
    configured: (config) => Boolean(config.perplexityKey),
    model: (config) => perplexityRequestModel(config.perplexityModel),
    ask: askPerplexity,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    mode: 'google_search',
    configured: (config) => Boolean(config.geminiKey),
    model: (config) => config.geminiModel,
    ask: askGemini,
  },
  {
    id: 'anthropic',
    label: 'Claude',
    mode: 'web_search',
    configured: (config) => Boolean(config.anthropicKey),
    model: (config) => config.anthropicModel,
    ask: askAnthropic,
  },
];

function toPublicCheck(check) {
  if (!check.ok) {
    return {
      prompt: check.prompt,
      ok: false,
      mentioned: false,
      position: null,
      cited: false,
      score: null,
      excerpt: '',
      citations: [],
      error: check.error || 'no answer',
      grounded: false,
    };
  }
  return {
    prompt: check.prompt,
    ok: true,
    mentioned: check.mentioned,
    position: check.position,
    cited: check.cited,
    score: check.score,
    excerpt: check.excerpt,
    citations: check.citations,
    error: null,
    grounded: check.grounded !== false,
  };
}

async function runCheck(provider, prompt, input, config, fetchImpl, askOptions) {
  try {
    const answer = await provider.ask(prompt, config, fetchImpl, askOptions);
    const judged = judgeAnswer(answer, input);
    return { prompt, ok: true, ...judged, grounded: answer.grounded !== false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    return { prompt, ok: false, error: message };
  }
}

async function runPromptBatch(provider, prompts, input, config, fetchImpl, options) {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (provider.id !== 'perplexity') {
    return Promise.all(prompts.map((prompt) => runCheck(provider, prompt, input, config, fetchImpl)));
  }

  const deadline = now() + config.perplexityBudgetMs;
  const checks = [];
  for (let index = 0; index < prompts.length; index += 1) {
    if (index > 0 && config.perplexityDelayMs > 0) {
      const wait = Math.min(config.perplexityDelayMs, remainingMs(deadline, now) - 1000);
      if (wait > 0) await sleep(wait);
    }
    if (remainingMs(deadline, now) < 1000) {
      checks.push({ prompt: prompts[index], ok: false, error: 'timed out' });
      continue;
    }
    checks.push(await runCheck(provider, prompts[index], input, config, fetchImpl, {
      sleep,
      now,
      deadline,
    }));
  }
  return checks;
}

async function runProviders(input, prompts, config, fetchImpl, options = {}) {
  const roster = Array.isArray(options.onlyIds) && options.onlyIds.length
    ? PROVIDERS.filter((provider) => options.onlyIds.includes(provider.id))
    : PROVIDERS;
  const active = roster.filter((provider) => provider.configured(config));
  const skipped = roster
    .filter((provider) => !provider.configured(config))
    .map((provider) => ({ id: provider.id, label: provider.label, reason: 'no_api_key' }));

  const providers = await Promise.all(active.map(async (provider) => {
    const checks = await runPromptBatch(provider, prompts, input, config, fetchImpl, options);
    const good = checks.filter((check) => check.ok);
    if (!good.length) {
      console.error(`score ${provider.id} failed: ${checks[0]?.error || 'no answer'}`);
    }
    return {
      id: provider.id,
      label: provider.label,
      model: provider.model(config),
      mode: provider.mode,
      ok: good.length > 0,
      score: good.length ? averageScores(good.map((check) => check.score)) : null,
      error: good.length ? null : (checks[0]?.error || 'no answer'),
      checks: checks.map(toPublicCheck),
      names: good.flatMap((check) => (check.names || []).map((name) => ({ prompt: check.prompt, name }))),
      rawChecks: good,
    };
  }));

  return { providers, skipped };
}

module.exports = {
  SYSTEM,
  PROVIDERS,
  ProviderError,
  readConfig,
  parseOpenAI,
  parsePerplexity,
  parseGemini,
  parseAnthropic,
  collectAnthropic,
  safeHttpError,
  runProviders,
  toPublicCheck,
};
