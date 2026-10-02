import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nihongoWhisper', {
  getStatus: () => ipcRenderer.invoke('app:get-status'),
  startWhisper: (options?: {
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
  }) => ipcRenderer.invoke('whisper:start', options),
  stopWhisper: () => ipcRenderer.invoke('whisper:stop'),
  startChunkTranscriber: (options?: { threads?: number; beamSize?: number; noGpu?: boolean }) =>
    ipcRenderer.invoke('chunk:start', options),
  stopChunkTranscriber: () => ipcRenderer.invoke('chunk:stop'),
  pushAudioChunk: (samples: Float32Array) => ipcRenderer.send('chunk:push', samples),
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    get: (id: string) => ipcRenderer.invoke('notes:get', id),
    create: (meta?: unknown) => ipcRenderer.invoke('notes:create', meta),
    upsertSegment: (id: string, segment: unknown) => ipcRenderer.invoke('notes:upsert-segment', id, segment),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('notes:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('notes:delete', id),
    exportMarkdown: (id: string) => ipcRenderer.invoke('notes:export', id),
    openFolder: () => ipcRenderer.invoke('notes:open-folder')
  },
  translate: (text: string) => ipcRenderer.invoke('translator:translate', text),
  isConclusionCommand: (text: string) => ipcRenderer.invoke('translator:is-conclusion-command', text),
  concludeDiscussion: (transcript: string) => ipcRenderer.invoke('translator:conclude-discussion', transcript),
  getLocalModels: () => ipcRenderer.invoke('translator:get-local-models'),
  setLocalModel: (model: string) => ipcRenderer.invoke('translator:set-local-model', model),
  onWhisperStatus: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('whisper:status', listener);
    return () => ipcRenderer.removeListener('whisper:status', listener);
  },
  onTranscript: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('whisper:transcript', listener);
    return () => ipcRenderer.removeListener('whisper:transcript', listener);
  },
  onWhisperError: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('whisper:error', listener);
    return () => ipcRenderer.removeListener('whisper:error', listener);
  }
});
