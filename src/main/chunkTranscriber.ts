import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { EngineStatus, TranscriptPayload } from './whisperEngine';

type ChunkTranscriberOptions = {
  onStatus: (payload: EngineStatus) => void;
  onTranscript: (payload: TranscriptPayload) => void;
  onError: (payload: { message: string }) => void;
};

export type ChunkTranscriberStartOptions = {
  threads?: number;
  beamSize?: number;
  noGpu?: boolean;
};

const PORT = 18781;
const SAMPLE_RATE = 16000;

/**
 * Transcribes audio chunks sent from the renderer (system audio / mixed audio)
 * through a long-running whisper-server so the model is loaded only once.
 */
export class ChunkTranscriber {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private queue: Promise<void> = Promise.resolve();
  private lastTranscript = '';

  constructor(private readonly options: ChunkTranscriberOptions) {}

  get isRunning() {
    return this.process !== null;
  }

  async start(startOptions: ChunkTranscriberStartOptions = {}) {
    if (this.process) return { ok: true };
    const resourcesPath = app.isPackaged ? process.resourcesPath : path.resolve(process.cwd(), 'resources');
    const executable = [
      path.join(resourcesPath, 'whisper-bin', 'whisper-server.exe'),
      path.join(resourcesPath, 'whisper-bin', 'Release', 'whisper-server.exe')
    ].find((candidate) => fs.existsSync(candidate));
    const model = resolveWhisperModel(resourcesPath);

    if (!executable) return this.fail('whisper-server.exe tidak ditemukan di resources/whisper-bin.');
    if (!model) return this.fail(`Model Whisper tidak ditemukan di ${path.join(resourcesPath, 'models')}.`);

    const args = [
      '-m', model,
      '-l', 'ja',
      '-t', String(startOptions.threads ?? 8),
      '-bs', String(startOptions.beamSize ?? 5),
      '--host', '127.0.0.1',
      '--port', String(PORT),
      '-nf'
    ];
    if (startOptions.noGpu) args.push('-ng');

    this.options.onStatus({ state: 'starting', message: `Memuat ${path.basename(model)} untuk audio sistem...` });
    this.lastTranscript = '';
    this.process = spawn(executable, args, { cwd: path.dirname(executable) });
    this.process.stdout.on('data', () => undefined);
    this.process.stderr.on('data', () => undefined);
    this.process.on('exit', (code) => {
      const wasReady = this.ready;
      this.process = null;
      this.ready = false;
      if (code && code !== 0) this.options.onError({ message: `whisper-server berhenti (exit code ${code}).` });
      if (wasReady || code) this.options.onStatus({ state: 'stopped', message: 'System audio listener stopped.' });
    });

    for (let attempt = 0; attempt < 120 && this.process; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/`);
        if (response.ok || response.status === 404) {
          this.ready = true;
          this.options.onStatus({ state: 'running', message: `Listening to system audio with ${path.basename(model)}.` });
          return { ok: true };
        }
      } catch {
        // Server is still loading the model.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await this.stop();
    return this.fail('whisper-server tidak merespons. Coba nonaktifkan GPU atau gunakan model yang lebih kecil.');
  }

  async stop() {
    this.process?.kill();
    this.process = null;
    this.ready = false;
    this.options.onStatus({ state: 'stopped', message: 'System audio listener stopped.' });
  }

  /** Queues a mono 16 kHz Float32 chunk for transcription. */
  pushChunk(samples: Float32Array) {
    if (!this.ready || samples.length < SAMPLE_RATE * 0.4) return;
    this.queue = this.queue.then(() => this.transcribe(samples)).catch((error) => {
      this.options.onError({ message: `Transkripsi audio sistem gagal: ${error instanceof Error ? error.message : String(error)}` });
    });
  }

  private async transcribe(samples: Float32Array) {
    if (!this.ready) return;
    const form = new FormData();
    form.append('file', new Blob([encodeWav(samples)], { type: 'audio/wav' }), 'chunk.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0.0');
    const response = await fetch(`http://127.0.0.1:${PORT}/inference`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = (await response.json()) as { text?: string; error?: string };
    if (result.error) throw new Error(result.error);
    const text = cleanTranscript(result.text ?? '');
    if (!text || text === this.lastTranscript) return;
    this.lastTranscript = text;
    this.options.onTranscript({ text, raw: result.text ?? '', timestamp: new Date().toISOString() });
  }

  private fail(message: string) {
    this.options.onError({ message });
    this.options.onStatus({ state: 'stopped', message: 'System audio listener unavailable.' });
    return { ok: false, error: message };
  }
}

export const resolveWhisperModel = (resourcesPath: string) =>
  [
    'ggml-large-v3.bin',
    'ggml-large-v3-q5_0.bin',
    'ggml-large-v3-turbo.bin',
    'ggml-large-v3-turbo-q5_0.bin',
    'ggml-medium.bin',
    'ggml-medium-q5_0.bin',
    'ggml-small.bin',
    'ggml-base.bin'
  ]
    .map((name) => path.join(resourcesPath, 'models', name))
    .find((candidate) => fs.existsSync(candidate));

const silenceHallucinations = [
  'ご視聴ありがとうございました',
  'ご視聴ありがとうございます',
  'ご覧いただきありがとうございました',
  'ありがとうございました',
  'thankyouforwatching',
  'thanksforwatching'
];

const cleanTranscript = (raw: string) => {
  const text = raw
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([、。！？,.!?])/g, '$1')
    .trim();
  if (!text) return '';
  if (/^\(?(音楽|music|拍手|applause)\)?$/i.test(text)) return '';
  if (silenceHallucinations.includes(text.replace(/\s+/g, '').toLowerCase())) return '';
  if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9]/u.test(text)) return '';
  return text;
};

const encodeWav = (samples: Float32Array) => {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), 44 + i * 2);
  }
  return buffer;
};
