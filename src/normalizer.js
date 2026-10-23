import { MAX_QUOTED_CHARS, redact } from './redactor.js';
import { isUnsafeRequest } from './safety.js';

function textOf(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.text ?? value.conversation ?? value.caption ?? '';
}

function cleanJid(jid) {
  if (!jid) return '';
  if (typeof jid === 'object') {
    jid = jid._serialized || jid.id || jid.user || '';
  }
  return String(jid ?? '').replace(/:\d+@/, '@').replace(/@s\.whatsapp\.net$/, '@c.us');
}

function asIds(value) {
  if (!Array.isArray(value)) value = value ? [value] : [];
  return value.filter(Boolean).map(cleanJid).filter(Boolean);
}

function normalizeReply(reply) {
  if (!reply) return null;
  const text = textOf(reply).slice(0, MAX_QUOTED_CHARS);
  return {
    message_id: String(reply.messageId ?? reply.id ?? ''),
    sender_id: cleanJid(reply.senderId ?? reply.participant ?? ''),
    text: redact(text).text.slice(0, MAX_QUOTED_CHARS),
  };
}

const TAG_ALL_PATTERNS = [
  /@(?:everyone|all|semua|here|channel|tagall|tag-all)\b/i,
];

export function isTagAllBroadcast(text, mentioned = []) {
  if (TAG_ALL_PATTERNS.some(p => p.test(String(text ?? '')))) {
    return true;
  }
  if (Array.isArray(mentioned) && mentioned.length > 4) {
    return true;
  }
  return false;
}

export function normalizeEvent(event, botId) {
  const chatType = event.chatType === 'group' || event.isGroup ? 'group' : 'dm';
  const botList = asIds(Array.isArray(botId) ? botId : [botId, event.botId]);
  const primaryBot = botList[0] || '';
  const mentioned = asIds(event.mentionedJid ?? event.mentions);
  const text = textOf(event.message ?? event);
  const isTagAll = chatType === 'group' && isTagAllBroadcast(text, mentioned);
  const hasBotMention = (mentioned.some(id => botList.includes(id)) || fallbackMention(text, botList, mentioned)) && !isTagAll;
  const normalizedMentions = hasBotMention && !mentioned.some(id => botList.includes(id)) && primaryBot ? [...mentioned, primaryBot] : mentioned;
  const strippedText = stripBotMentions(text, botList);
  const cleanText = redact(strippedText);
  const reply = normalizeReply(event.quotedMessage ?? event.quoted);
  const sender = cleanJid(event.senderId ?? event.participant ?? '');

  return {
    chat_type: chatType,
    chat_id: String(event.chatId ?? event.remoteJid ?? ''),
    sender_id: sender,
    message_id: String(event.messageId ?? event.id ?? ''),
    text: cleanText.text,
    is_bot_mentioned: chatType === 'dm' || hasBotMention,
    mentioned_bot_ids: isTagAll ? [] : normalizedMentions.filter(id => botList.includes(id)),
    reply,
    response_mentions: chatType === 'group' && hasBotMention ? [...new Set([sender, ...normalizedMentions.filter(id => !botList.includes(id))])].slice(0, 3).filter(Boolean) : [],
    is_unsafe_request: isUnsafeRequest(text),
    is_tag_all: isTagAll,
    _has_other_mentions: mentioned.some(id => !botList.includes(id)),
    _redacted: cleanText.changed || Boolean(reply && redact(textOf(event.quotedMessage ?? event.quoted)).changed),
  };
}

function stripBotMentions(text, botList) {
  let cleaned = String(text ?? '');
  for (const bot of botList) {
    if (!bot) continue;
    const num = bot.replace(/[^0-9]/g, '');
    if (num && num.length >= 7) {
      cleaned = cleaned.replace(new RegExp(`@\\+?${num}\\b`, 'g'), '');
    }
    const user = bot.replace(/@.*$/, '');
    if (user) {
      cleaned = cleaned.replace(new RegExp(`@${user}\\b`, 'g'), '');
    }
  }
  return cleaned.replace(/[ \t]{2,}/g, ' ').trim();
}

function fallbackMention(text, botList, mentioned) {
  if (!text) return false;
  const list = Array.isArray(botList) ? botList : [botList];
  for (const botId of list) {
    if (!botId) continue;
    if (mentioned.includes(botId)) return false;
    const botNumber = botId.replace(/[^0-9]/g, '');
    if (botNumber && botNumber.length >= 7) {
      if (new RegExp(`@\\+?${botNumber}\\b`).test(text)) return true;
    }
    const botUser = botId.replace(/@.*$/, '');
    if (botUser && new RegExp(`@${botUser}\\b`).test(text)) return true;
  }
  return false;
}
