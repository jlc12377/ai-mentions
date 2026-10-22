'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../lib/handler');
const { createMemoryCache, createMemoryLimiter } = require('../lib/store');
const { parseOpenAI, parsePerplexity, parseGemini, parseAnthropic, readConfig, runProviders } = require('../lib/providers');
const { buildPrompts } = require('../lib/score');
const { toPublicScore, joinAnd } = require('../lib/free-score');
const { freeScoreEmail } = require('../lib/report-mail');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(payload) {
      this.body = JSON.parse(payload);
    },
  };
}

function invoke(handler, { body, method = 'POST', headers = {} }) {
  const req = {
    method,
    headers,
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = mockRes();
  return handler(req, res).then(() => res);
}

const ANSWER = [
  'Here are companies buyers shortlist:',
  '1. Salesforce',
  '2. HubSpot — inbound CRM',
  '3. Zoho CRM',
].join('\n');

function providerPayload(url) {
  const href = String(url);
  if (href.includes('api.openai.com')) {
    return {
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: ANSWER,
          annotations: [{ type: 'url_citation', url: 'https://www.hubspot.com/crm' }],
        }],
      }],
    };
  }
  if (href.includes('api.perplexity.ai')) {
    return {
      output: [
        { type: 'search_results', results: [{ url: 'https://www.salesforce.com' }, { url: 'https://www.hubspot.com/crm' }] },
        { type: 'message', content: [{ type: 'output_text', text: ANSWER }] },
      ],
    };
  }
  if (href.includes('generativelanguage.googleapis.com')) {
    return {
      candidates: [{
        content: { parts: [{ text: ANSWER }] },
        groundingMetadata: {
          groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding/redirect', domain: 'hubspot.com' } }],
        },
      }],
    };
  }
  if (href.includes('api.anthropic.com')) {
    return {
      content: [{
        type: 'text',
        text: ANSWER,
        citations: [{ type: 'web_search_result_location', url: 'https://blog.hubspot.com/a' }],
      }],
    };
  }
  throw new Error(`unexpected URL ${href}`);
}

function mockFetch(calls) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(providerPayload(url));
      },
    };
  };
}

function setup(env, fetchImpl, extra = {}) {
  return createHandler({
    env,
    fetch: fetchImpl,
    cache: createMemoryCache(),
    limiter: createMemoryLimiter(),
    sleep: async () => {},
    ...extra,
  });
}

const query = {
  businessName: 'HubSpot',
  domain: 'https://www.hubspot.com/products',
  category: 'CRM Software',
  city: 'Austin',
};

test('parsers read grounded provider payloads', () => {
  const openai = parseOpenAI(providerPayload('https://api.openai.com/v1/responses'));
  assert.match(openai.text, /HubSpot/);
  assert.deepEqual(openai.citations, ['https://www.hubspot.com/crm']);

  const perplexity = parsePerplexity(providerPayload('https://api.perplexity.ai/v1/responses'));
  assert.match(perplexity.text, /HubSpot/);
  assert.ok(perplexity.citations.includes('https://www.salesforce.com'));

  const legacy = parsePerplexity({
    choices: [{ message: { content: '1. HubSpot' } }],
    citations: ['https://hubspot.com/a'],
    search_results: [{ url: 'https://example.com' }],
  });
  assert.match(legacy.text, /HubSpot/);
  assert.equal(legacy.citations.length, 2);

  const gemini = parseGemini(providerPayload('https://generativelanguage.googleapis.com'));
  assert.ok(gemini.citations.some((url) => url.includes('hubspot.com')));

  const claude = parseAnthropic(providerPayload('https://api.anthropic.com/v1/messages'));
  assert.ok(claude.citations.includes('https://blog.hubspot.com/a'));
  assert.equal(claude.grounded, true);

  const searched = parseAnthropic({
    stop_reason: 'end_turn',
    content: [
      { type: 'server_tool_use', name: 'web_search', input: { query: 'personal injury lawyers Nashville' } },
      {
        type: 'web_search_tool_result',
        content: [{ type: 'web_search_result', url: 'https://www.example.com/a', title: 'Example' }],
      },
      {
        type: 'text',
        text: '1. Firm A\n2. Morgan & Morgan',
        citations: [{ type: 'web_search_result_location', url: 'https://www.morganandmorgan.com/' }],
      },
    ],
  });
  assert.match(searched.text, /Morgan/);
  assert.ok(searched.citations.includes('https://www.example.com/a'));
  assert.ok(searched.citations.includes('https://www.morganandmorgan.com/'));
  assert.equal(searched.grounded, true);

  const searchFailed = parseAnthropic({
    stop_reason: 'end_turn',
    content: [
      {
        type: 'web_search_tool_result',
        content: { type: 'web_search_tool_result_error', error_code: 'unavailable' },
      },
      { type: 'text', text: '1. HubSpot' },
    ],
  });
  assert.equal(searchFailed.grounded, false);
  assert.match(searchFailed.text, /HubSpot/);

  assert.throws(
    () => parseAnthropic({
      content: [
        { type: 'server_tool_use', name: 'web_search', input: { query: 'crm' } },
        {
          type: 'web_search_tool_result',
          content: [{ type: 'web_search_result', url: 'https://www.example.com/a', title: 'Example' }],
        },
      ],
    }),
    /empty answer/,
  );
});

