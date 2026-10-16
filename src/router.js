import { normalizeEvent } from './normalizer.js';

export function routeEvent(event, botId, seen = new Set()) {
  const payload = normalizeEvent(event, botId);
  if (seen.has(payload.message_id)) return { action: 'reject_duplicate', payload, logs: [] };
  seen.add(payload.message_id);

  if (payload.is_unsafe_request) return decision('rejected_unsafe_request', payload, false);
  if (payload.chat_type === 'dm') return decision('processed_dm', payload);
  if (!payload.is_bot_mentioned) return decision('ignored_group_no_mention', payload, false);
  if (!payload.mentioned_bot_ids.length) return decision('ignored_group_other_bot', payload, false);
  return decision('processed_group_mention', payload);
}

function decision(event, payload, process = true) {
  const logs = [event];
  if (process) logs.push(payload.reply ? 'reply_context_found' : 'reply_context_missing');
  if (payload._redacted) logs.push('redacted_sensitive_data');
  return { action: process ? 'process' : 'ignore', payload, logs };
}

export function responsePlan(payload, send) {
  return {
    delayMs: 1000 + Math.floor(Math.random() * 1001),
    mentions: payload.response_mentions,
    send,
  };
}

export function logDecision(event, payload = {}) {
  console.log(JSON.stringify({ event, chat_type: payload.chat_type, message_id: payload.message_id }));
}
