# Cara Pakai Nihongo Whisper v1.8

## Lokasi Aplikasi

Buka aplikasi dari file ini:

```text
C:\Assetcom\Asset File\whisper\release-v2.2\win-unpacked\Nihongo Whisper.exe
```

## Penjelasan Masalah Listening

Jika yang diucapkan dan yang tertulis berbeda, masalahnya terjadi sebelum terjemahan, yaitu di tahap transkripsi suara menjadi teks Jepang.

Model besar sudah tersedia, tetapi model besar tetap bisa menebak teks saat input berupa hening, noise, atau suara dari microphone yang salah. Karena itu v1.8 memperbaiki pipeline offline:

- VAD lebih tinggi agar noise tidak mudah dianggap suara.
- Konteks salah dari chunk sebelumnya tidak dibawa terus.
- Fallback guessing dimatikan dengan `--no-fallback`.
- Audio context memakai `0` agar model memakai konteks audio penuh.
- Hallucination umum saat hening, seperti `ご視聴ありがとうございました`, difilter.

## Rekomendasi Mode

### Paling Privat

Gunakan:

```text
Transcription Engine: Offline
Translation Mode: Offline
```

Semua proses tetap di PC. Gunakan headset atau microphone dekat pembicara untuk hasil terbaik.

### Paling Akurat dan Cepat

Gunakan:

```text
Transcription Engine: Offline (whisper.cpp)
Translation Mode: Offline
```

Audio microphone diproses lokal oleh whisper.cpp dan tidak dikirim ke layanan eksternal.

## Cara Menjalankan

1. Buka:

```text
C:\Assetcom\Asset File\whisper\release-v2.2\win-unpacked\Nihongo Whisper.exe
```

2. Buka halaman `Settings`.

3. Pilih `Transcription Engine`.

4. Pilih `Translation Mode`.

5. Kembali ke halaman `Monitor`, lalu klik:

```text
Start Listening
```

6. Bicara menggunakan bahasa Jepang.

7. Hasil muncul di panel `Japanese transcript` dan `Bahasa Indonesia`.

## Perintah Membuat Kesimpulan

Jika ingin aplikasi membuat kesimpulan dari pembicaraan sebelumnya, ucapkan:

```text
先の話から結論を出してください
```

Aplikasi juga mencoba memahami kalimat yang artinya mirip:

```text
tolong ambil kesimpulan dari pembicaraan tadi
please draw a conclusion from the previous discussion
```

## Model Besar Untuk Offline

v1.8 otomatis memakai model offline terbesar yang tersedia di:

```text
C:\Assetcom\Asset File\whisper\resources\models
```

Urutan prioritas:

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

Catatan:

- `medium` lebih akurat dari `small/base`, tetapi butuh sekitar 2 GB memori.
- `large-v3` lebih akurat lagi, tetapi butuh sekitar 4 GB memori dan lebih berat.
- Jika Start Listening terasa lambat, gunakan `large-v3-turbo` atau `medium`.

## Listening Tuning Untuk Offline

Bagian `Listening Tuning` hanya memengaruhi `Transcription Engine: Offline`.

Default v1.8 memakai preset Balanced yang lebih ketat terhadap noise:

```text
Capture device ID: -1
Threads: 8
Step ms: 5000
Length ms: 18000
Keep ms: 500
Max tokens: 96
VAD threshold: 0.68
Beam size: 5
Audio context: 0
Stabilize ms: 2200
Disable GPU: off
```

Catatan:

- `Capture device ID -1` berarti microphone default Windows.
- Jika aplikasi mendengar device yang salah, coba `0`, `1`, atau `2`.
- Gunakan preset `Accurate` jika transkrip Jepang masih tidak sesuai.
- Gunakan preset `Fast` jika latency lebih penting daripada akurasi.
- Jika meeting keluar dari speaker laptop, hasil microphone bisa buruk. Headset atau audio loopback/virtual cable biasanya lebih baik.

## Status Versi Saat Ini

Versi ini dipackage sebagai aplikasi Windows `1.8.0`.
