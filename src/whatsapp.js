import whatsapp from 'whatsapp-web.js';
import { routeEvent, responsePlan, logDecision } from './core.js';
import { createHttpBackend } from './backend.js';
import { log, logError } from './logger.js';
import qrcode from 'qrcode-terminal';

const { Client, LocalAuth } = whatsapp;

export function createWhatsAppGateway({ onPayload, backendUrl, onError = console.error } = {}) {
  const handlePayload = onPayload ?? createHttpBackend({ url: backendUrl, token: process.env.BACKEND_TOKEN });
  const seen = new Map();
  const MAX_SEEN = 10000;
  const TTL_MS = 24 * 60 * 60 * 1000;
  let pending = 0;
  let stopping = false;
  let botId = '';
  let ready = false;
  let disconnectTimer;
  const configuredDisconnectExitMs = Number(process.env.DISCONNECT_EXIT_MS);
  const disconnectExitMs = configuredDisconnectExitMs > 0 ? configuredDisconnectExitMs : 60_000;
  const executablePath = process.env.CHROME_BIN || (process.platform === 'linux' ? '/usr/bin/chromium' : undefined);
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  });

  client.on('qr', qr => qrcode.generate(qr, { small: true }));

  client.on('ready', () => {
    ready = true;
    clearTimeout(disconnectTimer);
    disconnectTimer = undefined;
    botId = client.info?.wid?._serialized ? client.info.wid._serialized.replace(/:\d+@/, '@') : '';
    log('gateway_ready', { bot_id: botId });
  });

  client.on('disconnected', reason => {
    ready = false;
    log('gateway_disconnected', { reason });
    clearTimeout(disconnectTimer);
    disconnectTimer = setTimeout(() => {
      log('gateway_disconnect_restart_requested', { delay_ms: disconnectExitMs });
      process.exit(1);
    }, disconnectExitMs);
    disconnectTimer.unref?.();
  });

  client.on('auth_failure', message => {
    ready = false;
    log('gateway_auth_failure', { message });
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
      for (const [id, expires] of seen) {
        if (expires <= now) seen.delete(id);
        else break;
      }
      const ids = new Set(seen.keys());
      const decision = routeEvent(event, botId, ids);
      if (decision.logs.includes('ignored_group_no_mention')) return;
      if (decision.action !== 'reject_duplicate' && decision.payload.message_id) {
        seen.set(decision.payload.message_id, now + TTL_MS);
        while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
      }
      decision.logs.forEach(eventName => logDecision(eventName, decision.payload));

      if (decision.action !== 'process') return;
      const { _redacted, is_unsafe_request, _has_other_mentions, ...backendPayload } = decision.payload;
      const result = await handlePayload?.(backendPayload);

      if (result == null) return;
      const plan = responsePlan(decision.payload, result);
      try {
        await (await message.getChat()).sendStateTyping();
      } catch (error) {
        logError('typing_state_failed', error, { message_id: decision.payload.message_id });
      }
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
    health: () => ({ ready, stopping, pending }),
    stop: async () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(disconnectTimer);
      log('gateway_shutdown_started', { pending });
      const shutdownStart = Date.now();
      while (pending > 0 && Date.now() - shutdownStart < 3000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await Promise.race([
        client.destroy(),
        new Promise(resolve => setTimeout(() => {
          log('gateway_shutdown_timeout', { timeout_ms: 5000 });
          resolve();
        }, 5000)),
      ]);
      log('gateway_shutdown_completed');
    },
  };
}

async function normalizeWhatsAppMessage(message) {
  if (message.type !== 'chat' && !(message.hasMedia && message.body)) return null;
  let chat;
  try {
    chat = await message.getChat();
  } catch {
    chat = null;
  }
  const isGroup = chat ? chat.isGroup : (message.from?.endsWith('@g.us') || Boolean(message.author));
  const chatId = chat?.id?._serialized || message.from || '';
  const quoted = message.hasQuotedMsg ? await message.getQuotedMessage().catch(() => null) : null;
  return message.hasMedia && !message.body ? null : {
    chatType: isGroup ? 'group' : 'dm',
    chatId,
    senderId: message.author ?? message.from ?? '',
    messageId: message.id?._serialized ?? '',
    text: message.body ?? '',
    mentionedJid: message.mentionedIds,
    quotedMessage: quoted && {
      messageId: quoted.id?._serialized ?? '',
      senderId: quoted.author ?? quoted.from ?? '',
      text: quoted.body ?? '',
    },
  };
}
