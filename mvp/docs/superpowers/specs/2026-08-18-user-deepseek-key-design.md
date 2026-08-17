# User DeepSeek API Key

## Goal

Let each user supply a DeepSeek API key so analysis works even when the app-level key is unavailable.

## User Experience

- A key icon in the header opens a compact DeepSeek API settings panel.
- The panel lets the user enter, reveal, save, or clear one DeepSeek API key.
- The key is stored only in that browser's `localStorage` and is never written to D1.
- Analysis and synthesis use the saved personal key. When absent, requests continue to fall back to the app-level key.
- If neither key is available, the app clearly tells the user to configure a DeepSeek key.

## Request Flow

1. The frontend reads `boomcat_deepseek_api_key` from `localStorage`.
2. When present, it sends the key in `X-DeepSeek-API-Key` on `/api/analyze` and `/api/synthesize`.
3. The Pages Function accepts only this header, limits it to 512 characters, and gives it priority over `DEEPSEEK_API_KEY`.
4. The Worker sends the selected key only to the fixed DeepSeek Chat Completions endpoint.

## Security Constraints

- No personal key is stored in D1, history data, server logs, or responses.
- The user cannot configure an upstream URL or model.
- CORS explicitly permits `X-DeepSeek-API-Key`.
- An oversized personal key is rejected before any upstream request.

## Tests

- A personal key overrides the app-level key for analysis and synthesis.
- The app-level key remains the fallback when the header is absent.
- Invalid or oversized header values are rejected.
- Allowed-origin CORS preflight includes the new header.
