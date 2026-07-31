# Nihongo Whisper

Nihongo Whisper adalah aplikasi desktop Windows untuk mendengarkan audio
berbahasa Jepang, membuat transkrip Jepang, menerjemahkannya ke Bahasa
Indonesia, dan menyusun kesimpulan percakapan melalui perintah suara.

> Status: development preview (`1.8.0`). Project ini belum merupakan rilis
> stabil dan akurasi transkripsi realtime masih sedang dikembangkan.

## Fitur

- Transkripsi offline menggunakan `whisper.cpp`.
- Transkripsi online menggunakan OpenAI Speech-to-Text.
- Terjemahan offline menggunakan Ollama dan `qwen3:1.7b`.
- Terjemahan online menggunakan OpenAI.
- Halaman Settings terpisah untuk engine, model, dan parameter audio.
- Perintah suara untuk membuat kesimpulan pembicaraan sebelumnya.

Transcription Engine dan Translation Mode dapat dipilih secara terpisah.
Mode online memerlukan koneksi internet, OpenAI API key, dan saldo API
terpisah dari langganan ChatGPT.

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

## Mode Online OpenAI

API key dapat dimasukkan dari halaman Settings atau melalui environment
variable:

```powershell
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_MODEL="gpt-4o-mini"
$env:OPENAI_TRANSCRIBE_MODEL="gpt-4o-mini-transcribe"
```

Jangan menyimpan API key asli di source code atau melakukan commit terhadap
file `.env`.

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
di komputer. Mode online mengirim potongan audio ke layanan OpenAI.
