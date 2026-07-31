import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type EngineStatus = {
  state: 'starting' | 'running' | 'stopped';
  message: string;
};

export type TranscriptPayload = {
  text: string;
  raw: string;
  timestamp: string;
};

export type ListeningOptions = {
  captureId?: number;
  stepMs?: number;
  lengthMs?: number;
  keepMs?: number;
  maxTokens?: number;
  vadThreshold?: number;
  threads?: number;
  beamSize?: number;
  audioContext?: number;
  stabilizeMs?: number;
  noGpu?: boolean;
};

type NormalizedListeningOptions = Required<ListeningOptions>;

type WhisperEngineOptions = {
  onStatus: (payload: EngineStatus) => void;
  onTranscript: (payload: TranscriptPayload) => void;
  onError: (payload: { message: string }) => void;
};

export class WhisperEngine {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly options: WhisperEngineOptions;
  private lastTranscript = '';
  private pendingTranscript = '';
  private pendingRaw = '';
  private flushTimer: NodeJS.Timeout | null = null;
  private activeOptions: NormalizedListeningOptions | null = null;

  constructor(options: WhisperEngineOptions) {
    this.options = options;
  }

  get isRunning() {
    return this.process !== null;
  }

  async start(options: ListeningOptions = {}) {
    const resourcesPath = app.isPackaged ? process.resourcesPath : path.resolve(process.cwd(), 'resources');
    const executable = this.resolveWhisperExecutable(resourcesPath);
    const model = this.resolveWhisperModel(resourcesPath);
    const listeningOptions = this.normalizeOptions(options);
    this.activeOptions = listeningOptions;
    this.lastTranscript = '';
    this.pendingTranscript = '';
    this.pendingRaw = '';

    const args = [
      '-m',
      model,
      '-l',
      'ja',
      '-t',
      String(listeningOptions.threads),
      '-c',
      String(listeningOptions.captureId),
      '--step',
      String(listeningOptions.stepMs),
      '--length',
      String(listeningOptions.lengthMs),
      '--keep',
      String(listeningOptions.keepMs),
      '--max-tokens',
      String(listeningOptions.maxTokens),
      '--beam-size',
      String(listeningOptions.beamSize),
      '--audio-ctx',
      String(listeningOptions.audioContext),
      '--vad-thold',
      String(listeningOptions.vadThreshold),
      '--no-fallback'
    ];

    if (listeningOptions.noGpu) args.push('--no-gpu');

    this.options.onStatus({
      state: 'starting',
      message: `Starting Japanese listener with ${path.basename(model)} on capture ${listeningOptions.captureId}...`
    });

    try {
      this.process = spawn(executable, args, { cwd: path.dirname(executable) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onError({ message });
      return { ok: false, error: message };
    }

    this.process.stdout.on('data', (chunk: Buffer) => {
      const raw = chunk.toString('utf8');
      for (const line of raw.split(/\r|\n/)) {
        const text = this.cleanTranscriptLine(line);
        if (text) this.queueTranscript(text, line);
      }
    });

    this.process.stderr.on('data', (chunk: Buffer) => {
      const message = this.cleanStatusLine(chunk.toString('utf8'));
      if (message) this.options.onStatus({ state: 'running', message });
    });

    this.process.on('exit', () => {
      this.flushTranscript();
      this.process = null;
      this.options.onStatus({ state: 'stopped', message: 'Whisper stream stopped.' });
    });

    this.options.onStatus({ state: 'running', message: `Listening with ${path.basename(model)}.` });
    return { ok: true };
  }

  async stop() {
    if (!this.process) return;
    this.process.kill();
    this.flushTranscript();
    this.process = null;
    this.options.onStatus({ state: 'stopped', message: 'Whisper stream stopped.' });
  }

  private cleanTranscriptLine(line: string) {
    const text = this.stripTerminalNoise(line)
      .replace(/^\[[^\]]+\]\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return '';
    if (/^(whisper_|main:|system_info|processing|capture|init|audio|error:|warning:)/i.test(text)) return '';
    if (/^\(?(音楽|music|拍手|applause)\)?$/i.test(text)) return '';
    if (this.isLikelySilenceHallucination(text)) return '';
    if (/^\[[0-9:.>\-\s]+\]$/.test(text)) return '';
    if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9]/u.test(text)) return '';
    return text;
  }

