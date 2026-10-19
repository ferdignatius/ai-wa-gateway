import { MAX_QUOTED_CHARS, redact } from './redactor.js';
import { isUnsafeRequest } from './safety.js';

function textOf(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.text ?? value.conversation ?? value.caption ?? '';
}

function asIds(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function normalizeReply(reply) {
  if (!reply) return null;
  const text = textOf(reply).slice(0, MAX_QUOTED_CHARS);
  return {
    message_id: String(reply.messageId ?? reply.id ?? ''),
    sender_id: String(reply.senderId ?? reply.participant ?? ''),
    text: redact(text).text.slice(0, MAX_QUOTED_CHARS),
  };
}

export function normalizeEvent(event, botId) {
  const chatType = event.chatType === 'group' || event.isGroup ? 'group' : 'dm';
  const bot = String(botId ?? event.botId ?? '');
  const mentioned = asIds(event.mentionedJid ?? event.mentions);
  const text = textOf(event.message ?? event);
  const hasBotMention = mentioned.includes(bot) || fallbackMention(text, bot, mentioned);
  const normalizedMentions = hasBotMention && !mentioned.includes(bot) ? [...mentioned, bot] : mentioned;
  const cleanText = redact(text);
  const reply = normalizeReply(event.quotedMessage ?? event.quoted);
  const sender = String(event.senderId ?? event.participant ?? '');

  return {
    chat_type: chatType,
    chat_id: String(event.chatId ?? event.remoteJid ?? ''),
    sender_id: sender,
    message_id: String(event.messageId ?? event.id ?? ''),
    text: cleanText.text,
    is_bot_mentioned: chatType === 'dm' || hasBotMention,
    mentioned_bot_ids: normalizedMentions.filter(id => id === bot),
    reply,
    response_mentions: chatType === 'group' && hasBotMention ? [...new Set([sender, ...normalizedMentions.filter(id => id !== bot)])].filter(Boolean) : [],
    is_unsafe_request: isUnsafeRequest(text),
    _redacted: cleanText.changed || Boolean(reply && redact(textOf(event.quotedMessage ?? event.quoted)).changed),
  };
}

function fallbackMention(text, botId, mentioned) {
  if (!botId || mentioned.length) return false;
  return new RegExp(`@${botId.replace(/[^0-9]/g, '')}\\b`).test(text);
}
