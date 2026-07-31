import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ListeningOptions, WhisperEngine } from './whisperEngine';
import { OllamaTranslator } from './ollamaTranslator';
import { OpenAITranscriber } from './onlineTranscriber';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let whisperEngine: WhisperEngine | null = null;
const translator = new OllamaTranslator();
const transcriber = new OpenAITranscriber();

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: 'Nihongo Whisper',
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
};

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('app:get-status', async () => ({
    platform: process.platform,
    translator: translator.getStatus(),
    transcriber: transcriber.getStatus(),
    whisperRunning: whisperEngine?.isRunning ?? false
  }));

  ipcMain.handle('translator:set-mode', async (_event, mode: 'offline' | 'online') => {
    translator.setMode(mode);
    return { ok: true, translator: translator.getStatus() };
  });

  ipcMain.handle(
    'translator:set-openai-config',
    async (_event, config: { apiKey?: string; model?: string; transcriptionModel?: string }) => {
      translator.setOpenAIConfig(config);
      transcriber.setConfig(config);
      return { ok: true, translator: translator.getStatus(), transcriber: transcriber.getStatus() };
    }
  );

  ipcMain.handle('translator:translate', async (_event, text: string) => {
    return translator.translateJapaneseToIndonesian(text);
  });

  ipcMain.handle('translator:is-conclusion-command', async (_event, text: string) => {
    return translator.isConclusionCommand(text);
  });

  ipcMain.handle('translator:conclude-discussion', async (_event, transcript: string) => {
    return translator.concludeDiscussion(transcript);
  });

  ipcMain.handle(
    'openai:transcribe-audio',
    async (_event, input: { bytes: number[]; mimeType?: string; apiKey?: string; model?: string }) => {
      return transcriber.transcribeAudio(input);
    }
  );

  ipcMain.handle('whisper:start', async (_event, options?: ListeningOptions) => {
    if (!mainWindow) return { ok: false, error: 'Main window is not ready.' };
    if (whisperEngine?.isRunning) return { ok: true };

    whisperEngine = new WhisperEngine({
      onStatus: (payload) => mainWindow?.webContents.send('whisper:status', payload),
      onTranscript: (payload) => mainWindow?.webContents.send('whisper:transcript', payload),
      onError: (payload) => mainWindow?.webContents.send('whisper:error', payload)
    });

    return whisperEngine.start(options);
  });

  ipcMain.handle('whisper:stop', async () => {
    await whisperEngine?.stop();
    return { ok: true };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await whisperEngine?.stop();
});
