export const DEEPSEEK_KEY_STORAGE = 'boomcat_deepseek_api_key';

export function createDeepSeekHeaders(storage = localStorage) {
  const apiKey = (storage.getItem(DEEPSEEK_KEY_STORAGE) || '').trim();
  return apiKey ? { 'X-DeepSeek-API-Key': apiKey } : {};
}
