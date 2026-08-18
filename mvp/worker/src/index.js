const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 3) + '••••' + key.slice(-4);
}

function allowedOrigins(environment) {
  return String(environment.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originMatches(origin, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(origin);
}

function corsHeaders(request, environment) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(environment).some((pattern) => originMatches(origin, pattern))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-DeepSeek-API-Key',
    'Vary': 'Origin',
  };
}

function unauthorized(message = '未登录') {
  return json({ error: message }, 401);
}

async function requestBody(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 500 * 1024) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  return request.json();
}

async function requireUser(request, repository) {
  const value = request.headers.get('Authorization') || '';
  const token = value.startsWith('Bearer ') ? value.slice(7).trim() : '';
  if (!token) return { response: unauthorized(), token: '' };
  const session = await repository.findSessionUser(token);
  if (!session) return { response: unauthorized('登录已失效，请重新登录'), token };
  return { userId: session.user_id, token };
}

function configFrom(environment, request, fetchImpl = fetch) {
  const personalKey = (request.headers.get('X-DeepSeek-API-Key') || '').trim();
  if (personalKey.length > 512) throw Object.assign(new Error('API key is too long'), { status: 400 });
  return {
    apiKey: personalKey,
    apiUrl: environment.API_URL,
    model: environment.MODEL,
    fetchImpl,
  };
}

export function createWorker({ repositoryFactory, analyze = null, synthesize = null } = {}) {
  return {
    async fetch(request, environment, context = {}) {
      const headers = corsHeaders(request, environment);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404, headers);

      const repository = repositoryFactory(environment.DB);
      const runAnalyze = analyze || ((payload) => import('./llm.js').then(({ analyzeScript }) => analyzeScript(payload)));
      const runSynthesize = synthesize || ((payload) => import('./llm.js').then(({ synthesizeAnalyses }) => synthesizeAnalyses(payload)));

      try {
        if (url.pathname === '/api/analyze' && request.method === 'POST') {
          const result = await runAnalyze({ ...(await requestBody(request)), config: configFrom(environment, request, context.fetchImpl || fetch) });
          return json(result.body, result.status, headers);
        }
        if (url.pathname === '/api/synthesize' && request.method === 'POST') {
          const result = await runSynthesize({ ...(await requestBody(request)), config: configFrom(environment, request, context.fetchImpl || fetch) });
          return json(result.body, result.status, headers);
        }

        if (url.pathname === '/api/register' && request.method === 'POST') {
          const body = await requestBody(request);
          const name = String(body.username || '').trim();
          const password = body.password || '';
          if (name.length < 2 || name.length > 20) return json({ error: '用户名需 2-20 个字符' }, 400, headers);
          if (password.length < 6) return json({ error: '密码至少 6 位' }, 400, headers);
          if (await repository.findExistingUsername(name)) return json({ error: '用户名已存在，换个试试' }, 409, headers);
          const { hashPassword, createSessionToken } = await import('./auth.js');
          const userId = await repository.createUser(name, await hashPassword(password), new Date().toISOString());
          const token = createSessionToken();
          await repository.createSession(token, userId, Date.now());
          return json({ token, username: name }, 200, headers);
        }

        if (url.pathname === '/api/login' && request.method === 'POST') {
          const body = await requestBody(request);
          const name = String(body.username || '').trim();
          const user = await repository.findUserByNickname(name);
          const { verifyPassword, createSessionToken } = await import('./auth.js');
          if (!user || !(await verifyPassword(body.password || '', user.password_hash))) return json({ error: '用户名或密码错误' }, 401, headers);
          const token = createSessionToken();
          await repository.createSession(token, user.id, Date.now());
          return json({ token, username: user.nickname }, 200, headers);
        }

        const auth = await requireUser(request, repository);
        if (auth.response) return json(auth.response.body ? await auth.response.json() : { error: '未登录' }, auth.response.status, headers);

        if (url.pathname === '/api/apikey' && request.method === 'GET') {
          const key = await repository.getApiKey(auth.userId);
          return json({ hasKey: !!key, key, masked: maskApiKey(key) }, 200, headers);
        }
        if (url.pathname === '/api/apikey' && request.method === 'POST') {
          const body = await requestBody(request);
          const key = String(body.key || '').trim();
          if (!key) return json({ error: '缺少 Key' }, 400, headers);
          if (key.length > 512) return json({ error: 'Key 不能超过 512 个字符' }, 400, headers);
          await repository.setApiKey(auth.userId, key);
          return json({ ok: true, masked: maskApiKey(key) }, 200, headers);
        }
        if (url.pathname === '/api/apikey' && request.method === 'DELETE') {
          await repository.clearApiKey(auth.userId);
          return json({ ok: true }, 200, headers);
        }

        if (url.pathname === '/api/me' && request.method === 'GET') {
          const user = await repository.findUserById(auth.userId);
          if (!user) return json({ error: '用户不存在' }, 401, headers);
          return json({ username: user.nickname }, 200, headers);
        }
        if (url.pathname === '/api/logout' && request.method === 'POST') {
          await repository.deleteSession(auth.token);
          return json({ ok: true }, 200, headers);
        }
        if (url.pathname === '/api/history' && request.method === 'GET') {
          return json(await repository.listHistory(auth.userId), 200, headers);
        }
        if (url.pathname === '/api/history' && request.method === 'POST') {
          const body = await requestBody(request);
          const preview = String(body.preview || '').trim();
          if (!preview) return json({ error: '缺少预览内容' }, 400, headers);
          await repository.saveHistory(auth.userId, preview, body.date || '', body.data || {}, Date.now());
          return json({ ok: true }, 200, headers);
        }
        if (url.pathname.startsWith('/api/history/') && request.method === 'DELETE') {
          const id = Number(url.pathname.slice('/api/history/'.length));
          if (!Number.isInteger(id)) return json({ error: '无效的记录' }, 400, headers);
          await repository.deleteHistory(id, auth.userId);
          return json({ ok: true }, 200, headers);
        }
        return json({ error: 'Not found' }, 404, headers);
      } catch (error) {
        const status = error.status || (error instanceof SyntaxError ? 400 : 500);
        return json({ error: status === 413 ? '请求内容过大' : '服务暂时不可用，请稍后重试' }, status, headers);
      }
    },
  };
}

export default {
  async fetch(request, environment, context) {
    const { createRepository } = await import('./repository.js');
    return createWorker({ repositoryFactory: (db) => createRepository(db) }).fetch(request, environment, context);
  },
};
