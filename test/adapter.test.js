import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsAppGateway } from '../src/whatsapp.js';

test('adapter public factory accepts backend URL without starting WhatsApp', () => {
  const gateway = createWhatsAppGateway({ backendUrl: 'http://127.0.0.1:1', onPayload: async () => null });
  assert.equal(typeof gateway.start, 'function');
  assert.equal(typeof gateway.client.on, 'function');
  gateway.client.destroy();
});
