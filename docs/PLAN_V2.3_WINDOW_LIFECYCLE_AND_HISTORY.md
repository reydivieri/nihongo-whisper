# Nihongo Whisper v2.3 — Window Lifecycle & Transcript History

## Tujuan

Memperbaiki crash `Object has been destroyed` pada main process dan membuat seluruh session transcript tetap tersedia dengan scrollbar otomatis ketika area history penuh. Versi dinaikkan dari `2.2.0` menjadi `2.3.0`.

## Akar masalah

1. Callback `WhisperEngine` masih mencoba memanggil `webContents.send()` setelah jendela Electron ditutup/dihancurkan.
2. `mainWindow` tidak segera diubah menjadi `null` pada event `closed`.
3. UI hanya merender dua transcript terbaru dengan `lines.slice(0, 2)`.
4. CSS v2.2 memaksa `overflow: hidden` dan tinggi tetap pada daftar transcript.

## Perubahan

1. Tambahkan helper pengiriman IPC yang memeriksa `BrowserWindow.isDestroyed()` dan `webContents.isDestroyed()`.
2. Set `mainWindow = null` ketika jendela ditutup.
3. Pastikan shutdown child process tidak mengirim event ke window yang sudah tidak valid.
4. Render seluruh history session hingga batas internal 120 segmen.
5. Simpan history transcript ke `localStorage` agar tetap tersedia setelah reload/restart aplikasi.
6. Jadikan area history fleksibel dan aktifkan `overflow-y: auto` hanya saat konten melebihi ruang layar.
7. Pertahankan layout utama satu layar; scrollbar hanya muncul pada panel transcript.

## Risiko

- Data `localStorage` lama atau rusak harus diabaikan dengan aman.
- Callback proses dapat terjadi bersamaan dengan penutupan aplikasi.
- Transcript panjang tidak boleh mendorong visualizer dan panel live keluar layar.

## Verifikasi

- Menutup aplikasi saat whisper/Ollama aktif tidak memunculkan dialog JavaScript error.
- Semua transcript dalam sesi dirender, bukan hanya dua terbaru.
- Scrollbar muncul ketika history melebihi tinggi panel.
- History tetap ada setelah reload aplikasi dan dapat dihapus melalui `Clear Session`.
- `npm run build` berhasil.
