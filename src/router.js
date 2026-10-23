import { normalizeEvent } from './normalizer.js';
import { log } from './logger.js';

export function routeEvent(event, botId, seen = new Set()) {
  const payload = normalizeEvent(event, botId);
  if (seen.has(payload.message_id)) return { action: 'reject_duplicate', payload, logs: [] };
  seen.add(payload.message_id);

  if (payload.is_unsafe_request) return decision('rejected_unsafe_request', payload, false);
  if (payload.is_tag_all) return decision('ignored_group_tag_all', payload, false);
  if (payload.chat_type === 'dm') return decision('processed_dm', payload);
  if (!payload.is_bot_mentioned) {
    if (payload._has_other_mentions) return decision('ignored_group_other_bot', payload, false);
    return decision('ignored_group_no_mention', payload, false);
  }
  return decision('processed_group_mention', payload);
}

function decision(event, payload, process = true) {
  const logs = [event];
  if (process) logs.push(payload.reply ? 'reply_context_found' : 'reply_context_missing');
  if (payload._redacted) logs.push('redacted_sensitive_data');
  return { action: process ? 'process' : 'ignore', payload, logs };
}

export function responsePlan(payload, send) {
  let text = String(send ?? '').trim();
  text = text
    .replace(/\s*@\[?(?:redacted_phone|REDACTED_PHONE)\]?/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/^[\s,:-]+/, '')
    .trim();

  const mentions = payload?.response_mentions || [];
  if (payload?.chat_type === 'group' && mentions.length > 0) {
    const missingMentions = mentions
      .map(id => `@${String(id).replace(/@.*$/, '')}`)
      .filter(tag => tag && !text.includes(tag));
    if (missingMentions.length > 0) {
      text = text ? `${missingMentions.join(' ')}\n${text}` : missingMentions.join(' ');
    }
  }

  const notificationNote = 'this is notification message. no need to reply';
  if (!text.toLowerCase().includes(notificationNote.toLowerCase())) {
    text = text ? `${text}\n\n_${notificationNote}_` : `_${notificationNote}_`;
  }

  return {
    delayMs: 1000 + Math.floor(Math.random() * 2000),
    mentions,
    send: text,
  };
}

export function logDecision(event, payload = {}) {
  log(event, { chat_type: payload.chat_type, message_id: payload.message_id });
}
