export type OnlineTranscriptionInput = {
  bytes: number[];
  mimeType?: string;
  apiKey?: string;
  model?: string;
};

export type OnlineTranscriptionResult = {
  ok: boolean;
  text?: string;
  error?: string;
};

export class OpenAITranscriber {
  private apiKey = process.env.OPENAI_API_KEY ?? '';
  private model = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe';

  setConfig(config: { apiKey?: string; transcriptionModel?: string; model?: string }) {
    if (typeof config.apiKey === 'string') this.apiKey = config.apiKey.trim();
    const nextModel = config.transcriptionModel ?? config.model;
    if (typeof nextModel === 'string' && nextModel.trim()) this.model = nextModel.trim();
  }

  getStatus() {
    return {
      configured: Boolean(this.apiKey),
      model: this.model
    };
  }

  async transcribeAudio(input: OnlineTranscriptionInput): Promise<OnlineTranscriptionResult> {
    const key = (input.apiKey ?? this.apiKey).trim();
    const model = (input.model ?? this.model).trim() || 'gpt-4o-mini-transcribe';

    if (!key) {
      return { ok: false, error: 'OpenAI API key is required for Online transcription.' };
    }

    if (!input.bytes?.length) {
      return { ok: false, error: 'No audio chunk was received from the microphone.' };
    }

    try {
      const contentType = input.mimeType || 'audio/webm';
      const audio = new Blob([Uint8Array.from(input.bytes)], { type: contentType });
      const form = new FormData();
      form.append('file', audio, this.fileNameForMime(contentType));
      form.append('model', model);
      form.append('language', 'ja');
      form.append('response_format', 'json');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`
        },
        body: form
      });

      const raw = await response.text();
      let data: unknown = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message = this.extractErrorMessage(data) || raw || `${response.status} ${response.statusText}`;
        return { ok: false, error: `OpenAI transcription failed: ${message}` };
      }

      const text = this.extractText(data).trim();
      if (!text) return { ok: true, text: '' };
      return { ok: true, text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `OpenAI transcription fetch failed: ${message}. Check internet, firewall/proxy, API key, and model name.`
      };
    }
  }

  private extractText(data: unknown) {
    if (typeof data === 'object' && data && 'text' in data && typeof data.text === 'string') {
      return data.text;
    }
    return '';
  }

  private extractErrorMessage(data: unknown) {
    if (typeof data !== 'object' || !data || !('error' in data)) return '';
    const error = data.error;
    if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
      return error.message;
    }
    if (typeof error === 'string') return error;
    return '';
  }

  private fileNameForMime(mimeType: string) {
    if (mimeType.includes('mp4')) return 'audio.mp4';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'audio.mp3';
    if (mimeType.includes('wav')) return 'audio.wav';
    return 'audio.webm';
  }
}
