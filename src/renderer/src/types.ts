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

export type LocalModel = {
  name: string;
  size: number;
  parameters: string;
  quantization: string;
};

export type LocalModelsResult = {
  ok: boolean;
  models: LocalModel[];
  activeModel: string;
  error?: string;
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

declare global {
  interface Window {
    nihongoWhisper: {
      getStatus: () => Promise<unknown>;
      startWhisper: (options?: ListeningOptions) => Promise<{ ok: boolean; error?: string }>;
      stopWhisper: () => Promise<{ ok: boolean; error?: string }>;
      translate: (text: string) => Promise<TranslationResult>;
      isConclusionCommand: (text: string) => Promise<CommandDetectionResult>;
      concludeDiscussion: (transcript: string) => Promise<ConclusionResult>;
      getLocalModels: () => Promise<LocalModelsResult>;
      setLocalModel: (model: string) => Promise<{ ok: boolean; activeModel?: string; error?: string }>;
      onWhisperStatus: (callback: (payload: EngineStatus) => void) => () => void;
      onTranscript: (callback: (payload: TranscriptPayload) => void) => () => void;
      onWhisperError: (callback: (payload: { message: string }) => void) => () => void;
    };
  }
}
