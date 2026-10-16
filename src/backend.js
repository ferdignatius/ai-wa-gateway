const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_RESPONSE_CHARS = 16 * 1024;

export function createHttpBackend({ url, token = '', fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url) throw new Error('Backend URL is required');
  if (!token) throw new Error('Backend token is required');
  return async payload => {
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > MAX_PAYLOAD_BYTES) throw new Error('Backend payload too large');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: serialized,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
      const body = await response.json();
      if (!body || typeof body.text !== 'string' || !body.text.trim()) return null;
      if (body.text.length > MAX_RESPONSE_CHARS) throw new Error('Backend response too large');
      return body.text;
    } finally {
      clearTimeout(timeout);
    }
  };
}
