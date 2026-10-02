# Nihongo Whisper

Nihongo Whisper adalah aplikasi desktop Windows untuk mendengarkan audio
berbahasa Jepang, membuat transkrip Jepang, menerjemahkannya ke Bahasa
Indonesia, dan menyusun kesimpulan percakapan melalui perintah suara.

> Status: development preview (`2.3.0`). Project ini belum merupakan rilis
> stabil dan akurasi transkripsi realtime masih sedang dikembangkan.

## Fitur

- Transkripsi offline menggunakan `whisper.cpp`.
- Terjemahan offline menggunakan bundled Ollama dan `qwen3:1.7b`.
- Halaman Settings terpisah untuk engine, model, dan parameter audio.
- Perintah suara untuk membuat kesimpulan pembicaraan sebelumnya.
- **Session Notes (v2.4):** setiap sesi tersimpan sebagai note di
  `%APPDATA%/nihongo-whisper-desktop/notes/`, lengkap dengan transkrip, terjemahan,
  dan kesimpulan. Buka tab **History** untuk mencari, mengganti judul, menyalin,
  export Markdown, menghapus, atau melanjutkan sesi.
- **Audio sistem (v2.4):** pilih sumber audio *Audio sistem (Zoom/Meet)* atau
  *Mikrofon + audio sistem* untuk menerjemahkan suara dari Zoom, Google Meet,
  Teams, YouTube, dll. Audio ditangkap via WASAPI loopback dan ditranskripsi oleh
  `whisper-server.exe` secara lokal.

Versi 2.4 bersifat offline-only dan tidak memiliki jalur API berbayar. Audio
ditranskripsikan secara lokal menggunakan whisper.cpp. Perlu diperhatikan bahwa
whisper.cpp hanya membuat teks dan bukan mesin terjemahan.

## Menjalankan Versi Development

Prasyarat:

- Windows 10 atau Windows 11.
- Node.js 20 atau lebih baru.
- Model Whisper format GGML di `resources/models`.
- Ollama beserta model lokal jika ingin menggunakan terjemahan offline.

Install dependency dan periksa environment:

```powershell
npm install
npm run check:env
```

Jalankan aplikasi dalam development mode:

```powershell
npm run dev
```

Periksa TypeScript dan buat production bundle:

```powershell
npm run build
```

Buat aplikasi Windows:

```powershell
npm run package
```

## Resource Lokal

Model AI dan runtime Ollama tidak disimpan di repository Git karena ukurannya
sangat besar. Letakkan resource lokal menggunakan struktur berikut:

```text
resources/
|-- models/
|   `-- ggml-large-v3-q5_0.bin
|-- ollama/
|   |-- standalone/
|   `-- models/
`-- whisper-bin/
    `-- Release/
        |-- whisper-stream.exe
        `-- whisper-cli.exe
```

Model Whisper GGML dapat diperoleh dari project
[whisper.cpp](https://github.com/ggml-org/whisper.cpp). Aplikasi memilih model
yang tersedia dengan prioritas:

```text
ggml-large-v3.bin
ggml-large-v3-q5_0.bin
ggml-large-v3-turbo.bin
ggml-large-v3-turbo-q5_0.bin
ggml-medium.bin
ggml-medium-q5_0.bin
ggml-small.bin
ggml-base.bin
```

## Perintah Kesimpulan

Aplikasi akan membuat kesimpulan dari transkrip sebelumnya jika mendengar:

```text
先の話から結論を出してください
```

Perintah dengan arti serupa juga didukung, misalnya:

```text
tolong ambil kesimpulan dari pembicaraan tadi
please draw a conclusion from the previous discussion
```

## Catatan Akurasi

Akurasi transkripsi offline dipengaruhi oleh microphone Windows, tingkat
noise, jarak pembicara, capture device, kemampuan CPU/GPU, model yang digunakan,
dan panjang potongan audio realtime. Mode offline menjaga audio tetap berada
di komputer. Nihongo Whisper v2.3 tidak mengirim audio ke layanan eksternal.
