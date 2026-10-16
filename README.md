# WhatsApp Gateway Assistant

Gateway WhatsApp transport-only untuk menghubungkan WhatsApp Web ke backend HTTP seperti n8n atau Hermes.

```text
WhatsApp → whatsapp-web.js gateway → BACKEND_URL → n8n/Hermes → WhatsApp reply
```

Gateway menangani routing, redaction, quoted context, duplicate message, mention, dan delay response. Gateway tidak menyimpan DB atau menjalankan logic AI.

## Requirements

- Node.js 22+
- pnpm 9+
- Chromium untuk `whatsapp-web.js`
- WhatsApp account untuk QR login

## Quick start lokal

```bash
pnpm install
copy .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
$env:BACKEND_URL="http://localhost:3000/webhook/whatsapp"
pnpm start
```

Linux/macOS:

```bash
cp .env.example .env
set -a; source .env; set +a
pnpm start
```

Scan QR yang tampil di terminal. Session tersimpan di `.wwebjs_auth`, jadi QR tidak perlu dipindai setiap restart.

## Environment

`.env.example`:

```env
BACKEND_URL=http://localhost:3000/webhook/whatsapp
```

`BACKEND_URL` adalah endpoint HTTP backend, bukan URL WhatsApp. Gateway mengirim `POST` JSON ke endpoint ini.

## Backend contract

Request:

```json
{
  "chat_type": "dm",
  "chat_id": "628xxx@c.us",
  "sender_id": "628xxx@c.us",
  "message_id": "true_xxx",
  "text": "Hello",
  "is_bot_mentioned": true,
  "mentioned_bot_ids": ["bot-id"],
  "reply": null,
  "response_mentions": []
}
```

Response sukses:

```json
{ "text": "Jawaban bot" }
```

Response kosong membuat gateway tidak mengirim balasan. HTTP error diteruskan ke error handler dan tidak dikirim sebagai pesan WhatsApp.

## n8n

1. Buat workflow baru.
2. Tambah node **Webhook**.
3. Method: `POST`.
4. Copy Production URL ke `.env`:

```env
BACKEND_URL=https://n8n.example.com/webhook/whatsapp-gateway
```

5. Tambah node AI atau business logic.
6. Tambah **Respond to Webhook**.
7. Return JSON:

```json
{ "text": "={{$json.output}}" }
```

Sesuaikan `output` dengan field hasil node AI.

## Hermes

Hermes harus menyediakan HTTP endpoint yang menerima request contract di atas dan mengembalikan response contract.

Contoh:

```env
BACKEND_URL=http://localhost:3000/api/profiles/ferdinand_assistant/message
```

Jika gateway dan Hermes sama-sama Docker Compose service:

```env
BACKEND_URL=http://hermes:3000/api/profiles/ferdinand_assistant/message
```

Jika Hermes berjalan di host Windows sementara gateway di Docker:

```env
BACKEND_URL=http://host.docker.internal:3000/api/profiles/ferdinand_assistant/message
```

## Docker

Build:

```bash
docker build -t wa-gateway-assistant .
```

Run:

```bash
docker run -it --init \
  --env-file .env \
  -v wa-gateway-auth:/app/.wwebjs_auth \
  -v wa-gateway-cache:/app/.wwebjs_cache \
  wa-gateway-assistant
```

Scan QR dari terminal container. Volume auth menjaga session WhatsApp.

## Behavior

- DM: semua pesan teks diproses.
- Group: hanya pesan dengan `mentionedJid` bot diproses.
- Group tanpa mention atau mention bot lain: diabaikan.
- Duplicate `messageId`: ditolak.
- Quoted context: dibaca maksimal 4.000 karakter.
- Media tanpa caption: diabaikan.
- Caption media: diproses.
- Response group mention semua user yang men-tag bot.
- Typing delay random 1-2 detik.
- Data sensitif disensor sebelum dikirim ke backend.
- Request akses filesystem, DB, credential, environment, atau private data ditolak.

## Security

Jangan commit `.env`, `.wwebjs_auth`, atau `.wwebjs_cache`. Jangan masukkan token backend ke payload. Auth header belum dikonfigurasi, jadi pasang auth di reverse proxy atau tambahkan transport auth sebelum expose endpoint ke internet.

## Test

```bash
pnpm test
```

Expected:

```text
8 passed
0 failed
```

## Troubleshooting

`Missing BACKEND_URL`

- Copy `.env.example` menjadi `.env`.
- Pastikan environment variable tersedia di shell atau Docker.

QR muncul setiap restart

- Pastikan volume `.wwebjs_auth` dipersist.
- Jangan hapus folder atau Docker volume auth.

Backend tidak membalas

- Pastikan endpoint menerima `POST` JSON.
- Pastikan response punya field string `text`.
- Test URL dari environment gateway, bukan hanya dari host.
