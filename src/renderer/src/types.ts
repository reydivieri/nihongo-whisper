export type EngineStatus = {
  state: 'starting' | 'running' | 'stopped';
  message: string;
};

export type TranscriptPayload = {
  text: string;
  raw: string;
  timestamp: string;
};

export type TranslationResult = {
  ok: boolean;
  translation?: string;
  error?: string;
};

export type CommandDetectionResult = {
  ok: boolean;
  isCommand: boolean;
  error?: string;
};

export type ConclusionResult = {
  ok: boolean;
  conclusion?: string;
  error?: string;
};

export type TranslationMode = 'offline' | 'online';
export type TranscriptionMode = 'offline' | 'online';

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

export type OnlineTranscriptionResult = {
  ok: boolean;
  text?: string;
  error?: string;
};

declare global {
  interface Window {
    nihongoWhisper: {
      getStatus: () => Promise<unknown>;
      startWhisper: (options?: ListeningOptions) => Promise<{ ok: boolean; error?: string }>;
      stopWhisper: () => Promise<{ ok: boolean; error?: string }>;
      setTranslatorMode: (mode: TranslationMode) => Promise<unknown>;
      setOpenAIConfig: (config: { apiKey?: string; model?: string; transcriptionModel?: string }) => Promise<unknown>;
      transcribeOnlineAudio: (input: {
        bytes: number[];
        mimeType?: string;
        model?: string;
      }) => Promise<OnlineTranscriptionResult>;
      translate: (text: string) => Promise<TranslationResult>;
      isConclusionCommand: (text: string) => Promise<CommandDetectionResult>;
      concludeDiscussion: (transcript: string) => Promise<ConclusionResult>;
      onWhisperStatus: (callback: (payload: EngineStatus) => void) => () => void;
      onTranscript: (callback: (payload: TranscriptPayload) => void) => () => void;
      onWhisperError: (callback: (payload: { message: string }) => void) => () => void;
    };
  }
}
