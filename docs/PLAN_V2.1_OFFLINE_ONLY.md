# Nihongo Whisper v2.1 — Offline-only

## Tujuan

Menghapus seluruh jalur OpenAI/API berbayar dan menjadikan aplikasi hanya menggunakan komponen lokal. Versi dinaikkan dari `2.0.0` menjadi `2.1.0`.

## Ruang lingkup

1. Hapus pilihan transkripsi Online dan konfigurasi OpenAI dari UI.
2. Hapus perekaman `MediaRecorder` serta pengiriman audio ke API.
3. Hapus IPC dan preload API yang berkaitan dengan OpenAI.
4. Hapus implementasi OpenAI dari transcriber dan translator.
5. Pertahankan `whisper.cpp` sebagai speech-to-text offline gratis.
6. Pertahankan visualizer mikrofon berbasis Web Audio; audio tidak dikirim keluar komputer.
7. Pertahankan terjemahan/kesimpulan lokal melalui runtime lokal. Jika runtime belum tersedia, tampilkan error yang jelas.
8. Perbarui dokumentasi, nomor versi, dan direktori rilis menjadi v2.1.

## Batasan

- `whisper.cpp` dan faster-whisper adalah mesin transkripsi, bukan mesin terjemahan.
- Setelah API dihapus, terjemahan Jepang–Indonesia memerlukan backend lokal terpisah.
- Pada v2.1 backend terjemahan lokal yang sudah ada tetap dipertahankan; penggantian Ollama dengan llama.cpp akan menjadi perubahan versi berikutnya dan membutuhkan planning tersendiri.

## Risiko

- Referensi OpenAI yang tertinggal dapat menyebabkan TypeScript atau runtime error.
- Penghapusan `MediaRecorder` tidak boleh mematikan stream Web Audio untuk visualizer.
- Dokumentasi lama dapat membuat user menyangka mode Online masih tersedia.

## Verifikasi

- Pencarian repository tidak menemukan OpenAI/API online pada source aplikasi.
- `npm run build` berhasil.
- Transkripsi lokal tetap memulai `whisper.cpp`.
- Visualizer dan selector mikrofon tetap berfungsi.
- Tidak ada input API key atau tombol Online pada UI.
