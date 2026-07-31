import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

type OllamaGenerateResponse = {
  response?: string;
  thinking?: string;
  error?: string;
};

type TranslationMode = 'offline' | 'online';

type OpenAIResponsesPayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

type TextResult = {
  ok: boolean;
  text: string;
  error?: string;
};

export class OllamaTranslator {
  readonly baseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11435';
  readonly model = process.env.OLLAMA_MODEL ?? 'qwen3:1.7b';
  private mode: TranslationMode = 'offline';
  private openAiApiKey = process.env.OPENAI_API_KEY ?? '';
  private openAiModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  private process: ChildProcessWithoutNullStreams | null = null;
  private serverError = '';

  setMode(mode: TranslationMode) {
    this.mode = mode;
  }

  setOpenAIConfig(config: { apiKey?: string; model?: string }) {
    if (typeof config.apiKey === 'string') this.openAiApiKey = config.apiKey.trim();
    if (typeof config.model === 'string' && config.model.trim()) this.openAiModel = config.model.trim();
  }

  getStatus() {
    return {
      mode: this.mode,
      ollamaUrl: this.baseUrl,
      ollamaModel: this.model,
      openAiModel: this.openAiModel,
      openAiConfigured: Boolean(this.openAiApiKey)
    };
  }

  async translateJapaneseToIndonesian(text: string) {
    const cleanText = text.trim();
    if (!cleanText) return { ok: true, translation: '' };

    const prompt = [
      'Terjemahkan teks Jepang berikut ke Bahasa Indonesia yang natural dan ringkas.',
      'Jangan tambahkan penjelasan. Jawab hanya hasil terjemahan.',
      '',
      cleanText
    ].join('\n');

    const result = this.mode === 'online'
      ? await this.generateWithOpenAI(prompt)
      : await this.generateWithOllama(prompt);

    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, translation: result.text.trim() };
  }

  async isConclusionCommand(text: string) {
    const cleanText = text.trim();
    if (!cleanText) return { ok: true, isCommand: false };

    if (this.matchesConclusionCommand(cleanText)) {
      return { ok: true, isCommand: true };
    }

    const prompt = [
      'Tentukan apakah teks berikut adalah perintah untuk membuat kesimpulan dari pembicaraan sebelumnya.',
      'Perintah bisa dalam bahasa Jepang, Indonesia, atau Inggris.',
      'Contoh makna yang cocok: "先の話から結論を出してください", "ambil kesimpulan dari pembicaraan tadi", "please draw a conclusion from the previous discussion".',
      'Jawab hanya YES atau NO.',
      '',
      cleanText
    ].join('\n');

    const response = this.mode === 'online'
      ? await this.generateWithOpenAI(prompt)
      : await this.generateWithOllama(prompt);

    if (!response.ok) return { ok: false, error: response.error, isCommand: false };
    return { ok: true, isCommand: /^yes\b/i.test(response.text.trim()) };
  }

  async concludeDiscussion(transcript: string) {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) {
      return { ok: false, error: 'Belum ada transkrip sebelumnya untuk disimpulkan.' };
    }

    const prompt = [
      'Buat kesimpulan dari pembicaraan berikut dalam Bahasa Indonesia.',
      'Fokus pada keputusan, inti pembahasan, alasan utama, dan langkah berikutnya bila ada.',
      'Jangan menerjemahkan baris demi baris. Jawab ringkas tetapi jelas.',
      '',
      cleanTranscript
    ].join('\n');

    const response = this.mode === 'online'
      ? await this.generateWithOpenAI(prompt)
      : await this.generateWithOllama(prompt);

    if (!response.ok) return { ok: false, error: response.error };
    return { ok: true, conclusion: response.text.trim() };
  }

  private async generateWithOllama(prompt: string): Promise<TextResult> {
    const ready = await this.ensureServer();
    if (!ready.ok) return { ok: false, text: '', error: ready.error };

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          think: false,
          options: {
            temperature: 0.1,
            num_predict: 512
          }
        })
      });

      const payload = (await response.json()) as OllamaGenerateResponse;
      if (!response.ok) {
        return { ok: false, error: payload.error ?? `Ollama returned HTTP ${response.status}.`, text: '' };
      }

      if (payload.error) return { ok: false, error: payload.error, text: '' };
      const text = payload.response?.trim() || payload.thinking?.trim() || '';
      if (!text) return { ok: false, error: 'Ollama returned an empty translation.', text: '' };
      return { ok: true, text };
    } catch (error) {
      return { ok: false, text: '', error: this.describeNetworkError('Ollama offline translation', error) };
    }
  }

  private async generateWithOpenAI(prompt: string): Promise<TextResult> {
    if (!this.openAiApiKey) {
      return { ok: false, error: 'OpenAI API key belum disimpan. Buka Settings, isi API key, lalu klik Save OpenAI settings.', text: '' };
    }

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.openAiModel,
          input: prompt
        })
      });

      const payload = (await response.json()) as OpenAIResponsesPayload;
      if (!response.ok) {
        return { ok: false, error: payload.error?.message ?? `OpenAI returned HTTP ${response.status}.`, text: '' };
      }

      const text = this.extractOpenAIText(payload);
      if (!text) return { ok: false, error: 'OpenAI returned an empty response.', text: '' };
      return { ok: true, text };
    } catch (error) {
      return { ok: false, text: '', error: this.describeNetworkError('OpenAI online translation', error) };
    }
  }

  private matchesConclusionCommand(text: string) {
    const normalized = text.toLowerCase();
    return [
      /先.*話.*結論/,
      /これまで.*話.*結論/,
      /結論.*出して/,
      /まとめて.*結論/,
      /ambil.*kesimpulan/,
      /buat.*kesimpulan/,
      /tolong.*kesimpulan/,
      /simpulkan.*pembicaraan/,
      /draw.*conclusion/,
      /make.*conclusion/,
      /summari[sz]e.*discussion/,
      /conclude.*discussion/
    ].some((pattern) => pattern.test(normalized));
  }

  private extractOpenAIText(payload: OpenAIResponsesPayload) {
    const directText = payload.output_text?.trim();
    if (directText) return directText;

    const parts = payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text?.trim() ?? '')
      .filter(Boolean);

    return parts?.join('\n').trim() ?? '';
  }

  private async ensureServer() {
    if (await this.isServerReady()) return { ok: true };

    const executable = this.resolveOllamaExecutable();
    if (!executable) {
      return { ok: false, error: 'Ollama executable tidak ditemukan di resources/ollama/standalone.' };
    }

    const modelsPath = path.join(this.resourcesPath(), 'ollama', 'models');
    if (!fs.existsSync(modelsPath)) {
      return { ok: false, error: `Ollama model store tidak ditemukan: ${modelsPath}` };
    }

    this.serverError = '';
    const ollamaLibPath = path.join(path.dirname(executable), 'lib', 'ollama');
    const pathEnv = [path.dirname(executable), ollamaLibPath, process.env.PATH ?? ''].join(path.delimiter);

    this.process = spawn(executable, ['serve'], {
      env: {
        ...process.env,
        OLLAMA_HOST: '127.0.0.1:11435',
        OLLAMA_MODELS: modelsPath,
        PATH: pathEnv
      },
      cwd: path.dirname(executable),
      windowsHide: true
    });

    this.process.stderr.on('data', (chunk: Buffer) => {
      this.serverError = chunk.toString('utf8').trim();
    });

    this.process.on('exit', () => {
      this.process = null;
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await this.isServerReady()) {
        const modelReady = await this.isModelAvailable();
        if (!modelReady) {
          return { ok: false, error: `Ollama berjalan, tetapi model ${this.model} tidak ditemukan di model store aplikasi.` };
        }
        return { ok: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      ok: false,
      error: this.serverError
        ? `Ollama local server gagal siap: ${this.serverError}`
        : 'Ollama local server tidak siap dalam 30 detik.'
    };
  }

  private async isServerReady() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async isModelAvailable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return false;
      const payload = (await response.json()) as { models?: Array<{ name?: string }> };
      return payload.models?.some((model) => model.name === this.model) ?? false;
    } catch {
      return false;
    }
  }

  private describeNetworkError(label: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/fetch failed/i.test(message)) {
      return `${label} gagal terhubung. Periksa koneksi internet/proxy/firewall untuk Online, atau coba mode Offline. Detail: ${message}`;
    }
    return `${label} gagal: ${message}`;
  }

  private resolveOllamaExecutable() {
    const candidates = [
      path.join(this.resourcesPath(), 'ollama', 'standalone', 'ollama.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe')
    ];

    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  private resourcesPath() {
    return app.isPackaged ? process.resourcesPath : path.resolve(process.cwd(), 'resources');
  }
}
