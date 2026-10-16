import whatsapp from 'whatsapp-web.js';
import { routeEvent, responsePlan, logDecision } from './core.js';
import { createHttpBackend } from './backend.js';

const { Client, LocalAuth } = whatsapp;

export function createWhatsAppGateway({ onPayload, backendUrl, onError = console.error } = {}) {
  const handlePayload = onPayload ?? createHttpBackend({ url: backendUrl, token: process.env.BACKEND_TOKEN });
  const seen = new Map();
  const TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_SEEN = 10000;
  const MAX_PENDING = 100;
  const MIN_INTERVAL_MS = 100;
  let pending = 0;
  let lastStarted = 0;
  let stopping = false;
  let botId = '';
  const client = new Client({ authStrategy: new LocalAuth() });

  client.on('ready', () => {
    botId = client.info.wid._serialized;
  });

  client.on('message', async message => {
    if (stopping || pending >= MAX_PENDING) return;
    pending += 1;
    try {
      const event = await normalizeWhatsAppMessage(message);
      if (!event) return;
      const now = Date.now();
      for (const [id, expires] of seen) if (expires <= now) seen.delete(id);
      const idempotency = new Set([...seen].filter(([, expires]) => expires > now).map(([id]) => id));
      const decision = routeEvent(event, botId, idempotency);
      if (decision.action !== 'reject_duplicate' && decision.payload.message_id) {
        seen.set(decision.payload.message_id, now + TTL_MS);
        while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
      }
      decision.logs.forEach(eventName => logDecision(eventName, decision.payload));
      if (decision.action !== 'process') return;
      const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastStarted));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastStarted = Date.now();
      const { _redacted, is_unsafe_request, ...backendPayload } = decision.payload;
      const result = await handlePayload?.(backendPayload);
      if (result == null) return;
      const plan = responsePlan(decision.payload, result);
      const chat = await message.getChat();
      await chat.sendStateTyping();
      await new Promise(resolve => setTimeout(resolve, plan.delayMs));
      try {
        await message.reply(String(result), undefined, { mentions: plan.mentions });
        if (plan.mentions.length) logDecision('response_sender_mention_added', decision.payload);
      } catch (error) {
        if (plan.mentions.length) logDecision('response_sender_mention_failed', decision.payload);
        await message.reply(String(result));
      }
    } catch (error) {
      onError(error);
    } finally {
      pending -= 1;
    }
  });

  return { client, start: () => client.initialize(), stop: async () => { stopping = true; await client.destroy(); } };
}

async function normalizeWhatsAppMessage(message) {
  const chat = await message.getChat();
  const quoted = message.hasQuotedMsg ? await message.getQuotedMessage() : null;
  return message.hasMedia && !message.body ? null : {
    chatType: chat.isGroup ? 'group' : 'dm',
    chatId: chat.id._serialized,
    senderId: message.author ?? message.from,
    messageId: message.id._serialized,
    text: message.body,
    mentionedJid: message.mentionedIds,
    quotedMessage: quoted && {
      messageId: quoted.id._serialized,
      senderId: quoted.author ?? quoted.from,
      text: quoted.body,
    },
  };
}
