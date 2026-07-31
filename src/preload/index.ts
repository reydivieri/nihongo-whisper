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
  setTranslatorMode: (mode: 'offline' | 'online') => ipcRenderer.invoke('translator:set-mode', mode),
  setOpenAIConfig: (config: { apiKey?: string; model?: string; transcriptionModel?: string }) =>
    ipcRenderer.invoke('translator:set-openai-config', config),
  transcribeOnlineAudio: (input: { bytes: number[]; mimeType?: string; model?: string }) =>
    ipcRenderer.invoke('openai:transcribe-audio', input),
  translate: (text: string) => ipcRenderer.invoke('translator:translate', text),
  isConclusionCommand: (text: string) => ipcRenderer.invoke('translator:is-conclusion-command', text),
  concludeDiscussion: (transcript: string) => ipcRenderer.invoke('translator:conclude-discussion', transcript),
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
