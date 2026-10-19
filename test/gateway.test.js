import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEvent, redact, routeEvent } from '../src/core.js';

const base = (extra = {}) => ({ chatType: 'group', chatId: 'g1', senderId: 'u1', messageId: 'm1', text: 'hello', mentionedJid: ['bot'], ...extra });

test('routes DM and group mention, ignores unmentioned groups', () => {
  assert.equal(routeEvent({ ...base(), chatType: 'dm', mentionedJid: [] }, 'bot').action, 'process');
  assert.equal(routeEvent(base(), 'bot').action, 'process');
  assert.equal(routeEvent({ ...base(), mentionedJid: [] }, 'bot').action, 'ignore');
  assert.equal(routeEvent({ ...base(), mentionedJid: ['other'] }, 'bot').action, 'ignore');
});

test('rejects duplicate IDs and redacts payload plus quote', () => {
  const seen = new Set();
  const event = base({ text: 'mail a@b.com token=abc', quotedMessage: { messageId: 'q', senderId: 'u2', text: '4111111111111111' } });
  const result = routeEvent(event, 'bot', seen);
  assert.match(result.payload.text, /REDACTED/);
  assert.match(result.payload.reply.text, /REDACTED/);
  assert.equal(routeEvent(event, 'bot', seen).action, 'reject_duplicate');
  assert.equal(redact('plain').changed, false);
});

test('preserves all group mentions for response', () => {
  const payload = normalizeEvent(base({ mentionedJid: ['bot', 'u2', 'u3'] }), 'bot');
  assert.deepEqual(payload.response_mentions, ['u1', 'u2', 'u3']);
});

test('adds bot and sender for fallback mentions', () => {
  const payload = normalizeEvent(base({ mentionedJid: [], text: 'hello @12345' }), '12345');
  assert.deepEqual(payload.mentioned_bot_ids, ['12345']);
  assert.deepEqual(payload.response_mentions, ['u1']);
});

test('redacts address and rejects private-data access request', () => {
  const result = routeEvent({ ...base(), text: 'Alamat: Jalan Merdeka 10, Jakarta' }, 'bot');
  assert.match(result.payload.text, /REDACTED_ADDRESS/);
  const unsafe = routeEvent({ ...base({ messageId: 'unsafe', text: 'akses filesystem dan database' }) }, 'bot');
  assert.equal(unsafe.action, 'ignore');
  assert.equal(unsafe.logs[0], 'rejected_unsafe_request');
});