test('no provider keys returns an unavailable score and does not call anyone', async () => {
  const calls = [];
  const handler = setup({}, mockFetch(calls));
  const res = await invoke(handler, { body: query });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.score, null);
  assert.equal(res.body.unavailable, true);
  assert.equal(res.body.reason, 'no_providers');
  assert.equal(res.body.message, 'Score temporarily unavailable');
  assert.equal(calls.length, 0);
  assert.equal(typeof res.body.score, 'object');
});

test('mocked provider answers produce a real score and grounded requests', async () => {
  const calls = [];
  const handler = setup({
    OPENAI_API_KEY: 'test-openai',
    PERPLEXITY_API_KEY: 'test-perplexity',
    GEMINI_API_KEY: 'test-gemini',
    ANTHROPIC_API_KEY: 'test-anthropic',
    SCORE_PROMPT_COUNT: '4',
  }, mockFetch(calls));
  const res = await invoke(handler, { body: query, headers: { 'x-forwarded-for': '203.0.113.10' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.unavailable, false);
  assert.equal(res.body.score, 92);
  assert.equal(res.body.cached, false);
  assert.equal(res.body.domain, 'hubspot.com');
  assert.equal(res.body.prompts, undefined);
  assert.equal(res.body.formula, undefined);
  assert.equal(res.body.summary, undefined);
  assert.equal(res.body.competitors, undefined);
  assert.equal(res.body.providers.length, 4);
  assert.ok(res.body.providers.every((provider) => provider.answered === true && provider.mentioned === true));
  assert.equal(res.body.providers[0].recommends[0], 'Salesforce');
  assert.ok(res.body.providers.every((provider) => provider.recommends.length <= 3));
  assert.match(res.body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls.length, 16);
  const hidden = JSON.stringify(res.body);
  assert.equal(/excerpt|citations|grounded|https:\/\//.test(hidden), false);
  assert.equal(hidden.includes('What are the best'), false);
  assert.equal(hidden.includes('inbound'), false);

  const openai = calls.find((call) => call.url.includes('api.openai.com'));
  const openaiBody = JSON.parse(openai.options.body);
  assert.equal(openaiBody.model, 'gpt-4.1-mini');
  assert.equal(openaiBody.tools[0].type, 'web_search');
  assert.equal(openaiBody.tools[0].search_context_size, 'low');
  assert.equal(openai.options.headers.Authorization, 'Bearer test-openai');

  const perplexity = calls.find((call) => call.url.includes('api.perplexity.ai'));
  assert.equal(perplexity.url, 'https://api.perplexity.ai/v1/responses');
  const perplexityBody = JSON.parse(perplexity.options.body);
  assert.equal(perplexityBody.model, 'perplexity/sonar');
  assert.equal(perplexityBody.tools[0].type, 'web_search');
  assert.equal(perplexityBody.tools[0].search_type, 'fast');
  assert.equal(perplexityBody.input.includes('HubSpot'), false);

  const gemini = calls.find((call) => call.url.includes('generativelanguage.googleapis.com'));
  const geminiBody = JSON.parse(gemini.options.body);
  assert.deepEqual(geminiBody.tools, [{ google_search: {} }]);
  assert.equal(gemini.options.headers['x-goog-api-key'], 'test-gemini');
  assert.equal(gemini.url.includes('gemini-2.5-flash-lite'), true);

  const claude = calls.find((call) => call.url.includes('api.anthropic.com'));
  const claudeBody = JSON.parse(claude.options.body);
  assert.equal(claudeBody.model, 'claude-haiku-5-5');
  assert.equal(claudeBody.max_tokens, 1600);
  assert.equal(claudeBody.tools[0].type, 'web_search_20250305');
  assert.equal(claudeBody.tools[0].name, 'web_search');
  assert.equal(claudeBody.tools[0].allowed_callers, undefined);
  assert.ok(res.body.providers.every((provider) => provider.checks == null && provider.model == null && provider.error == null));
});

test('a miss is score 0 and a total failure is unavailable, not a fake number', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '1. Salesforce\n2. Zoho CRM' }] }],
        });
      },
    };
  };
  const handler = setup({ OPENAI_API_KEY: 'test-openai', SCORE_PROMPT_COUNT: '3' }, fetchImpl);
  const miss = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software' } });
  assert.equal(miss.statusCode, 200);
  assert.equal(miss.body.score, 0);
  assert.equal(miss.body.unavailable, false);
  assert.equal(miss.body.summary, undefined);
  assert.equal((miss.body.skipped || []).some((row) => row.id === 'gemini' || row.label === 'Gemini'), false);
  assert.ok((miss.body.skipped || []).some((row) => row.id === 'perplexity'));
  assert.equal(miss.body.providers[0].answered, true);
  assert.equal(miss.body.providers[0].mentioned, false);
  assert.deepEqual(miss.body.providers[0].recommends, ['Salesforce', 'Zoho']);

  const failing = setup({ OPENAI_API_KEY: 'test-openai' }, async () => ({
    ok: false,
    status: 401,
    async text() {
      return JSON.stringify({ error: { message: 'Incorrect API key provided: sk-secret' } });
    },
  }));
  const failed = await invoke(failing, { body: { businessName: 'HubSpot', category: 'CRM Software' } });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.score, null);
  assert.equal(failed.body.reason, 'all_failed');
  assert.equal(failed.body.providers[0].answered, false);
  assert.equal(failed.body.providers[0].mentioned, false);
  assert.equal(failed.body.providers[0].error, undefined);
  assert.equal(JSON.stringify(failed.body).includes('sk-secret'), false);
  assert.equal(JSON.stringify(failed.body).includes('HTTP 401'), false);
});

