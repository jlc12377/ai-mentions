'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../lib/handler');
const { createMemoryCache, createMemoryLimiter } = require('../lib/store');
const { parseOpenAI, parsePerplexity, parseGemini, parseAnthropic } = require('../lib/providers');

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
  assert.equal(res.body.prompts.length, 4);
  assert.equal(res.body.prompts.some((prompt) => /hubspot/i.test(prompt)), false);
  assert.equal(res.body.providers.length, 4);
  assert.deepEqual(res.body.providers.map((provider) => provider.score), [92, 92, 92, 92]);
  assert.equal(res.body.summary.mentions, 16);
  assert.equal(res.body.summary.citations, 16);
  assert.equal(res.body.competitors[0].name, 'Salesforce');
  assert.match(res.body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls.length, 16);

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
  assert.equal(res.body.providers.every((provider) => provider.checks.every((check) => check.grounded === true)), true);
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
  assert.equal(miss.body.summary.mentions, 0);
  assert.equal((miss.body.skipped || []).some((row) => row.id === 'gemini' || row.label === 'Gemini'), false);
  assert.ok((miss.body.skipped || []).some((row) => row.id === 'perplexity'));
  assert.deepEqual(miss.body.competitors.map((row) => row.name), ['Salesforce', 'Zoho']);

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
  assert.equal(failed.body.providers[0].ok, false);
  assert.equal(failed.body.providers[0].error.includes('sk-secret'), false);
  assert.match(failed.body.providers[0].error, /HTTP 401/);
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
  assert.equal(chatgpt.ok, true);
  assert.equal(claude.ok, false);
  assert.equal(claude.score, null);
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
  assert.equal(calls.length, 3);

  const third = await invoke(handler, { body: query });
  assert.equal(third.statusCode, 429);
  assert.equal(third.body.score, null);
  assert.equal(third.body.reason, 'rate_limited');
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
  assert.equal(res.body.providers[0].model, 'perplexity/sonar');

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

test('perplexity prompts run one at a time and a 429 is retried', async () => {
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
  assert.equal(perplexityMax, 1);
  assert.ok(openaiMax > 1);
  assert.deepEqual(sleeps, [1000]);
  const perplexity = res.body.providers.find((provider) => provider.id === 'perplexity');
  assert.equal(perplexity.ok, true);
  assert.equal(perplexity.score, 92);
  assert.equal(perplexity.checks.every((check) => check.ok), true);
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
  assert.equal(perplexity.ok, true);
  assert.equal(perplexity.score, 92);
  const failed = perplexity.checks.filter((check) => !check.ok);
  const succeeded = perplexity.checks.filter((check) => check.ok);
  assert.equal(failed.length, 1);
  assert.match(failed[0].error, /HTTP 429: Request rate limit exceeded/);
  assert.equal(succeeded.length, 3);
  assert.ok(succeeded.every((check) => check.score === 92));
});

test('perplexity stops prompts that do not fit in the budget', async () => {
  let clock = 0;
  const calls = [];
  const fetchImpl = async (url) => {
    clock += 400;
    calls.push(String(url));
    return jsonResponse(200, providerPayload(url));
  };
  const handler = setup({
    PERPLEXITY_API_KEY: 'test-perplexity',
    SCORE_PROMPT_COUNT: '4',
    PERPLEXITY_BUDGET_MS: '1500',
    PERPLEXITY_PROMPT_DELAY_MS: '0',
    PERPLEXITY_429_RETRIES: '0',
  }, fetchImpl, { now: () => clock });
  const res = await invoke(handler, { body: { businessName: 'HubSpot', category: 'CRM Software', domain: 'hubspot.com' } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url === 'https://api.perplexity.ai/v1/responses'));
  const checks = res.body.providers[0].checks;
  assert.equal(checks[0].ok, true);
  assert.equal(checks[1].ok, true);
  assert.equal(checks[2].ok, false);
  assert.equal(checks[2].error, 'timed out');
  assert.equal(checks[3].error, 'timed out');
  assert.equal(res.body.score, 92);
  assert.equal(res.body.providers[0].ok, true);
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
  const claude = res.body.providers[0];
  assert.equal(claude.ok, true);
  assert.equal(claude.score, 70);
  assert.ok(claude.checks.every((check) => check.ok && check.grounded === false));
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
  assert.equal(toolRes.body.providers[0].checks[0].grounded, false);

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
  assert.match(authRes.body.providers[0].error, /HTTP 401/);
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
  const checks = res.body.providers[0].checks;
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
  assert.match(res.body.providers[0].error, /timed out/);

  const empty = setup({ OPENAI_API_KEY: 'test-openai', SCORE_PROMPT_COUNT: '3' }, async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ output: [] }); },
  }));
  const emptyRes = await invoke(empty, { body: { businessName: 'HubSpot', category: 'CRM Software' } });
  assert.equal(emptyRes.body.score, null);
  assert.equal(emptyRes.body.unavailable, true);
});
