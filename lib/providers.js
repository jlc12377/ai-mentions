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
  constructor(message) {
    super(message);
    this.name = 'ProviderError';
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

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new ProviderError(safeHttpError(response.status, text));
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

function parseAnthropic(data) {
  const citations = [];
  const parts = [];
  for (const block of data?.content || []) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text);
      for (const citation of block.citations || []) {
        if (citation?.url) citations.push(citation.url);
      }
    }
  }
  const text = parts.join('\n').trim();
  if (!text) throw new ProviderError('empty answer');
  return { text, citations };
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

async function askPerplexity(prompt, config, fetchImpl) {
  const model = config.perplexityModel;
  const useAgent = model.includes('/');
  const url = useAgent
    ? 'https://api.perplexity.ai/v1/agent'
    : 'https://api.perplexity.ai/chat/completions';
  const body = useAgent
    ? {
      model,
      instructions: SYSTEM,
      input: prompt,
      max_output_tokens: config.maxOutputTokens,
      tools: [{ type: 'web_search', search_type: 'fast', max_results: 5 }],
    }
    : {
      model,
      max_tokens: config.maxOutputTokens,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
    };
  const data = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: jsonHeaders({ Authorization: `Bearer ${config.perplexityKey}` }),
    body: JSON.stringify(body),
  }, config.timeoutMs);
  return parsePerplexity(data);
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

async function askAnthropic(prompt, config, fetchImpl) {
  const data = await fetchJson(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: jsonHeaders({
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    }),
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: config.maxOutputTokens,
      system: SYSTEM,
      tools: [{
        type: config.anthropicSearchTool,
        name: 'web_search',
        max_uses: 1,
      }],
      messages: [{ role: 'user', content: prompt }],
    }),
  }, config.timeoutMs);
  return parseAnthropic(data);
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
    model: (config) => config.perplexityModel,
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
  };
}

async function runProviders(input, prompts, config, fetchImpl) {
  const active = PROVIDERS.filter((provider) => provider.configured(config));
  const skipped = PROVIDERS
    .filter((provider) => !provider.configured(config))
    .map((provider) => ({ id: provider.id, label: provider.label, reason: 'no_api_key' }));

  const providers = await Promise.all(active.map(async (provider) => {
    const checks = await Promise.all(prompts.map(async (prompt) => {
      try {
        const answer = await provider.ask(prompt, config, fetchImpl);
        const judged = judgeAnswer(answer, input);
        return { prompt, ok: true, ...judged };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'request failed';
        return { prompt, ok: false, error: message };
      }
    }));
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
  safeHttpError,
  runProviders,
  toPublicCheck,
};
