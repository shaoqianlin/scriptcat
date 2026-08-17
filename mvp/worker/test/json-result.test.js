import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonResult, repairJson } from '../src/json-result.js';

test('extracts JSON wrapped in a markdown code fence', () => {
  assert.deepEqual(parseJsonResult('```json\n{"ok":true}\n```'), { ok: true });
});

test('repairs truncated JSON by closing arrays and objects', () => {
  assert.deepEqual(repairJson('{"items":[1,2'), { items: [1, 2] });
});
