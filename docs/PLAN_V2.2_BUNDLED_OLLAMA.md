# Nihongo Whisper v2.2 — Bundled Ollama + Qwen3 1.7B

## Tujuan

Menyediakan backend terjemahan dan kesimpulan offline yang siap digunakan tanpa meminta API berbayar. Versi dinaikkan dari `2.1.0` menjadi `2.2.0`.

## Resource yang dipasang

- Runtime Ollama Windows di `resources/ollama/standalone`.
- Model `qwen3:1.7b` di model store `resources/ollama/models`.
- Model Whisper `ggml-base.bin` tetap dipakai untuk transkripsi.

## Tahapan

1. Unduh distribusi Ollama Windows dari sumber resmi.
2. Ekstrak runtime ke resource aplikasi.
3. Jalankan server sementara pada `127.0.0.1:11435` dengan `OLLAMA_MODELS` mengarah ke model store aplikasi.
4. Unduh `qwen3:1.7b` melalui Ollama ke model store tersebut.
5. Hentikan server sementara setelah verifikasi.
6. Naikkan versi dan direktori rilis menjadi v2.2.
7. Perbarui dokumentasi dan environment checker.
8. Tambahkan panel Settings untuk status runtime, daftar model terpasang, refresh, dan pemilihan model aktif.
9. Sambungkan pilihan model melalui preload/IPC ke translator lokal.
10. Simpan model aktif di konfigurasi user agar pilihan Settings bertahan setelah aplikasi ditutup.

## Risiko

- Unduhan runtime dan model berukuran besar serta dapat terputus.
- Antivirus Windows dapat memindai atau menahan executable baru.
- Model membutuhkan RAM yang cukup dan respons pertama dapat lambat.
- Resource besar tetap diabaikan Git, tetapi akan dimasukkan oleh electron-builder ketika packaging.

## Verifikasi

- `ollama.exe` dapat dijalankan.
- Endpoint lokal `/api/tags` mengenali `qwen3:1.7b`.
- Settings menampilkan runtime/model dan dapat mengaktifkan model yang dipilih.
- Prompt terjemahan Jepang menghasilkan Bahasa Indonesia.
- `npm run check:env` menyatakan resource offline tersedia.
- `npm run build` berhasil.
