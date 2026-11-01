# Work Notes

Catatan pekerjaan yang ditunda. Satu butir = satu keputusan yang perlu diambil
lalu saat work item itu dibuka lagi.

Format:
- **Status**: `ditunda` | `siap` | `dikerjakan`
- **Tertunda sejak**: tanggal
- **Isi**: apa yang ditunda, temuan yang sudah dibuktikan, dan apa yang perlu diputuskan.

---

## Chat multi-turn di Terminal Ruang

**Status**: ditunda (permintaan user: "kita tinggalk dulu, dan tambahkan dalam catatan pekerjaan")
**Tertunda sejak**: 2026-11-01

### Permintaan
Pengguna ingin melakukan chat multi-turn dari halaman Terminal (Menu 4 di Admin Ruang),
bukan hanya satu perintah `hermes` sekali jalan.

### Kenapa Menu 4 saat ini satu-shot (bukan bug)
`server/exec-terminal.ts` menolak flag yang mengandung `-` pada argumen `chat`:

```ts
// hermes chat "one question"  (single answer, no streaming flags)
if (tail[0] === 'chat' && tail.length >= 2) {
  ...
  if (tail.slice(1).some((word) => word.startsWith('-'))) {
    throw new ExecTerminalError('chat here takes only the question text; flags stay in the real CLI.', 400, 'INVALID_COMMAND')
  }
  return ['chat', question.trim()]
}
```

Alasannya disengaja: `--resume <id>` di allowlist read-only bisa jadi jalan keluar dari
sesi yang hanya ber-token read-scoped.

### Bentuk multi-turn yang sebenarnya ada di Hermes (dari docs resmi)
```
hermes chat                    # interaktif di host, riwayat penuh
hermes --continue              # lanjutkan sesi CLI terakhir
hermes -c                      # short form dari --continue
hermes -c "judul"              # sesi bernama
hermes -c "judul" --create-if-missing
hermes --resume <id>           # resume by id, mis. 20260225_143052_a1b2c3
hermes --resume latest
hermes -z "pertanyaan"         # satu turn non-interaktif ke sesi berjalan
```

Kombinasi yang praktis untuk multi-turn:
```bash
hermes -c "catatan divider" --create-if-missing
hermes -c "catatan divider" -z "tulis 5 caption instagram"
```

### Keputusan yang perlu diambil sebelum dikerjakan
1. **Terminal multi-turn atau cukup `-c`/`-z` di host?**
   Kalau yang dibutuhkan cuma cara praktis, `hermes -c "<judul>" -z "<pertanyaan>"` di host
   mungkin sudah cukup dan tidak perlu mengubah kode Ruang sama sekali.
2. **Kalau memang mau lewat browser: `-z` boleh agent penuh dengan tools, atau dibatasi read-only?**
   - Agent penuh: satu turn bisa baca file / jalankan perintah / menulis. Lebih lambat,
     permukaan risiko lebih besar, dan tidak lagi read-only seperti desain Menu 4 sekarang.
   - Read-only: butuh daftar perIzinan per-verb — lebih banyak pekerjaan.
3. **Perilaku sesi di browser**: apakah Roomwa menyimpan `session_id` per tab, atau
   selalu pakai satu sesi global yang di-resume?

### Batasan teknis yang sudah diketahui
- Allowlist sekarang hanya menerima `hermes ...` sebagai argv pertama
  (`execFile` dengan argv array, bukan string shell — metacharakter shell ditolak).
- `hermes -z` itu flag top-level, jadi bentuknya berbeda dari allowlist `chat` yang ada.
- Output dipotong maksimum 8.000 karakter, timeout 120 detik, riwayat 30 baris.
- Vendor tidak boleh menjalankan terminal sama sekali (`403 adminOnly`).

### Verifikasi yang harus diulang saat dikerjakan
- Tambah test allowlist untuk bentuk baru (`-c`, `-z`, `--resume latest`).
- Pastikan test form penolakan flag tetap lulus (regresi).
- Deploy ulang Ruang (repo → build → tarball → host) dan cek bundle baru di live.
