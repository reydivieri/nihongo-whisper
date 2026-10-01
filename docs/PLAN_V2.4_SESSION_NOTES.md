# Nihongo Whisper v2.4 — Session Notes & History

## Tujuan

Setiap pembicaraan (dari **Start** sampai **Stop / New Session**) disimpan sebagai satu **Note** permanen di disk, lengkap dengan transkrip Jepang, terjemahan Indonesia, dan kesimpulan (conclusion). Pengguna dapat membuka, mencari, mengganti judul, mengekspor, dan menghapus note dari halaman **History**. Versi naik `2.3.0` → `2.4.0`.

## Kondisi sekarang (v2.3)

- History hanya di `localStorage` (`nihongo-whisper.transcript-history.v2`), satu list datar, maksimal 120 segmen.
- Tidak ada konsep "sesi": semua pembicaraan bercampur sampai `Clear Session` menghapus semuanya.
- Hasil `concludeDiscussion` hanya di state React — hilang saat restart.
- `localStorage` rentan: terhapus jika cache/profil Electron dibersihkan, dan tidak bisa dibuka di luar aplikasi.

## Desain

### Model data

```ts
type SessionNote = {
  id: string;              // contoh: 2026-10-02_14-05-33
  title: string;           // default: "Sesi 2 Okt 2026 14:05", bisa diubah
  createdAt: string;       // ISO
  updatedAt: string;
  endedAt?: string;
  whisperModel: string;    // ggml-large-v3-turbo.bin, dll
  translatorModel: string; // qwen3:1.7b, dll
  segments: Line[];        // tanpa batas 120 (batas aman mis. 5000)
  conclusion?: { text: string; createdAt: string };
  tags?: string[];
};
```

### Penyimpanan (main process)

- Folder: `app.getPath('userData')/notes/` → satu file `<id>.json` per sesi + `index.json` (id, title, tanggal, jumlah segmen, cuplikan) agar daftar cepat dimuat.
- Modul baru `src/main/notesStore.ts`:
  - `list()`, `get(id)`, `create(meta)`, `appendSegment(id, line)`, `updateSegment(id, line)`, `setConclusion(id, text)`, `rename(id, title)`, `delete(id)`, `exportMarkdown(id)`.
  - Tulis atomik (tulis `*.tmp` lalu `rename`) + debounce ±1 detik agar tidak menulis per token.
  - File rusak → dilewati & dicatat, tidak membuat app crash.
- IPC baru di `src/main/index.ts` + `src/preload/index.ts`: `notes:list`, `notes:get`, `notes:create`, `notes:save`, `notes:rename`, `notes:delete`, `notes:export`, `notes:open-folder`.

### Siklus sesi

1. **Start** pertama kali → buat note baru (jika belum ada sesi aktif).
2. Setiap transkrip masuk → `appendSegment`; setelah terjemahan selesai → `updateSegment`.
3. Conclusion (manual atau via perintah suara 「先の話から結論を出してください」) → `setConclusion`.
4. **Stop** → set `endedAt`, sesi tetap aktif (Start lagi melanjutkan sesi yang sama).
5. Tombol **New Session** (menggantikan `Clear Session`) → tutup sesi aktif, mulai yang baru. Tidak ada lagi penghapusan data diam-diam.
6. Saat app ditutup → flush tulisan tertunda di `before-quit`.

### UI (renderer)

- Tab baru **History** di sidebar (sejajar Monitor / Settings).
- Kiri: daftar note (judul, tanggal, durasi, jumlah segmen) + kotak pencarian (teks Jepang/Indonesia/judul).
- Kanan: detail note — transkrip lengkap, conclusion, tombol *Rename*, *Export .md*, *Copy*, *Delete* (dengan konfirmasi), *Lanjutkan sesi ini*.
- Header Monitor menampilkan judul sesi aktif.

### Migrasi

Saat pertama kali v2.4 dijalankan: jika `localStorage` v2 berisi data, impor menjadi satu note "Imported history", lalu hapus key lama.

## Langkah implementasi

