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

export type AudioSource = 'mic' | 'system' | 'mix';

export type NoteSegment = {
  id: string;
  japanese: string;
  indonesian: string;
  time: string;
  status: 'translating' | 'done' | 'error';
  accuracy: number;
};

export type SessionNote = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  audioSource?: string;
  translatorModel?: string;
  segments: NoteSegment[];
  conclusion?: { text: string; createdAt: string };
};

export type NoteSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  segmentCount: number;
  preview: string;
  hasConclusion: boolean;
};

type NotePatch = Partial<Pick<SessionNote, 'title' | 'endedAt' | 'audioSource' | 'translatorModel'>> & { conclusion?: string };
type OkResult = { ok: boolean; error?: string };

declare global {
  interface Window {
    nihongoWhisper: {
      getStatus: () => Promise<unknown>;
      startWhisper: (options?: ListeningOptions) => Promise<{ ok: boolean; error?: string }>;
      stopWhisper: () => Promise<{ ok: boolean; error?: string }>;
      startChunkTranscriber: (options?: { threads?: number; beamSize?: number; noGpu?: boolean }) => Promise<OkResult>;
      stopChunkTranscriber: () => Promise<OkResult>;
      pushAudioChunk: (samples: Float32Array) => void;
      notes: {
        list: () => Promise<NoteSummary[]>;
        get: (id: string) => Promise<SessionNote | null>;
        create: (meta?: Partial<Pick<SessionNote, 'title' | 'audioSource' | 'translatorModel' | 'segments'>>) => Promise<SessionNote>;
        upsertSegment: (id: string, segment: NoteSegment) => Promise<OkResult>;
        update: (id: string, patch: NotePatch) => Promise<OkResult>;
        remove: (id: string) => Promise<OkResult>;
        exportMarkdown: (id: string) => Promise<OkResult & { canceled?: boolean; filePath?: string }>;
        openFolder: () => Promise<string>;
      };
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
