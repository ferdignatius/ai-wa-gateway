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

test('posts OpenAI/Hermes completions format with session headers and reply context', async () => {
  let request;
  const backend = createHttpBackend({
    url: 'http://100.69.97.123:8642/v1/chat/completions',
    token: 'test-api-key',
    model: 'cx/gpt-5.6-luna',
    fetchImpl: async (...args) => {
      request = args;
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: 'Halo dari Hermes' } }]
          };
        }
      };
    }
  });

  const payload = {
    chat_id: '628123456789@c.us',
    text: 'Halo asisten',
    reply: {
      message_id: 'q1',
      sender_id: '628999999999@c.us',
      text: 'Pesan sebelumnya'
    }
  };

  const response = await backend(payload);
  assert.equal(response, 'Halo dari Hermes');
  assert.equal(request[0], 'http://100.69.97.123:8642/v1/chat/completions');
  assert.equal(request[1].headers.authorization, 'Bearer test-api-key');
  assert.equal(request[1].headers['x-hermes-session-key'], '628123456789@c.us');
  assert.equal(request[1].headers['x-hermes-session-id'], '628123456789@c.us');

  const body = JSON.parse(request[1].body);
  assert.equal(body.model, 'cx/gpt-5.6-luna');
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.ok(body.messages[0].content.includes('Pesan sebelumnya'));
  assert.ok(body.messages[0].content.includes('Halo asisten'));
});

