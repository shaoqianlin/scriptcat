export function createApiUrl(path, origin = '') {
  const base = String(origin || '').replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function createApiFetch(origin = '', fetchImpl = fetch) {
  return (path, options) => fetchImpl(createApiUrl(path, origin), options);
}
