import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiUrl } from '../../frontend/api-config.js';

test('keeps production API calls same-origin by default', () => {
  assert.equal(createApiUrl('/api/login', ''), '/api/login');
});

test('prefixes API calls with a configured Worker origin', () => {
  assert.equal(createApiUrl('/api/login', 'https://api.example.com/'), 'https://api.example.com/api/login');
});