test('one working provider still scores when another provider errors', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('api.openai.com')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            output_text: 'HubSpot is the one I would pick.',
          });
        },
      };
    }
    return { ok: false, status: 500, async text() { return 'no'; } };
  };
  const handler = setup({
    OPENAI_API_KEY: 'test-openai',
    ANTHROPIC_API_KEY: 'test-anthropic',
    SCORE_PROMPT_COUNT: '3',
  }, fetchImpl);
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software', domain: 'hubspot.com' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.score, 35);
  const claude = res.body.providers.find((provider) => provider.id === 'anthropic');
  const chatgpt = res.body.providers.find((provider) => provider.id === 'openai');
  assert.equal(chatgpt.answered, true);
  assert.equal(chatgpt.mentioned, true);
  assert.equal(claude.answered, false);
  assert.equal(claude.mentioned, false);
  assert.equal(claude.score, undefined);
});

test('identical queries are cached and invalid or extra calls are limited', async () => {
  const calls = [];
  const handler = setup({ OPENAI_API_KEY: 'test-openai', RATE_LIMIT_MAX: '2', SCORE_PROMPT_COUNT: '3' }, mockFetch(calls));
  const first = await invoke(handler, { body: query });
  const second = await invoke(handler, {
    body: { businessName: 'hubspot inc', website: 'hubspot.com', category: 'crm software', city: 'Austin' },
  });
  assert.equal(first.body.cached, false);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.cached, true);
  assert.equal(second.body.score, first.body.score);
  assert.equal(second.body.businessName, 'hubspot inc');
  assert.equal(second.body.prompts, undefined);
  assert.equal(JSON.stringify(second.body).includes('inbound'), false);
  assert.equal(calls.length, 3);

  const third = await invoke(handler, { body: query });
  assert.equal(third.statusCode, 429);
  assert.equal(third.body.score, null);
  assert.equal(third.body.reason, 'rate_limited');
  assert.equal(third.body.prompts, undefined);
  assert.equal(calls.length, 3);
});

