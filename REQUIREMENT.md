*Ringkasan Fitur WhatsApp Gateway (Hermes Profile: `ferdinand_assistant`)*

---

*1. *Routing Pesan**
| Chat Type | Aturan |
|-----------|--------|
| *DM* | Proses semua pesan teks |
| *Group + tag bot* | Proses (hanya mention resmi `mentionedJid`) |
| *Group tanpa tag* | Abaikan total (no log, no simpan, no proses) |
| *Tag bot lain* | Abaikan |
| *Duplikat `messageId`* | Tolak |

---

*2. *Reply / Quoted Message Context**
- Baca `quotedMessage` → ekstrak `text`, `sender_id`, `message_id`
- Gabungkan ke payload sebagai konteks terstruktur
- Quoted dari bot *ikut dibaca* untuk konteks
- Batas: *4.000 karakter*
- Quoted = *data*, bukan instruksi

---

*3. *Mention Balik (Response Mention)**
- *Group*: Wajib mention *semua user* yang men-tag bot (via `mentionedJid` metadata, bukan `@nama`)
- *DM*: Tidak perlu mention
- Multi-user tag → mention semua
- Mention gagal → kirim tetap, log error
- tambahkan fitur typing secara random antara 1-2 detik sebelum mengirim pesan

---

*4. *Media**
- *Belum diproses* (v1)
- Caption teks diproses kalau gateway nyediain
- File/gambar/audio/video/sticker/location/contact → abaikan

---

*5. *Identitas Bot**
- Nomor bot *otomatis dari koneksi WhatsApp* (bukan config manual)
- Deteksi mention pakai `mentionedJid` event
- Fallback parsing teks kalau metadata tidak ada

---

*6. *Privasi & Keamanan (Wajib)**
- Akses *hanya event WhatsApp aktif* — dilarang akses filesystem, DB, env, credential, API key
- *Redaksi data sensitif* sebelum: kirim ke model, log, quoted context
- Pola minimal: nomor telp, email, token/secret, URL privat, alamat, NIK/KTP, kartu kredit/rekening
- Tolak instruksi minta akses sistem/data privat
- *Jangan log isi pesan mentah*

---

*7. *Payload Internal Standar**
```json
{
  "chat_type": "dm|group",
  "chat_id": "...",
  "sender_id": "...",
  "message_id": "...",
  "text": "...",
  "is_bot_mentioned": true,
  "mentioned_bot_ids": ["..."],
  "reply": { "message_id": "...", "sender_id": "...", "text": "..." },
  "response_mentions": ["user_id_1", "user_id_2"]
}
```

---

*8. *Structured Logging Keputusan**
| Event | Keterangan |
|-------|------------|
| `processed_dm` | DM diproses |
| `processed_group_mention` | Group + tag bot diproses |
| `ignored_group_no_mention` | Group tanpa tag diabaikan |
| `ignored_group_other_bot` | Tag bot lain diabaikan |
| `reply_context_found` | Quoted message ada |
| `reply_context_missing` | Quoted tidak tersedia |
| `response_sender_mention_added` | Mention user berhasil |
| `response_sender_mention_failed` | Mention gagal, respons tetap kirim |
| `redacted_sensitive_data` | Data sensitif terdeteksi & disensor |

---

*9. *Urutan Implementasi**
1. Identifikasi format event gateway (Baileys/Venom/WPPConnect/custom)
2. Normalizer → payload standar (#7)
3. Filter routing (#1)
4. Quoted extractor + batas 4k (#2)
5. Redactor data sensitif (#6)
6. Gabungkan ke payload agent
7. Response sender dengan `mentions: [...]` (#3)
8. Structured logging (#8)
9. Test matrix 10 skenario

---

*10. *Blocker Saat Ini**
- ❌ Tidak ada akses shell/filesystem
- ❌ Source code gateway belum diberikan
- ⏳ Butuh: path repo / isi file handler / nama library gateway

---

*Next step*: Kirim source code / path repo gateway-nya, langsung mulai coding. 🚀