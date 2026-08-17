import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionToken,
  getBearerToken,
  hashPassword,
  verifyPassword,
} from '../src/auth.js';

test('creates a bearer token with 64 hexadecimal characters', () => {
  const token = createSessionToken();

  assert.match(token, /^[0-9a-f]{64}$/);
});

test('extracts only a well-formed bearer token', () => {
  assert.equal(getBearerToken(new Request('https://boomcat.test', {
    headers: { Authorization: 'Bearer abc123' },
  })), 'abc123');
  assert.equal(getBearerToken(new Request('https://boomcat.test', {
    headers: { Authorization: 'Basic abc123' },
  })), '');
  assert.equal(getBearerToken(new Request('https://boomcat.test')), '');
});

test('hashes and verifies passwords asynchronously', async () => {
  const hash = await hashPassword('correct horse battery staple');

  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});