test('a bare sonar model is sent to /v1/responses, and bad input never calls a provider', async () => {
  const calls = [];
  const handler = setup({
    PERPLEXITY_API_KEY: 'test-perplexity',
    PERPLEXITY_MODEL: 'sonar',
    SCORE_PROMPT_COUNT: '3',
  }, mockFetch(calls));
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software' } });
  assert.equal(res.statusCode, 200);
  assert.ok(calls.every((call) => call.url === 'https://api.perplexity.ai/v1/responses'));
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'perplexity/sonar');
  assert.equal(body.messages, undefined);
  assert.equal(body.input.includes('HubSpot'), false);
  assert.equal(res.body.providers[0].model, undefined);
  assert.equal(res.body.providers[0].answered, true);

  const rejected = await invoke(handler, { body: { businessName: 'H', category: 'CRM Software' } });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.score, null);
  assert.equal(calls.length, 3);

  const wrongMethod = await invoke(handler, { method: 'GET', body: query });
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.body.score, null);
});

function jsonResponse(status, payload, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers || {},
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    },
  };
}

async function runFull(env, fetchImpl, extra = {}) {
  const config = readConfig(env);
  const input = {
    businessName: 'HubSpot',
    domain: 'hubspot.com',
    category: 'CRM Software',
    city: '',
  };
  const prompts = buildPrompts(input.category, input.city, config.promptCount);
  return runProviders(input, prompts, config, fetchImpl, {
    sleep: extra.sleep || (async () => {}),
    now: extra.now,
  });
}

test('perplexity prompts run together and a 429 is retried inside the call', async () => {
  let perplexityInFlight = 0;
  let perplexityMax = 0;
  let openaiInFlight = 0;
  let openaiMax = 0;
  const sleeps = [];
  const attempts = new Map();
  const fetchImpl = async (url, options) => {
    const href = String(url);
    if (href.includes('api.perplexity.ai')) {
      perplexityInFlight += 1;
      perplexityMax = Math.max(perplexityMax, perplexityInFlight);
      const body = JSON.parse(options.body);
      const seen = (attempts.get(body.input) || 0) + 1;
      attempts.set(body.input, seen);
      await new Promise((resolve) => setImmediate(resolve));
      perplexityInFlight -= 1;
      if (seen === 1 && [...attempts.keys()][0] === body.input) {
        return jsonResponse(429, { error: { message: 'Request rate limit exceeded' } }, {
          get(name) { return String(name).toLowerCase() === 'retry-after' ? '1' : ''; },
        });
      }
      return jsonResponse(200, providerPayload(href));
    }
    if (href.includes('api.openai.com')) {
      openaiInFlight += 1;
      openaiMax = Math.max(openaiMax, openaiInFlight);
      await new Promise((resolve) => setImmediate(resolve));
      openaiInFlight -= 1;
    }
    return jsonResponse(200, providerPayload(href));
  };
  const handler = setup({
    OPENAI_API_KEY: 'test-openai',
    PERPLEXITY_API_KEY: 'test-perplexity',
    SCORE_PROMPT_COUNT: '4',
    PERPLEXITY_PROMPT_DELAY_MS: '0',
    PERPLEXITY_429_RETRIES: '2',
  }, fetchImpl, { sleep: async (ms) => { sleeps.push(ms); } });
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software', domain: 'hubspot.com' } });
  assert.equal(res.statusCode, 200);
  assert.equal(perplexityMax, 4);
  assert.ok(openaiMax > 1);
  assert.deepEqual(sleeps, [1000]);
  const perplexity = res.body.providers.find((provider) => provider.id === 'perplexity');
  assert.equal(perplexity.answered, true);
  assert.equal(perplexity.mentioned, true);
  assert.equal(perplexity.checks, undefined);
  assert.equal(res.body.score, 92);
});

