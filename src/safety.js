const ACCESS_REQUEST_PATTERNS = [
  /\b(?:buka|akses|baca|ambil|dump|kirim|tampilkan)\b.{0,60}\b(?:filesystem|file|folder|database|db|credential|password|secret|api\s*key|environment|env|private\s*data)\b/iu,
  /\b(?:read|access|open|dump|exfiltrate)\b.{0,60}\b(?:filesystem|file|folder|database|credentials?|passwords?|secrets?|api\s*keys?|environment|private\s*data)\b/iu,
];

export function isUnsafeRequest(text) {
  return ACCESS_REQUEST_PATTERNS.some(pattern => pattern.test(String(text ?? '')));
}
