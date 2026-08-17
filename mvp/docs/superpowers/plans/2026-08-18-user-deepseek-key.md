# User DeepSeek API Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user configure a browser-local DeepSeek API key that powers analysis and synthesis requests.

**Architecture:** The browser owns the personal key in `localStorage` and attaches it only to AI requests as `X-DeepSeek-API-Key`. The Pages Function validates the header and passes a selected key to the existing LLM module, which retains `DEEPSEEK_API_KEY` as a fallback. No schema or repository changes are required.

**Tech Stack:** Static HTML/CSS/JavaScript, Cloudflare Pages Functions, Cloudflare Workers, Node test runner.

## Global Constraints

- Support DeepSeek API keys only; API URL and model remain server configured.
- Store the personal key only under `boomcat_deepseek_api_key` in browser `localStorage`.
- Never write, return, or log a personal key.
- Permit only a non-empty header up to 512 characters.
- Preserve fallback to `environment.DEEPSEEK_API_KEY` when the header is absent.

---

### Task 1: Personal-Key Request Boundary

**Files:**
- Modify: `worker/src/index.js:20-62`
- Modify: `worker/test/index.test.js`

**Interfaces:**
- Consumes: request header `X-DeepSeek-API-Key` and `environment.DEEPSEEK_API_KEY`.
- Produces: `configFrom(environment, request)` returning `{ apiKey, apiUrl, model, fetchImpl }`, with a valid header key taking precedence.

- [ ] **Step 1: Write the failing tests**

```js
test('uses a personal DeepSeek key for analysis', async () => {
  let receivedKey = '';
  const worker = createWorker({
    repositoryFactory: () => repository,
    analyze: async ({ config }) => { receivedKey = config.apiKey; return { status: 200, body: {} }; },
  });
  await worker.fetch(new Request('https://app.example.com/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DeepSeek-API-Key': 'personal-key' },
    body: JSON.stringify({ script: 'a'.repeat(10) }),
  }), environment);
  assert.equal(receivedKey, 'personal-key');
});

test('falls back to the configured DeepSeek key', async () => {
  let receivedKey = '';
  const worker = createWorker({
    repositoryFactory: () => repository,
    analyze: async ({ config }) => { receivedKey = config.apiKey; return { status: 200, body: {} }; },
  });
  await worker.fetch(new Request('https://app.example.com/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: 'a'.repeat(10) }),
  }), environment);
  assert.equal(receivedKey, 'test-key');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm.cmd test -- worker/test/index.test.js`
Expected: FAIL because `configFrom` does not receive the request and personal-key precedence is absent.

- [ ] **Step 3: Add header validation and key selection**

```js
function personalApiKey(request) {
  const key = (request.headers.get('X-DeepSeek-API-Key') || '').trim();
  if (key.length > 512) throw Object.assign(new Error('API key is too long'), { status: 400 });
  return key;
}

function configFrom(environment, request, fetchImpl = fetch) {
  return {
    apiKey: personalApiKey(request) || environment.DEEPSEEK_API_KEY,
    apiUrl: environment.API_URL,
    model: environment.MODEL,
    fetchImpl,
  };
}
```

Pass `request` from the analyze and synthesize routes. Add `X-DeepSeek-API-Key` to `Access-Control-Allow-Headers`.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm.cmd test -- worker/test/index.test.js`
Expected: PASS, including existing CORS and authentication behavior.

- [ ] **Step 5: Commit the backend boundary**

```bash
git add worker/src/index.js worker/test/index.test.js
git commit -m "feat: accept personal DeepSeek API keys"
```

### Task 2: Browser Key Settings and AI Headers

**Files:**
- Modify: `frontend/index.html:41-51, 434-441, 588-605, 610-690, 1230-1245`

**Interfaces:**
- Consumes: `localStorage['boomcat_deepseek_api_key']`.
- Produces: `deepSeekHeaders()` for AI requests and settings functions `openApiSettings`, `saveApiKey`, and `clearApiKey`.

- [ ] **Step 1: Write the failing browser-contract test**

Create `worker/test/personal-api-key.test.js` which imports a small extracted module `frontend/deepseek-key.js` and asserts:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- worker/test/personal-api-key.test.js`
Expected: FAIL because `frontend/deepseek-key.js` does not exist.

- [ ] **Step 3: Implement the small browser storage module**

```js
export const DEEPSEEK_KEY_STORAGE = 'boomcat_deepseek_api_key';

export function createDeepSeekHeaders(storage = localStorage) {
  const apiKey = (storage.getItem(DEEPSEEK_KEY_STORAGE) || '').trim();
  return apiKey ? { 'X-DeepSeek-API-Key': apiKey } : {};
}
```

Load this module from the page, add a header key icon and modal with masked input, Save and Clear controls. Save a trimmed non-empty value to `localStorage`; Clear removes it. Merge `createDeepSeekHeaders()` into headers for `/api/analyze` and `/api/synthesize` only.

- [ ] **Step 4: Run the browser-contract test to verify it passes**

Run: `npm.cmd test -- worker/test/personal-api-key.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm.cmd test`
Expected: PASS for all existing Worker, repository, parsing, and frontend API tests.

- [ ] **Step 6: Commit the browser settings**

```bash
git add frontend/index.html frontend/deepseek-key.js worker/test/personal-api-key.test.js
git commit -m "feat: add local DeepSeek key settings"
```

### Task 3: Production Verification

**Files:**
- No source changes.

**Interfaces:**
- Consumes: Cloudflare Pages project `boomcat` and a valid user DeepSeek key supplied interactively in the browser.
- Produces: a production deployment that accepts the new header and keeps personal keys out of D1.

- [ ] **Step 1: Deploy the production branch**

Run: `worker\\node_modules\\.bin\\wrangler.cmd pages deploy frontend --project-name boomcat --branch codex/deploy-production --commit-dirty=true`
Expected: a successful production deployment URL.

- [ ] **Step 2: Verify CORS preflight and header acceptance**

Run: `curl.exe -i -X OPTIONS https://boomcat.pages.dev/api/analyze -H "Origin: https://boomcat.pages.dev" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,x-deepseek-api-key"`
Expected: `204` and `Access-Control-Allow-Headers` containing `X-DeepSeek-API-Key`.

- [ ] **Step 3: Manual user flow**

Open `https://boomcat.pages.dev`, use the key icon to save a valid DeepSeek key, and run an analysis.
Expected: the request succeeds without changing any D1 schema or storing the key in history.

- [ ] **Step 4: Commit any deployment-only correction**

```bash
git status --short
```

Expected: no uncommitted source changes related to this feature.