test('perplexity 429s that survive the retries are shown and left out of the score', async () => {
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.input.startsWith('What are the best')) {
      return jsonResponse(429, { error: { message: 'Request rate limit exceeded' } });
    }
    return jsonResponse(200, providerPayload(url));
  };
  const handler = setup({
    PERPLEXITY_API_KEY: 'test-perplexity',
    SCORE_PROMPT_COUNT: '4',
    PERPLEXITY_PROMPT_DELAY_MS: '0',
    PERPLEXITY_429_RETRIES: '2',
  }, fetchImpl);
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software', domain: 'hubspot.com' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.score, 92);
  const perplexity = res.body.providers[0];
  assert.equal(perplexity.answered, true);
  assert.equal(perplexity.mentioned, true);
  assert.equal(perplexity.checks, undefined);
  assert.equal(JSON.stringify(res.body).includes('HTTP 429'), false);
  const full = await runFull({
    PERPLEXITY_API_KEY: 'test-perplexity',
    SCORE_PROMPT_COUNT: '4',
    PERPLEXITY_429_RETRIES: '2',
  }, fetchImpl);
  const checks = full.providers[0].checks;
  const failed = checks.filter((check) => !check.ok);
  const succeeded = checks.filter((check) => check.ok);
  assert.equal(failed.length, 1);
  assert.match(failed[0].error, /HTTP 429: Request rate limit exceeded/);
  assert.equal(succeeded.length, 3);
  assert.ok(succeeded.every((check) => check.score === 92));
});

test('all prompts start together and a timed-out call is left out of the score', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    if (String(body.input || '').startsWith('What are the best')) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    return jsonResponse(200, providerPayload(url));
  };
  const handler = setup({
    PERPLEXITY_API_KEY: 'test-perplexity',
    SCORE_PROMPT_COUNT: '4',
    PERPLEXITY_429_RETRIES: '0',
  }, fetchImpl);
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software', domain: 'hubspot.com' } });
  assert.equal(maxInFlight, 4);
  assert.equal(res.body.score, 92);
  assert.equal(res.body.providers[0].answered, true);
  assert.equal(res.body.providers[0].error, undefined);
  const full = await runFull({
    PERPLEXITY_API_KEY: 'test-perplexity',
    SCORE_PROMPT_COUNT: '4',
    PERPLEXITY_429_RETRIES: '0',
  }, fetchImpl);
  const checks = full.providers[0].checks;
  assert.equal(checks.filter((check) => check.ok).length, 3);
  assert.equal(checks.filter((check) => check.error === 'timed out').length, 1);
  assert.equal(full.providers[0].score, 92);
});

test('claude uses search result urls and falls back when web search returns no text', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.tools) {
      return jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [
          { type: 'server_tool_use', name: 'web_search', input: { query: 'crm' } },
          {
            type: 'web_search_tool_result',
            content: [{ type: 'web_search_result', url: 'https://www.example.com/a', title: 'Example' }],
          },
        ],
      });
    }
    return jsonResponse(200, {
      content: [{ type: 'text', text: '1. HubSpot\n2. Salesforce' }],
    });
  };
  const handler = setup({
    ANTHROPIC_API_KEY: 'test-anthropic',
    SCORE_PROMPT_COUNT: '3',
  }, fetchImpl);
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software', domain: 'hubspot.com' } });
  const searches = calls.filter((body) => body.tools);
  const plains = calls.filter((body) => !body.tools);
  assert.equal(searches.length, 3);
  assert.equal(plains.length, 3);
  assert.equal(searches[0].max_tokens, 1600);
  assert.equal(plains[0].max_tokens, 600);
  assert.deepEqual(
    plains.map((body) => body.messages[0].content).sort(),
    searches.map((body) => body.messages[0].content).sort(),
  );
  assert.equal(res.body.score, 70);
  assert.equal(res.body.providers[0].answered, true);
  assert.equal(res.body.providers[0].mentioned, true);
  assert.equal(res.body.providers[0].checks, undefined);
  const full = await runFull({
    ANTHROPIC_API_KEY: 'test-anthropic',
    SCORE_PROMPT_COUNT: '3',
  }, fetchImpl);
  assert.ok(full.providers[0].checks.every((check) => check.ok && check.grounded === false));
});

