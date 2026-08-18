import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../src/index.js';

function repository() {
  const users = [];
  const sessions = [];
  return {
    findExistingUsername: async (name) => users.some((user) => user.nickname === name),
    createUser: async (nickname, password_hash) => {
      const id = users.length + 1;
      users.push({ id, nickname, password_hash, api_key: '' });
      return id;
    },
    createSession: async (token, user_id) => sessions.push({ token, user_id }),
    findUserByNickname: async (nickname) => users.find((user) => user.nickname === nickname),
    findSessionUser: async (token) => {
      const session = sessions.find((item) => item.token === token);
      return session ? { user_id: session.user_id } : null;
    },
    findUserById: async (id) => users.find((user) => user.id === id),
    getApiKey: async (userId) => (users.find((user) => user.id === userId)?.api_key || '').trim(),
    setApiKey: async (userId, apiKey) => { const user = users.find((item) => item.id === userId); if (user) user.api_key = apiKey; },
    clearApiKey: async (userId) => { const user = users.find((item) => item.id === userId); if (user) user.api_key = ''; },
    deleteSession: async (token) => sessions.splice(sessions.findIndex((item) => item.token === token), 1),
    listHistory: async () => [],
    saveHistory: async () => {},
    deleteHistory: async () => {},
  };
}

const environment = { DB: {}, DEEPSEEK_API_KEY: 'test-key', ALLOWED_ORIGINS: 'https://app.example.com' };

test('registers a user and returns a bearer token', async () => {
  const worker = createWorker({ repositoryFactory: () => repository() });
  const response = await worker.fetch(new Request('https://app.example.com/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'tester', password: 'password' }),
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.example.com' },
  }), environment);

  assert.equal(response.status, 200);
  assert.match((await response.json()).token, /^[0-9a-f]{64}$/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('returns CORS headers for an allowed origin', async () => {
  const worker = createWorker({ repositoryFactory: () => repository() });
  const response = await worker.fetch(new Request('https://app.example.com/api/me', {
    headers: { Origin: 'https://app.example.com' },
  }), environment);

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://app.example.com');
});

test('returns CORS headers for a wildcard-origin match', async () => {
  const wildcardEnvironment = { ...environment, ALLOWED_ORIGINS: 'https://*.boomcat.pages.dev' };
  const worker = createWorker({ repositoryFactory: () => repository() });
  const response = await worker.fetch(new Request('https://app.example.com/api/me', {
    headers: { Origin: 'https://abc123.boomcat.pages.dev' },
  }), wildcardEnvironment);

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://abc123.boomcat.pages.dev');
});

test('omits CORS headers for a non-matching origin', async () => {
  const worker = createWorker({ repositoryFactory: () => repository() });
  const response = await worker.fetch(new Request('https://app.example.com/api/me', {
    headers: { Origin: 'https://evil.example.com' },
  }), environment);

  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('uses a personal DeepSeek key for analysis', async () => {
  let receivedKey = '';
  const worker = createWorker({
    repositoryFactory: () => repository(),
    analyze: async ({ config }) => { receivedKey = config.apiKey; return { status: 200, body: {} }; },
  });
  await worker.fetch(new Request('https://app.example.com/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DeepSeek-API-Key': 'personal-key' },
    body: JSON.stringify({ script: 'a'.repeat(10) }),
  }), environment);
  assert.equal(receivedKey, 'personal-key');
});

test('leaves the API key empty when no personal key is set', async () => {
  let receivedKey = 'unset';
  const worker = createWorker({
    repositoryFactory: () => repository(),
    analyze: async ({ config }) => { receivedKey = config.apiKey; return { status: 200, body: {} }; },
  });
  await worker.fetch(new Request('https://app.example.com/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: 'a'.repeat(10) }),
  }), environment);
  assert.equal(receivedKey, '');
});

test('rejects an oversized personal DeepSeek key', async () => {
  const worker = createWorker({ repositoryFactory: () => repository() });
  const response = await worker.fetch(new Request('https://app.example.com/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DeepSeek-API-Key': 'x'.repeat(513) },
    body: JSON.stringify({ script: 'a'.repeat(10) }),
  }), environment);
  assert.equal(response.status, 400);
});

test('allows the personal key header in CORS preflight', async () => {
  const worker = createWorker({ repositoryFactory: () => repository() });
  const response = await worker.fetch(new Request('https://app.example.com/api/analyze', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-deepseek-api-key',
    },
  }), environment);
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /X-DeepSeek-API-Key/);
});

test('saves, retrieves and clears a DeepSeek API key on the account', async () => {
  const repo = repository();
  const worker = createWorker({ repositoryFactory: () => repo });
  const register = await worker.fetch(new Request('https://app.example.com/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'keyuser', password: 'password' }),
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.example.com' },
  }), environment);
  const { token } = await register.json();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const save = await worker.fetch(new Request('https://app.example.com/api/apikey', {
    method: 'POST', headers, body: JSON.stringify({ key: 'sk-test-1234' }),
  }), environment);
  assert.equal(save.status, 200);

  const get = await worker.fetch(new Request('https://app.example.com/api/apikey', { headers }), environment);
  const body = await get.json();
  assert.equal(get.status, 200);
  assert.equal(body.hasKey, true);
  assert.equal(body.key, 'sk-test-1234');

  const del = await worker.fetch(new Request('https://app.example.com/api/apikey', { method: 'DELETE', headers }), environment);
  assert.equal(del.status, 200);

  const after = await worker.fetch(new Request('https://app.example.com/api/apikey', { headers }), environment);
  assert.equal((await after.json()).hasKey, false);
});

test('rejects saving an API key without auth', async () => {
  const worker = createWorker({ repositoryFactory: () => repository() });
  const res = await worker.fetch(new Request('https://app.example.com/api/apikey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'sk-test' }),
  }), environment);
  assert.equal(res.status, 401);
});