  private cleanStatusLine(line: string) {
    return this.stripTerminalNoise(line).replace(/\s+/g, ' ').trim();
  }

  private stripTerminalNoise(text: string) {
    return text
      .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .replace(/\u25A1?\[2K/g, '')
      .replace(/\u25A1/g, '');
  }

  private queueTranscript(text: string, raw: string) {
    const normalized = this.normalizeTranscript(text);
    if (!normalized || normalized === this.lastTranscript) return;

    if (this.lastTranscript) {
      const duplicateFragment = normalized.length < 10 && this.lastTranscript.includes(normalized);
      const tinyCorrection = normalized.length <= 3;
      if (duplicateFragment || tinyCorrection) return;
    }

    this.pendingTranscript = normalized;
    this.pendingRaw = raw;

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushTranscript(), this.activeOptions?.stabilizeMs ?? 1600);
  }

  private flushTranscript() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const text = this.pendingTranscript;
    if (!text || text === this.lastTranscript) return;

    this.lastTranscript = text;
    this.options.onTranscript({
      text,
      raw: this.pendingRaw,
      timestamp: new Date().toISOString()
    });

    this.pendingTranscript = '';
    this.pendingRaw = '';
  }

  private normalizeTranscript(text: string) {
    return text
      .replace(/\s+([、。！？,.!?])/g, '$1')
      .replace(/([「（])\s+/g, '$1')
      .replace(/\s+([」）])/g, '$1')
      .trim();
  }

  private isLikelySilenceHallucination(text: string) {
    const normalized = text.replace(/\s+/g, '').trim().toLowerCase();
    const commonSilenceOutputs = [
      'ご視聴ありがとうございました',
      'ご視聴ありがとうございます',
      'ご覧いただきありがとうございました',
      'ありがとうございました',
      'thankyouforwatching',
      'thanksforwatching'
    ];

    return commonSilenceOutputs.includes(normalized);
  }

  private normalizeOptions(options: ListeningOptions): NormalizedListeningOptions {
    return {
      captureId: this.clampInteger(options.captureId, -1, 64, -1),
      stepMs: this.clampInteger(options.stepMs, 1000, 10000, 5000),
      lengthMs: this.clampInteger(options.lengthMs, 4000, 30000, 18000),
      keepMs: this.clampInteger(options.keepMs, 0, 4000, 500),
      maxTokens: this.clampInteger(options.maxTokens, 16, 224, 96),
      vadThreshold: this.clampNumber(options.vadThreshold, 0.2, 0.95, 0.68),
      threads: this.clampInteger(options.threads, 1, 16, 8),
      beamSize: this.clampInteger(options.beamSize, 1, 8, 5),
      audioContext: this.clampInteger(options.audioContext, 0, 2048, 0),
      stabilizeMs: this.clampInteger(options.stabilizeMs, 300, 4000, 2200),
      noGpu: Boolean(options.noGpu)
    };
  }

  private clampInteger(value: unknown, min: number, max: number, fallback: number) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  private resolveWhisperExecutable(resourcesPath: string) {
    const candidates = [
      path.join(resourcesPath, 'whisper-bin', 'whisper-stream.exe'),
      path.join(resourcesPath, 'whisper-bin', 'Release', 'whisper-stream.exe')
    ];

    const executable = candidates.find((candidate) => fs.existsSync(candidate));
    return executable ?? candidates[0];
  }

  private resolveWhisperModel(resourcesPath: string) {
    const candidates = [
      path.join(resourcesPath, 'models', 'ggml-large-v3.bin'),
      path.join(resourcesPath, 'models', 'ggml-large-v3-q5_0.bin'),
      path.join(resourcesPath, 'models', 'ggml-large-v3-turbo.bin'),
      path.join(resourcesPath, 'models', 'ggml-large-v3-turbo-q5_0.bin'),
      path.join(resourcesPath, 'models', 'ggml-medium.bin'),
      path.join(resourcesPath, 'models', 'ggml-medium-q5_0.bin'),
      path.join(resourcesPath, 'models', 'ggml-small.bin'),
      path.join(resourcesPath, 'models', 'ggml-base.bin')
    ];

    const model = candidates.find((candidate) => fs.existsSync(candidate));
    return model ?? candidates[candidates.length - 1];
  }
}
