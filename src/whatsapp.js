import whatsapp from 'whatsapp-web.js';
import { routeEvent, responsePlan, logDecision } from './core.js';
import { createHttpBackend } from './backend.js';
import { log, logError } from './logger.js';

const { Client, LocalAuth } = whatsapp;

export function createWhatsAppGateway({ onPayload, backendUrl, onError = console.error } = {}) {
  const handlePayload = onPayload ?? createHttpBackend({ url: backendUrl, token: process.env.BACKEND_TOKEN });
  const seen = new Map();
  const MAX_SEEN = 10000;
  const TTL_MS = 24 * 60 * 60 * 1000;
  let pending = 0;
  let stopping = false;
  let botId = '';
  const client = new Client({ authStrategy: new LocalAuth() });

  client.on('ready', () => {
    botId = client.info.wid._serialized;
    log('gateway_ready', { bot_id: botId });
  });

  client.on('message', async message => {
    if (stopping || pending >= 100) {
      log('message_dropped_queue_full', { pending, message_id: message.id?._serialized });
      return;
    }
    pending += 1;
    try {
      const event = await normalizeWhatsAppMessage(message);

      if (!event) return;
      const now = Date.now();
      for (const [id, expires] of seen) if (expires <= now) seen.delete(id);
      const ids = new Set(seen.keys());
      const decision = routeEvent(event, botId, ids);
      if (decision.action !== 'reject_duplicate' && decision.payload.message_id) {
        seen.set(decision.payload.message_id, now + TTL_MS);
        while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
      }
      decision.logs.forEach(eventName => logDecision(eventName, decision.payload));

      if (decision.action !== 'process') return;
      const { _redacted, is_unsafe_request, ...backendPayload } = decision.payload;
      const result = await handlePayload?.(backendPayload);

      if (result == null) return;
      const plan = responsePlan(decision.payload, result);
      await new Promise(resolve => setTimeout(resolve, plan.delayMs));

      try {
        await message.reply(String(result), undefined, { mentions: plan.mentions });
        if (plan.mentions.length) logDecision('response_sender_mention_added', decision.payload);
      } catch (error) {
        if (plan.mentions.length) logDecision('response_sender_mention_failed', decision.payload);
        await message.reply(String(result));
      }
    } catch (error) {
      logError('message_processing_failed', error, { message_id: message.id?._serialized });
      onError(error);
    } finally {
      pending -= 1;
    }
  });

  return {
    client,
    start: async () => { log('gateway_starting'); await client.initialize(); },
    stop: async () => { stopping = true; log('gateway_shutdown_started', { pending }); await client.destroy(); log('gateway_shutdown_completed'); },
  };
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
