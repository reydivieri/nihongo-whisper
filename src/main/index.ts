import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ListeningOptions, WhisperEngine } from './whisperEngine';
import { OllamaTranslator } from './ollamaTranslator';
import { ChunkTranscriber, ChunkTranscriberStartOptions } from './chunkTranscriber';
import { NotesStore, NoteSegment } from './notesStore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let whisperEngine: WhisperEngine | null = null;
const translator = new OllamaTranslator();
let chunkTranscriber: ChunkTranscriber | null = null;
let notes: NotesStore;

const sendToRenderer = (channel: string, payload: unknown) => {
  const target = mainWindow;
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return;
  target.webContents.send(channel, payload);
};

const createWindow = () => {
  const window = new BrowserWindow({
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
  mainWindow = window;

  window.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const isTrustedOrigin =
      details.requestingUrl.startsWith('file:') ||
      details.requestingUrl.startsWith('http://localhost') ||
      details.requestingUrl.startsWith('http://127.0.0.1');
    callback(permission === 'media' && isTrustedOrigin);
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    void whisperEngine?.stop();
    void chunkTranscriber?.stop();
    void notes.flush();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
};

app.whenReady().then(async () => {
  notes = new NotesStore();
  await translator.loadSettings();

  // System audio (Zoom, Google Meet, browser, etc.) is captured as WASAPI loopback
  // via getDisplayMedia; the renderer discards the video track.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {});
  });
  createWindow();

  ipcMain.handle('app:get-status', async () => ({
    platform: process.platform,
    translator: translator.getStatus(),
    whisperRunning: whisperEngine?.isRunning ?? false
  }));

  ipcMain.handle('translator:translate', async (_event, text: string) => {
    return translator.translateJapaneseToIndonesian(text);
  });

  ipcMain.handle('translator:is-conclusion-command', async (_event, text: string) => {
    return translator.isConclusionCommand(text);
  });

  ipcMain.handle('translator:conclude-discussion', async (_event, transcript: string) => {
    return translator.concludeDiscussion(transcript);
  });

  ipcMain.handle('translator:get-local-models', async () => translator.getLocalModels());

  ipcMain.handle('translator:set-local-model', async (_event, model: string) => translator.setActiveModel(model));

  ipcMain.handle('whisper:start', async (_event, options?: ListeningOptions) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'Main window is not ready.' };
    if (whisperEngine?.isRunning) return { ok: true };

    whisperEngine = new WhisperEngine({
      onStatus: (payload) => sendToRenderer('whisper:status', payload),
      onTranscript: (payload) => sendToRenderer('whisper:transcript', payload),
      onError: (payload) => sendToRenderer('whisper:error', payload)
    });

    return whisperEngine.start(options);
  });

  ipcMain.handle('whisper:stop', async () => {
    await whisperEngine?.stop();
    return { ok: true };
  });

  ipcMain.handle('chunk:start', async (_event, options?: ChunkTranscriberStartOptions) => {
    if (!chunkTranscriber) {
      chunkTranscriber = new ChunkTranscriber({
        onStatus: (payload) => sendToRenderer('whisper:status', payload),
        onTranscript: (payload) => sendToRenderer('whisper:transcript', payload),
        onError: (payload) => sendToRenderer('whisper:error', payload)
      });
    }
    return chunkTranscriber.start(options);
  });

  ipcMain.handle('chunk:stop', async () => {
    await chunkTranscriber?.stop();
    return { ok: true };
  });

  ipcMain.on('chunk:push', (_event, samples: Float32Array) => {
    if (samples instanceof Float32Array) chunkTranscriber?.pushChunk(samples);
  });

  ipcMain.handle('notes:list', async () => notes.list());
  ipcMain.handle('notes:get', async (_event, id: string) => notes.get(id));
  ipcMain.handle('notes:create', async (_event, meta?: Parameters<NotesStore['create']>[0]) => notes.create(meta));
  ipcMain.handle('notes:upsert-segment', async (_event, id: string, segment: NoteSegment) => notes.upsertSegment(id, segment));
  ipcMain.handle('notes:update', async (_event, id: string, patch: Parameters<NotesStore['update']>[1]) => notes.update(id, patch));
  ipcMain.handle('notes:delete', async (_event, id: string) => notes.delete(id));
  ipcMain.handle('notes:open-folder', async () => {
    await fs.promises.mkdir(notes.folder, { recursive: true });
    return shell.openPath(notes.folder);
  });
  ipcMain.handle('notes:export', async (_event, id: string) => {
    const markdown = await notes.toMarkdown(id);
    if (!markdown) return { ok: false, error: 'Note tidak ditemukan.' };
    const options = {
      title: 'Export note',
      defaultPath: `${id}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    };
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(result.filePath, markdown, 'utf8');
    return { ok: true, filePath: result.filePath };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await notes?.flush();
  await whisperEngine?.stop();
  await chunkTranscriber?.stop();
  translator.stop();
});
