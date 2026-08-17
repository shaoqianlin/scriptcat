import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekHeaders } from '../../frontend/deepseek-key.js';

test('adds a saved key only to DeepSeek request headers', () => {
  const storage = new Map([['boomcat_deepseek_api_key', 'personal-key']]);
  const headers = createDeepSeekHeaders({
    getItem: (key) => storage.get(key) || null,
  });
  assert.deepEqual(headers, { 'X-DeepSeek-API-Key': 'personal-key' });
});

test('returns no personal-key header when no key is saved', () => {
  assert.deepEqual(createDeepSeekHeaders({ getItem: () => null }), {});
});
