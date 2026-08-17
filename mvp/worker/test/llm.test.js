import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScript, synthesizeAnalyses } from '../src/llm.js';

test('rejects analysis input shorter than ten characters', async () => {
  const result = await analyzeScript({ script: '太短' });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, '内容太短了～至少10个字');
});

test('parses a DeepSeek analysis response and marks deep scripts', async () => {
  const result = await analyzeScript({
    script: 'a'.repeat(200),
    config: {
      apiKey: 'test-key',
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: '{"whyViral":"because"}' } }],
      }), { status: 200 }),
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.level, 'deep');
  assert.equal(result.body.whyViral, 'because');
  assert.equal(result.body.original, 'a'.repeat(200));
});

test('maps an upstream timeout to a gateway timeout response', async () => {
  const result = await analyzeScript({
    script: 'a'.repeat(10),
    config: {
      apiKey: 'test-key',
      timeoutMs: 1,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    },
  });

  assert.equal(result.status, 504);
});

test('requires two analyses for synthesis', async () => {
  const result = await synthesizeAnalyses({ analyses: [] });

  assert.equal(result.status, 400);
});
