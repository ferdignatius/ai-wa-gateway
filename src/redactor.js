export const MAX_QUOTED_CHARS = 4000;

const PATTERNS = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
  [/(?<!\d)(?:\+?\d[\d .()-]{7,}\d)(?!\d)/g, '[REDACTED_PHONE]'],
  [/(?<key>token|secret|api[_ -]?key|password|passwd)\s*[:=]\s*[^\s,;]+/gi, '$<key>=[REDACTED_SECRET]'],
  [/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)[^\s]*/gi, '[REDACTED_PRIVATE_URL]'],
  [/(?<!\d)\d{16,19}(?!\d)/g, '[REDACTED_FINANCIAL_ID]'],
  [/(?<!\d)\d{16}(?!\d)/g, '[REDACTED_NIK]'],
  [/(?:(?:jalan|jl\.?|jln\.?|alamat)\s+[^,;\n]{3,}(?:,\s*[^,;\n]+){0,3})/giu, '[REDACTED_ADDRESS]'],
];

export function redact(value) {
  let text = String(value ?? '');
  const original = text;
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return { text, changed: text !== original };
}