test('claude falls back when the web search tool is rejected and not when the key is rejected', async () => {
  const rejectedTool = [];
  const toolHandler = setup({
    ANTHROPIC_API_KEY: 'test-anthropic',
    ANTHROPIC_WEB_SEARCH_TOOL: 'web_search_20260318',
    SCORE_PROMPT_COUNT: '3',
  }, async (url, options) => {
    const body = JSON.parse(options.body);
    rejectedTool.push(body);
    if (body.tools) {
      assert.deepEqual(body.tools[0].allowed_callers, ['direct']);
      return jsonResponse(400, { error: { message: 'web_search tool is not available for this key' } });
    }
    return jsonResponse(200, { content: [{ type: 'text', text: 'HubSpot is a CRM.' }] });
  });
  const toolRes = await invoke(toolHandler, { body: { businessName: 'HubSpot', category: 'CRM Software', domain: 'hubspot.com' } });
  assert.equal(rejectedTool.length, 6);
  assert.equal(toolRes.statusCode, 200);
  assert.equal(toolRes.body.score, 35);
  assert.equal(toolRes.body.providers[0].answered, true);
  assert.equal(toolRes.body.providers[0].checks, undefined);
  const toolFull = await runFull({
    ANTHROPIC_API_KEY: 'test-anthropic',
    ANTHROPIC_WEB_SEARCH_TOOL: 'web_search_20260318',
    SCORE_PROMPT_COUNT: '3',
  }, async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools) return jsonResponse(400, { error: { message: 'web_search tool is not available for this key' } });
    return jsonResponse(200, { content: [{ type: 'text', text: 'HubSpot is a CRM.' }] });
  });
  assert.equal(toolFull.providers[0].checks[0].grounded, false);

  let authCalls = 0;
  const authHandler = setup({
    ANTHROPIC_API_KEY: 'test-anthropic',
    SCORE_PROMPT_COUNT: '3',
  }, async () => {
    authCalls += 1;
    return jsonResponse(401, { error: { message: 'invalid x-api-key' } });
  });
  const authRes = await invoke(authHandler, { body: { businessName: 'HubSpot', category: 'CRM Software' } });
  assert.equal(authCalls, 3);
  assert.equal(authRes.body.score, null);
  assert.equal(authRes.body.providers[0].answered, false);
  assert.equal(JSON.stringify(authRes.body).includes('x-api-key'), false);
});

test('a paused claude search with a real answer is kept, and a preamble falls back', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.tools && body.input == null) {
      const prompt = body.messages[0].content;
      if (prompt.startsWith('What are the best')) {
        return jsonResponse(200, {
          stop_reason: 'pause_turn',
          content: [{ type: 'text', text: "I'll search for that." }],
        });
      }
      return jsonResponse(200, {
        stop_reason: 'pause_turn',
        content: [
          {
            type: 'web_search_tool_result',
            content: [{ type: 'web_search_result', url: 'https://www.hubspot.com/crm', title: 'HubSpot' }],
          },
          { type: 'text', text: '1. HubSpot is the CRM buyers shortlist first for inbound teams, agencies, and growing companies.' },
        ],
      });
    }
    return jsonResponse(200, { content: [{ type: 'text', text: '1. HubSpot' }] });
  };
  const handler = setup({
    ANTHROPIC_API_KEY: 'test-anthropic',
    SCORE_PROMPT_COUNT: '3',
  }, fetchImpl);
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software', domain: 'hubspot.com' } });
  const searchCalls = calls.filter((body) => body.tools);
  const plainCalls = calls.filter((body) => !body.tools);
  assert.equal(searchCalls.length, 3);
  assert.equal(plainCalls.length, 1);
  assert.equal(plainCalls[0].messages[0].content.startsWith('What are the best'), true);
  assert.equal(res.body.providers[0].checks, undefined);
  assert.equal(res.body.providers[0].mentioned, true);
  const full = await runFull({
    ANTHROPIC_API_KEY: 'test-anthropic',
    SCORE_PROMPT_COUNT: '3',
  }, fetchImpl);
  const checks = full.providers[0].checks;
  assert.equal(checks[0].grounded, false);
  assert.equal(checks[1].grounded, true);
  assert.equal(checks[1].cited, true);
  assert.equal(checks[2].grounded, true);
});

