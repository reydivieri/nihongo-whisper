/**
 * Splits a 16 kHz mono stream into speech chunks using a simple energy VAD.
 * A chunk is emitted after a pause in speech or once it reaches maxMs.
 */
export class SpeechChunker {
  private chunks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private speechSamples = 0;
  private silenceSamples = 0;
  private inSpeech = false;

  constructor(
    private readonly onChunk: (samples: Float32Array) => void,
    private readonly options: { sampleRate: number; maxMs: number; silenceMs?: number; thresholdDb?: number }
  ) {}

  push(input: Float32Array) {
    const frame = input.slice();
    let sumSquares = 0;
    for (const sample of frame) sumSquares += sample * sample;
    const rmsDb = 20 * Math.log10(Math.max(Math.sqrt(sumSquares / frame.length), 1e-8));
    const isVoice = rmsDb > (this.options.thresholdDb ?? -48);
    const { sampleRate } = this.options;

    if (!this.inSpeech) {
      this.preRoll.push(frame);
      if (this.preRoll.length > 2) this.preRoll.shift();
      if (!isVoice) return;
      this.inSpeech = true;
      this.chunks = [...this.preRoll];
      this.preRoll = [];
      this.speechSamples = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
      this.silenceSamples = 0;
      return;
    }

    this.chunks.push(frame);
    this.speechSamples += frame.length;
    this.silenceSamples = isVoice ? 0 : this.silenceSamples + frame.length;

    const pauseReached = this.silenceSamples >= ((this.options.silenceMs ?? 700) / 1000) * sampleRate;
    const maxReached = this.speechSamples >= (this.options.maxMs / 1000) * sampleRate;
    if (pauseReached || maxReached) this.flush();
  }

  flush() {
    if (this.chunks.length) {
      const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of this.chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this.onChunk(merged);
    }
    this.chunks = [];
    this.speechSamples = 0;
    this.silenceSamples = 0;
    this.inSpeech = false;
  }
}
