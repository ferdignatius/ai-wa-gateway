import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpBackend } from '../src/backend.js';

test('posts normalized payload and returns response text', async () => {
  let request;
  const backend = createHttpBackend({ url: 'http://backend.test', token: 'test-token', fetchImpl: async (...args) => {
    request = args;
    return { ok: true, async json() { return { text: 'done' }; } };
  }});
  assert.equal(await backend({ message_id: 'm1' }), 'done');
  assert.equal(request[0], 'http://backend.test');
  assert.equal(request[1].headers.authorization, 'Bearer test-token');
  assert.equal(JSON.parse(request[1].body).message_id, 'm1');
});

test('returns null for empty response and throws HTTP errors', async () => {
  const empty = createHttpBackend({ url: 'http://backend.test', token: 'test-token', fetchImpl: async () => ({ ok: true, async json() { return {}; } }) });
  assert.equal(await empty({}), null);
  const failed = createHttpBackend({ url: 'http://backend.test', token: 'test-token', fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(failed({}), /Backend HTTP 503/);
});
