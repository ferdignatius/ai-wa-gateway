const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_RESPONSE_CHARS = 16 * 1024;
const MAX_RETRIES = 2;
const CIRCUIT_FAILURES = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;
import { log, logError } from './logger.js';

export function createHttpBackend({ url, token = '', fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url) throw new Error('Backend URL is required');
  if (!token) throw new Error('Backend token is required');
  let failures = 0;
  let openUntil = 0;
  return async payload => {
    if (Date.now() < openUntil) throw new Error('Backend circuit open');
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > MAX_PAYLOAD_BYTES) throw new Error('Backend payload too large');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: serialized,
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`Backend HTTP ${response.status}`);
          error.retryable = response.status >= 500 || response.status === 429;
          throw error;
        }
        const body = await response.json();
        const extractedText = extractResponseText(body);
        if (!extractedText || !extractedText.trim()) return null;
        if (extractedText.length > MAX_RESPONSE_CHARS) throw new Error('Backend response too large');
        failures = 0;
        return extractedText.trim();
      } catch (error) {
        failures += 1;
        logError('backend_request_failed', error, { attempt, retrying: attempt < MAX_RETRIES });
        if (failures >= CIRCUIT_FAILURES) {
          openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
          log('backend_circuit_open', { cooldown_ms: CIRCUIT_COOLDOWN_MS });
        }
        if (attempt === MAX_RETRIES || error.retryable === false) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt + Math.random() * 100));
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function extractResponseText(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body.text === 'string') return body.text;
  if (typeof body.reply === 'string') return body.reply;
  if (typeof body.message === 'string') return body.message;
  if (typeof body.response === 'string') return body.response;
  if (typeof body.content === 'string') return body.content;
  if (Array.isArray(body.choices) && typeof body.choices[0]?.message?.content === 'string') {
    return body.choices[0].message.content;
  }
  return '';
}
