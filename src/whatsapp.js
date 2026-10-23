import whatsapp from 'whatsapp-web.js';
import { routeEvent, responsePlan, logDecision } from './core.js';
import { createHttpBackend } from './backend.js';
import { log, logError } from './logger.js';
import qrcode from 'qrcode-terminal';

const { Client, LocalAuth } = whatsapp;

export function createWhatsAppGateway({ onPayload, backendUrl, backendToken, onError = console.error } = {}) {
  const handlePayload = onPayload ?? createHttpBackend({ url: backendUrl, token: backendToken });
  const seen = new Map();
  const senderWindows = new Map();
  const configuredRateLimit = Number(process.env.RATE_LIMIT);
  const RATE_LIMIT = Number.isFinite(configuredRateLimit) && configuredRateLimit >= 0 ? configuredRateLimit : 100;
  const RATE_WINDOW_MS = 60 * 60 * 1000;
  const MAX_SEEN = 10000;
  const TTL_MS = 24 * 60 * 60 * 1000;
  let pending = 0;
  let stopping = false;
  let botId = '';
  let botIds = [];
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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
      ],
    },
  });

  client.on('qr', qr => qrcode.generate(qr, { small: true }));

  client.on('ready', async () => {
    ready = true;
    clearTimeout(disconnectTimer);
    disconnectTimer = undefined;
    botId = client.info?.wid?._serialized ? client.info.wid._serialized.replace(/:\d+@/, '@') : '';
    let lid = '';
    try {
      lid = await client.pupPage.evaluate(() => {
        try {
          const { getMaybeMeLidUser } = window.require('WAWebUserPrefsMeUser');
          const lidUser = getMaybeMeLidUser();
          return lidUser?._serialized ? lidUser._serialized.replace(/:\d+@/, '@') : '';
        } catch {
          return '';
        }
      });
    } catch {}
    botIds = [botId, lid].filter(Boolean);
    client.sendPresenceAvailable().catch(() => {});
    log('gateway_ready', { bot_id: botId, bot_lid: lid });
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
      const sender = event.senderId || event.chatId;
      const window = senderWindows.get(sender) ?? { started: now, count: 0 };
      if (now - window.started >= RATE_WINDOW_MS) { window.started = now; window.count = 0; }
      window.count += 1;
      senderWindows.set(sender, window);
      if (RATE_LIMIT > 0 && window.count > RATE_LIMIT) {
        log('message_dropped_rate_limit', { sender_id: sender });
        return;
      }
      for (const [id, expires] of seen) {
        if (expires <= now) seen.delete(id);
        else break;
      }
      if (senderWindows.size > 1000) {
        for (const [senderId, win] of senderWindows) {
          if (now - win.started >= RATE_WINDOW_MS) senderWindows.delete(senderId);
        }
      }
      const ids = new Set(seen.keys());
      const decision = routeEvent(event, botIds.length ? botIds : botId, ids);
      if (decision.logs.includes('ignored_group_no_mention')) return;
      if (decision.action !== 'reject_duplicate' && decision.payload.message_id) {
        seen.set(decision.payload.message_id, now + TTL_MS);
        while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
      }
      decision.logs.forEach(eventName => logDecision(eventName, decision.payload));

      if (decision.action !== 'process') return;

      // Start typing state so users know the assistant is processing
      await sendTypingState(client, message, event.chatId);

      const { _redacted, is_unsafe_request, _has_other_mentions, ...backendPayload } = decision.payload;
      const result = await handlePayload?.(backendPayload);

      if (result == null) return;
      const plan = responsePlan(decision.payload, result);
      // Keep typing active during the 1-2s delay before sending response
      await sendTypingState(client, message, event.chatId);
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

export async function normalizeWhatsAppMessage(message) {
  if (message.fromMe) return null;
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
  const messageId = message.id?._serialized || message.id?.id || (typeof message.id === 'string' ? message.id : '');
  return message.hasMedia && !message.body ? null : {
    _chat: chat,
    chatType: isGroup ? 'group' : 'dm',
    chatId,
    senderId: message.author ?? message.from ?? '',
    messageId,
    text: message.body ?? '',
    mentionedJid: message.mentionedIds || message._data?.mentionedJidList,
    quotedMessage: quoted && {
      messageId: quoted.id?._serialized || quoted.id?.id || (typeof quoted.id === 'string' ? quoted.id : ''),
      senderId: quoted.author ?? quoted.from ?? '',
      text: quoted.body ?? '',
    },
  };
}

async function sendTypingState(client, message, chatId) {
  if (!chatId) return;
  try {
    if (client?.pupPage && !client.pupPage.isClosed?.()) {
      const sent = await client.pupPage.evaluate(async targetChatId => {
        try {
          if (window.WWebJS?.sendChatstate) {
            await window.WWebJS.sendChatstate('typing', targetChatId);
            return true;
          }
          const ChatState = window.require?.('WAWebChatStateBridge');
          const WidFactory = window.require?.('WAWebWidFactory');
          if (ChatState && WidFactory) {
            const wid = WidFactory.createWid(targetChatId);
            await ChatState.sendChatStateComposing(wid);
            return true;
          }
        } catch {}
        return false;
      }, chatId).catch(() => false);
      if (sent) return;
    }
  } catch {}

  try {
    const chat = await message?.getChat?.().catch(() => null);
    if (chat && typeof chat.sendStateTyping === 'function') {
      await chat.sendStateTyping().catch(() => {});
    }
  } catch {}
}