1. `notesStore.ts` + unit test sederhana (baca/tulis/rusak).
2. IPC + preload + `types.ts`.
3. Refactor `App.tsx`: pecah jadi `MonitorView`, `SettingsView`, `HistoryView` (file sekarang 800 baris).
4. Sambungkan siklus sesi & migrasi.
5. Export Markdown + tombol "Open notes folder".
6. Update `README.md`, `CARA_PAKAI.md`, versi `2.4.0`, `npm run build`.

## Verifikasi

- Bicara → Stop → tutup app → buka lagi: note muncul di History dengan isi lengkap & conclusion.
- New Session menghasilkan note terpisah.
- Kill paksa proses saat bicara: kehilangan maksimal ±1 detik data, file tidak korup.
- Hapus / rename / export bekerja; file `.md` terbaca rapi.
- Data lama dari `localStorage` termigrasi.

---

## Tambahan: tangkap audio sistem (Zoom, Google Meet, dll)

- `whisper-stream` hanya bisa membaca perangkat input SDL (mikrofon), jadi audio sistem memakai jalur terpisah.
- Main process: `setDisplayMediaRequestHandler` menjawab `getDisplayMedia` dengan `audio: 'loopback'` (WASAPI loopback Windows).
- Renderer: stream mic dan/atau loopback dicampur di `AudioContext` 16 kHz → `SpeechChunker` (VAD energi, potong saat jeda 700 ms atau `Length ms`).
- Chunk dikirim via IPC `chunk:push` → `ChunkTranscriber` (`src/main/chunkTranscriber.ts`) yang menjalankan `whisper-server.exe` di `127.0.0.1:18781` dan memanggil `/inference`.
- Hasil memakai channel `whisper:transcript` yang sama, jadi terjemahan, kesimpulan, dan notes tidak berubah.

## Status implementasi

- [x] `notesStore.ts`, IPC, preload, types
- [x] Siklus sesi, New Session, migrasi localStorage, tab History
- [x] Export Markdown, buka folder notes
- [x] Sumber audio: Mikrofon / Audio sistem / Campuran
- [x] `npm run build` lolos; `whisper-server` diuji (health + /inference)
- [ ] Uji manual dengan meeting Zoom/Meet sungguhan
- [ ] Unit test (Vitest)

## Audit: yang masih kurang dari aplikasi

Aplikasi ini adalah **desktop app Electron (Windows)** — React + TypeScript (electron-vite), memakai `whisper.cpp` (`whisper-stream`) untuk transkripsi Jepang real-time dari mikrofon dan **Ollama** lokal (bundled, default `qwen3:1.7b`) untuk terjemahan ke Indonesia dan kesimpulan. Sepenuhnya offline.

| Prioritas | Kekurangan | Saran |
|---|---|---|
| Tinggi | History tidak permanen & tanpa sesi | Rencana v2.4 di atas |
| Tinggi | Conclusion hilang saat restart | Disimpan di note |
| Tinggi | Tidak ada test sama sekali | Tambah Vitest untuk `notesStore`, parser output whisper, `ollamaTranslator` |
| Sedang | "Accuracy" hanya estimasi dari volume/VAD, bukan confidence model | Ganti label menjadi "Kualitas sinyal" atau ambil token probability dari whisper |
| Sedang | `App.tsx` 800 baris monolitik | Pecah per view + custom hooks (`useAudioMonitor`, `useSession`) |
| Sedang | Tidak ada log file untuk debugging pengguna | Tulis log ke `userData/logs` (rotasi), tombol "Open logs" |
| Sedang | Hanya build `dir` / `portable`, tanpa installer & tanpa auto-update | Tambah target NSIS; opsional `electron-updater` |
| Sedang | Pemilihan model Whisper otomatis (urutan tetap), tidak bisa dipilih di UI | Dropdown model Whisper di Settings |
| Rendah | Hanya mikrofon; tidak bisa menangkap audio sistem (Zoom/YouTube) | Opsi loopback/system audio |
| Rendah | Tidak ada lint/format | ESLint + Prettier |
| Rendah | Tidak ada shortcut keyboard global (start/stop) | `globalShortcut` |
| Rendah | Tidak ada code signing | SmartScreen akan memperingatkan saat instalasi |