test('provider timeouts and empty answers are not scored as invisibility', async () => {
  const fetchImpl = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  const handler = setup({ GEMINI_API_KEY: 'test-gemini', SCORE_PROMPT_COUNT: '3' }, fetchImpl);
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software' } });
  assert.equal(res.body.score, null);
  assert.equal(res.body.reason, 'all_failed');
  assert.equal(res.body.providers[0].answered, false);
  assert.equal(res.body.providers[0].error, undefined);
  assert.equal(JSON.stringify(res.body.providers).includes('timed out'), false);

  const empty = setup({ OPENAI_API_KEY: 'test-openai', SCORE_PROMPT_COUNT: '3' }, async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ output: [] }); },
  }));
  const emptyRes = await invoke(empty, { body: { businessName: 'HubSpot', category: 'CRM Software' } });
  assert.equal(emptyRes.body.score, null);
  assert.equal(emptyRes.body.unavailable, true);
});

test('the public score keeps three names and drops gated detail', () => {
  assert.equal(joinAnd(['PR Newswire', 'eReleases']), 'PR Newswire and eReleases');
  assert.equal(joinAnd(['PR Newswire', 'eReleases', 'Business Wire']), 'PR Newswire, eReleases, and Business Wire');
  const rawChecks = [1, 2, 3, 4].map(() => ({
    ok: true,
    mentioned: false,
    names: ['PR Newswire', 'eReleases', 'Business Wire', 'GlobeNewswire'],
  }));
  const pub = toPublicScore({
    ok: true,
    score: 12,
    businessName: 'ACCESS Newswire',
    domain: 'accessnewswire.com',
    prompts: ['What are the best press release distribution services?'],
    formula: { description: '70% mention' },
    summary: { checks: 4 },
    competitors: [{ name: 'PR Newswire' }],
    providers: [{
      id: 'openai',
      label: 'ChatGPT',
      ok: true,
      model: 'gpt-4.1-mini',
      score: 12,
      error: null,
      checks: [{ excerpt: 'a long secret answer', citations: ['https://example.com/a'], prompt: 'secret prompt' }],
      rawChecks,
    }],
  });
  assert.equal(pub.providers[0].recommends.length, 3);
  assert.equal(pub.providers[0].recommends.includes('ACCESS Newswire'), false);
  assert.equal(pub.prompts, undefined);
  assert.equal(pub.formula, undefined);
  const json = JSON.stringify(pub);
  assert.equal(json.includes('secret'), false);
  assert.equal(json.includes('https://'), false);
  assert.equal(json.includes('excerpt'), false);
  const again = toPublicScore(pub);
  assert.deepEqual(again.providers, pub.providers);
});

test('claude search and fallback share one deadline', async () => {
  let clock = 1000;
  const calls = [];
  const fetchImpl = async (url, options) => {
    await new Promise((resolve) => setImmediate(resolve));
    const body = JSON.parse(options.body);
    calls.push(Boolean(body.tools));
    if (body.tools) {
      clock += 20000;
      return jsonResponse(200, {
        stop_reason: 'pause_turn',
        content: [{ type: 'text', text: "I'll search." }],
      });
    }
    return jsonResponse(200, { content: [{ type: 'text', text: '1. HubSpot' }] });
  };
  const full = await runFull({
    ANTHROPIC_API_KEY: 'test-anthropic',
    SCORE_PROMPT_COUNT: '3',
    PROVIDER_TIMEOUT_MS: '20000',
    SCORE_BUDGET_MS: '20000',
  }, fetchImpl, { now: () => clock });
  assert.equal(calls.filter(Boolean).length, 3);
  assert.equal(calls.filter((usedSearch) => !usedSearch).length, 0);
  assert.ok(full.providers[0].checks.every((check) => check.ok && check.grounded === false));
});

