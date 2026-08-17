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
      users.push({ id, nickname, password_hash });
      return id;
    },
    createSession: async (token, user_id) => sessions.push({ token, user_id }),
    findUserByNickname: async (nickname) => users.find((user) => user.nickname === nickname),
    findSessionUser: async (token) => {
      const session = sessions.find((item) => item.token === token);
      return session ? { user_id: session.user_id } : null;
    },
    findUserById: async (id) => users.find((user) => user.id === id),
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
