import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsAppGateway } from '../src/whatsapp.js';

test('adapter public factory accepts backend URL without starting WhatsApp', () => {
  const gateway = createWhatsAppGateway({ backendUrl: 'http://127.0.0.1:1', onPayload: async () => null });
  assert.equal(typeof gateway.start, 'function');
  assert.equal(typeof gateway.client.on, 'function');
  gateway.client.destroy();
});

test('normalizeWhatsAppMessage ignores self-messages (fromMe)', async () => {
  const { normalizeWhatsAppMessage } = await import('../src/whatsapp.js');
  const result = await normalizeWhatsAppMessage({
    fromMe: true,
    type: 'chat',
    body: 'hello from bot self',
  });
  assert.equal(result, null);
});

test('normalizeWhatsAppMessage resolves messageId fallback robustly', async () => {
  const { normalizeWhatsAppMessage } = await import('../src/whatsapp.js');
  const result = await normalizeWhatsAppMessage({
    fromMe: false,
    type: 'chat',
    from: '628123456789@c.us',
    body: 'test msg',
    id: { id: 'FALLBACK_MSG_ID' },
    getChat: async () => ({ id: { _serialized: '628123456789@c.us' }, isGroup: false }),
  });
  assert.ok(result);
  assert.equal(result.messageId, 'FALLBACK_MSG_ID');
});