test('the free score email is the short result and a failed send still returns the score', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('api.resend.com')) return jsonResponse(200, { id: 'email_free_1' });
    return jsonResponse(200, providerPayload(url));
  };
  const env = {
    OPENAI_API_KEY: 'test-openai',
    RESEND_API_KEY: 're_test',
    REPORT_FROM_EMAIL: '"AI Mentions <reports@ai-mentions.com>"',
    SCORE_PROMPT_COUNT: '3',
  };
  const handler = setup(env, fetchImpl);
  const res = await invoke(handler, { body: { ...query, email: 'delivered@resend.dev' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.score, 92);
  assert.equal(res.body.emailSent, true);
  assert.equal(res.body.emailId, 'email_free_1');
  assert.equal(res.body.prompts, undefined);
  const emailCall = calls.find((call) => call.url.includes('api.resend.com'));
  const email = JSON.parse(emailCall.options.body);
  assert.equal(email.from, 'AI Mentions <reports@ai-mentions.com>');
  assert.equal(email.to[0], 'delivered@resend.dev');
  assert.match(email.text, /HubSpot: 92\/100/);
  assert.match(email.text, /ChatGPT: mentioned/);
  assert.match(email.text, /ChatGPT recommends Salesforce and Zoho\./);
  assert.match(email.text, /Want to see more insights\? Get the full report: every answer AI gave, the sources it trusts, and what to fix\. \$150/);
  assert.match(email.text, /Or track it monthly for \$65\/mo/);
  assert.match(email.text, /https:\/\/buy\.stripe\.com\/cNieVeclZ8MrbkX15ld7q0u/);
  assert.match(email.text, /\$65\/mo/);
  assert.match(email.text, /https:\/\/buy\.stripe\.com\/9B63cw71Fe6LfBd4hxd7q0v/);
  assert.equal(email.text.includes('What are the best'), false);
  assert.equal(email.text.includes('https://www.hubspot.com'), false);
  assert.equal(email.text.includes('inbound'), false);
  assert.equal(calls.filter((call) => call.url.includes('api.openai.com')).length, 3);

  const again = await invoke(handler, { body: { ...query, email: 'delivered@resend.dev' } });
  assert.equal(again.body.cached, true);
  assert.equal(again.body.emailSent, true);
  assert.equal(calls.filter((call) => call.url.includes('api.openai.com')).length, 3);
  assert.equal(calls.filter((call) => call.url.includes('api.resend.com')).length, 2);

  const failing = setup(env, async (url) => {
    if (String(url).includes('api.resend.com')) return jsonResponse(500, { message: 'no' });
    return jsonResponse(200, providerPayload(url));
  });
  const failedMail = await invoke(failing, { body: { businessName: 'Other Co', category: 'CRM Software', email: 'delivered@resend.dev' } });
  assert.equal(failedMail.statusCode, 200);
  assert.equal(failedMail.body.score, 0);
  assert.equal(failedMail.body.emailSent, false);
  assert.equal(failedMail.body.emailReason, 'send_failed');

  const skipped = [];
  const quiet = setup(env, async (url, options) => {
    skipped.push(String(url));
    return fetchImpl(url, options);
  });
  const noEmail = await invoke(quiet, { body: { businessName: 'Quiet Co', category: 'CRM Software', email: 'not-an-email' } });
  assert.equal(noEmail.body.score, 0);
  assert.equal(noEmail.body.emailSent, undefined);
  assert.equal(skipped.some((url) => url.includes('api.resend.com')), false);

  const built = freeScoreEmail({
    to: 'delivered@resend.dev',
    from: 'AI Mentions <reports@ai-mentions.com>',
    score: res.body,
  });
  assert.equal(built.text.includes('https://www.hubspot.com'), false);
});
