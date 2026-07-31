import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Languages,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Settings,
  Sparkles
} from 'lucide-react';
import type { EngineStatus, ListeningOptions, TranscriptPayload, TranscriptionMode, TranslationMode } from './types';

type Line = {
  id: string;
  japanese: string;
  indonesian: string;
  time: string;
  status: 'translating' | 'done' | 'error';
};

type View = 'monitor' | 'settings';

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));

const conclusionCommand = '\u5148\u306e\u8a71\u304b\u3089\u7d50\u8ad6\u3092\u51fa\u3057\u3066\u304f\u3060\u3055\u3044';

export function App() {
  const [view, setView] = useState<View>('monitor');
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<EngineStatus>({ state: 'stopped', message: 'Ready.' });
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>('offline');
  const [mode, setMode] = useState<TranslationMode>('offline');
  const [openAiKey, setOpenAiKey] = useState('');
  const [openAiModel, setOpenAiModel] = useState('gpt-4o-mini');
  const [openAiTranscriptionModel, setOpenAiTranscriptionModel] = useState('gpt-4o-mini-transcribe');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [listeningOptions, setListeningOptions] = useState<Required<ListeningOptions>>({
    captureId: -1,
    stepMs: 5000,
    lengthMs: 18000,
    keepMs: 500,
    maxTokens: 96,
    vadThreshold: 0.68,
    threads: 8,
    beamSize: 5,
    audioContext: 0,
    stabilizeMs: 2200,
    noGpu: false
  });
  const [conclusion, setConclusion] = useState('');
  const [conclusionStatus, setConclusionStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const linesRef = useRef<Line[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const onlineChunkBusyRef = useRef(false);

  const latestJapanese = lines[0]?.japanese ?? 'Belum ada suara Jepang yang ditangkap.';
  const latestIndonesian = lines[0]?.indonesian ?? 'Terjemahan akan muncul di sini setelah transkrip diterima.';

  const completion = useMemo(() => {
    const done = lines.filter((line) => line.status === 'done').length;
    if (!lines.length) return '0/0';
    return `${done}/${lines.length}`;
  }, [lines]);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const handleTranscript = useCallback(async (payload: TranscriptPayload) => {
    const text = payload.text.trim();
    if (!text) return;

    const historyBeforeCommand = linesRef.current;
    const id = crypto.randomUUID();
    const nextLine: Line = {
      id,
      japanese: text,
      indonesian: '',
      time: formatTime(payload.timestamp),
      status: 'translating'
    };

    setLines((current) => [nextLine, ...current].slice(0, 120));
    const translated = await window.nihongoWhisper.translate(text);
    const translatedText = translated.ok ? translated.translation ?? '' : translated.error ?? 'Translation failed.';

    setLines((current) =>
      current.map((line) =>
        line.id === id
          ? {
              ...line,
              indonesian: translatedText,
              status: translated.ok ? 'done' : 'error'
            }
          : line
      )
    );

    const commandText = [text, translatedText].filter(Boolean).join('\n');
    const command = await window.nihongoWhisper.isConclusionCommand(commandText);

    if (command.ok && command.isCommand) {
      const transcript = historyBeforeCommand
        .slice(0, 80)
        .reverse()
        .map((line) => `Japanese: ${line.japanese}\nIndonesian: ${line.indonesian}`)
        .join('\n\n');

      setConclusionStatus('working');
      setConclusion('');

      const result = await window.nihongoWhisper.concludeDiscussion(transcript);
      if (result.ok) {
        setConclusion(result.conclusion ?? '');
        setConclusionStatus('done');
      } else {
        setConclusion(result.error ?? 'Unable to create conclusion.');
        setConclusionStatus('error');
      }
    } else if (!command.ok) {
      setError(command.error ?? 'Unable to detect conclusion command.');
    }
  }, []);

  useEffect(() => {
    const unsubscribeStatus = window.nihongoWhisper.onWhisperStatus((payload) => {
      setStatus(payload);
      setListening(payload.state === 'running' || payload.state === 'starting');
    });

    const unsubscribeError = window.nihongoWhisper.onWhisperError((payload) => {
      setError(payload.message);
      setListening(false);
    });

    const unsubscribeTranscript = window.nihongoWhisper.onTranscript((payload: TranscriptPayload) => {
      void handleTranscript(payload);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeError();
      unsubscribeTranscript();
    };
  }, [handleTranscript]);

  const getOnlineMimeType = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
  };

  const processOnlineAudioChunk = async (blob: Blob) => {
    if (!blob.size || onlineChunkBusyRef.current) return;
    onlineChunkBusyRef.current = true;

    try {
      const buffer = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      const result = await window.nihongoWhisper.transcribeOnlineAudio({
        bytes,
        mimeType: blob.type || getOnlineMimeType() || 'audio/webm',
        model: openAiTranscriptionModel
      });

      if (!result.ok) {
        setError(result.error ?? 'Online transcription failed.');
        return;
      }

      const text = result.text?.trim();
      if (text) {
        await handleTranscript({
          text,
          raw: text,
          timestamp: new Date().toISOString()
        });
      }
    } finally {
      onlineChunkBusyRef.current = false;
    }
  };

  const startOnlineTranscription = async () => {
    if (!openAiKey.trim()) {
      setError('OpenAI API key is required for Online transcription.');
      return { ok: false };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const mimeType = getOnlineMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        void processOnlineAudioChunk(event.data);
      };
      recorder.onerror = (event) => {
        setError(`Online microphone recorder error: ${event.error.message}`);
        setListening(false);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.start(4500);
      setStatus({ state: 'running', message: 'Listening with OpenAI online transcription.' });
      setListening(true);
      return { ok: true };
    } catch (event) {
      const message = event instanceof Error ? event.message : String(event);
      setError(`Unable to start Online microphone listener: ${message}`);
      setListening(false);
      return { ok: false };
    }
  };

  const stopOnlineTranscription = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    onlineChunkBusyRef.current = false;
    setStatus({ state: 'stopped', message: 'Online transcription stopped.' });
  };

  const start = async () => {
    setError('');
    await window.nihongoWhisper.setOpenAIConfig({
      apiKey: openAiKey,
      model: openAiModel,
      transcriptionModel: openAiTranscriptionModel
    });
    if (transcriptionMode === 'online') {
      await window.nihongoWhisper.stopWhisper();
      await startOnlineTranscription();
      return;
    }

    stopOnlineTranscription();
    const result = await window.nihongoWhisper.startWhisper(listeningOptions);
    if (!result.ok) setError(result.error ?? 'Unable to start microphone listener.');
  };

  const stop = async () => {
    stopOnlineTranscription();
    await window.nihongoWhisper.stopWhisper();
    setListening(false);
  };

  const clearSession = () => {
    setLines([]);
    setConclusion('');
    setConclusionStatus('idle');
  };

  const changeMode = async (nextMode: TranslationMode) => {
    setMode(nextMode);
    setError('');
    await window.nihongoWhisper.setTranslatorMode(nextMode);
  };

  const saveOpenAIConfig = async () => {
    setError('');
    setSettingsMessage('');
    await window.nihongoWhisper.setOpenAIConfig({
      apiKey: openAiKey,
      model: openAiModel,
      transcriptionModel: openAiTranscriptionModel
    });
    setSettingsMessage('OpenAI settings saved.');
  };

  const updateListeningOption = <K extends keyof Required<ListeningOptions>>(
    key: K,
    value: Required<ListeningOptions>[K]
  ) => {
    setListeningOptions((current) => ({ ...current, [key]: value }));
  };

  const useMeetingDefaults = () => {
    setListeningOptions({
      captureId: -1,
      stepMs: 7000,
      lengthMs: 22000,
      keepMs: 500,
      maxTokens: 128,
      vadThreshold: 0.7,
      threads: 8,
      beamSize: 5,
      audioContext: 0,
      stabilizeMs: 2600,
      noGpu: false
    });
  };

  const useFastDefaults = () => {
    setListeningOptions({
      captureId: listeningOptions.captureId,
      stepMs: 3000,
      lengthMs: 10000,
      keepMs: 700,
      maxTokens: 80,
      vadThreshold: 0.65,
      threads: 6,
      beamSize: 2,
      audioContext: 0,
      stabilizeMs: 900,
      noGpu: false
    });
  };

  const useBalancedDefaults = () => {
    setListeningOptions({
      captureId: listeningOptions.captureId,
      stepMs: 5000,
      lengthMs: 18000,
      keepMs: 500,
      maxTokens: 96,
      vadThreshold: 0.68,
      threads: 8,
      beamSize: 5,
      audioContext: 0,
      stabilizeMs: 2200,
      noGpu: false
    });
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Languages size={24} />
          </div>
          <div>
            <h1>Nihongo Whisper</h1>
            <p>Local meeting interpreter</p>
          </div>
        </div>

        <nav className="side-nav">
          <button className={view === 'monitor' ? 'active' : ''} onClick={() => setView('monitor')}>
            <Activity size={18} />
            Monitor
          </button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
            <Settings size={18} />
            Settings
          </button>
        </nav>

        <div className="status-panel">
          <div className={`pulse ${listening ? 'is-live' : ''}`} />
          <div>
            <span>{listening ? 'Listening' : 'Idle'}</span>
            <p>{status.message}</p>
          </div>
        </div>

        <button className="primary-action" onClick={listening ? stop : start}>
          {listening ? <MicOff size={20} /> : <Mic size={20} />}
          {listening ? 'Stop Listening' : 'Start Listening'}
        </button>

        <button className="secondary-action" onClick={clearSession}>
          <RotateCcw size={18} />
          Clear Session
        </button>

        <div className="metric-grid">
          <div>
            <strong>{lines.length}</strong>
            <span>segments</span>
          </div>
          <div>
            <strong>{completion}</strong>
            <span>translated</span>
          </div>
        </div>

        <div className="settings-card">
          <Settings size={18} />
          <p>Version 1.8. Offline transcription is stricter against silence, noise, and repeated wrong context.</p>
        </div>
      </aside>

      {view === 'monitor' ? (
        <section className="workspace">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">
                <Radio size={16} /> Japanese audio monitor
              </p>
              <h2>Realtime Japanese to Indonesian</h2>
            </div>
            <div className="session-chip">
              <Sparkles size={16} /> {transcriptionMode === 'online' ? 'OpenAI STT' : 'Local STT'} /{' '}
              {mode === 'online' ? 'OpenAI translation' : 'Offline translation'}
            </div>
          </header>

          {error ? <div className="error-banner">{error}</div> : null}

          <section className="live-grid">
            <article className="live-panel japanese-panel">
              <div className="panel-label">Japanese transcript</div>
              <p>{latestJapanese}</p>
            </article>
            <article className="live-panel indonesia-panel">
              <div className="panel-label">Bahasa Indonesia</div>
              <p>{latestIndonesian}</p>
            </article>
          </section>

          <section className="history-section">
            <div className={`conclusion-panel ${conclusionStatus}`}>
              <div className="section-title">
                <h3>Kesimpulan</h3>
                <span>
                  {conclusionStatus === 'working'
                    ? 'Generating'
                    : conclusionStatus === 'idle'
                      ? 'Waiting for command'
                      : 'Latest result'}
                </span>
              </div>
              <p>
                {conclusion ||
                  `Ucapkan "${conclusionCommand}" atau kalimat dengan arti serupa untuk membuat kesimpulan dari pembicaraan sebelumnya.`}
              </p>
            </div>

            <div className="section-title">
              <h3>Session transcript</h3>
              <span>{lines.length ? 'Newest first' : 'Waiting for microphone input'}</span>
            </div>

            <div className="transcript-list">
              {lines.map((line) => (
                <article className="transcript-row" key={line.id}>
                  <time>{line.time}</time>
                  <div>
                    <p className="jp">{line.japanese}</p>
                    <p className={`id ${line.status}`}>{line.indonesian || 'Translating...'}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      ) : (
        <section className="workspace settings-workspace">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">
                <Settings size={16} /> Settings
              </p>
              <h2>Engine and privacy</h2>
            </div>
            <div className="session-chip">
              <Sparkles size={16} /> Version 1.8
            </div>
          </header>

          <section className="settings-grid">
            <article className="settings-panel-large">
              <h3>Transcription Engine</h3>
              <div className="segmented-control wide">
                <button
                  className={transcriptionMode === 'offline' ? 'active' : ''}
                  onClick={() => setTranscriptionMode('offline')}
                >
                  Offline
                </button>
                <button
                  className={transcriptionMode === 'online' ? 'active' : ''}
                  onClick={() => setTranscriptionMode('online')}
                >
                  Online
                </button>
              </div>
              <p>
                {transcriptionMode === 'offline'
                  ? 'Offline uses local whisper.cpp. It keeps audio on this PC, but accuracy and speed depend heavily on microphone quality, room noise, and capture-device selection.'
                  : 'Online records short microphone chunks and sends audio to OpenAI Speech-to-Text with Japanese language hinting. Use this when local listening writes different words from what was spoken.'}
              </p>
            </article>

            <article className="settings-panel-large">
              <h3>Translation Mode</h3>
              <div className="segmented-control wide">
                <button className={mode === 'offline' ? 'active' : ''} onClick={() => changeMode('offline')}>
                  Offline
                </button>
                <button className={mode === 'online' ? 'active' : ''} onClick={() => changeMode('online')}>
                  Online
                </button>
              </div>
              <p>
                {mode === 'offline'
                  ? 'Offline translation uses bundled Ollama and keeps transcript text on this PC.'
                  : 'Online translation sends Japanese transcript text to OpenAI for translation and conclusion generation.'}
              </p>
            </article>

            <article className="settings-panel-large">
              <h3>OpenAI Online</h3>
              <label>
                OpenAI API key
                <input
                  value={openAiKey}
                  onChange={(event) => setOpenAiKey(event.target.value)}
                  type="password"
                  placeholder="sk-..."
                />
              </label>
              <label>
                Translation model
                <input
                  value={openAiModel}
                  onChange={(event) => setOpenAiModel(event.target.value)}
                  placeholder="gpt-4o-mini"
                />
              </label>
              <label>
                Transcription model
                <input
                  value={openAiTranscriptionModel}
                  onChange={(event) => setOpenAiTranscriptionModel(event.target.value)}
                  placeholder="gpt-4o-mini-transcribe"
                />
              </label>
              <button className="compact-action save-settings-action" onClick={saveOpenAIConfig}>
                Save OpenAI settings
              </button>
              {settingsMessage ? <p className="settings-saved">{settingsMessage}</p> : null}
            </article>

            <article className="settings-panel-large">
              <h3>Japanese Transcript</h3>
              <p>
                Version 1.8 keeps the large model support, but makes local listening more conservative: higher VAD,
                full audio context, no fallback guessing, and no repeated context carryover between chunks.
              </p>
              <p className="settings-note">
                For local transcription, use a quiet room, keep the speaker close to the microphone, and verify the capture
                device. Large models improve Japanese accuracy but need more memory and can be slower on CPU-only PCs.
              </p>
            </article>

            <article className="settings-panel-large">
              <div className="settings-title-row">
                <h3>Listening Tuning</h3>
                <div className="preset-actions">
                  <button className="compact-action" onClick={useFastDefaults}>Fast</button>
                  <button className="compact-action" onClick={useBalancedDefaults}>Balanced</button>
                  <button className="compact-action" onClick={useMeetingDefaults}>Accurate</button>
                </div>
              </div>
              <div className="settings-fields-grid">
                <label>
                  Capture device ID
                  <input
                    type="number"
                    value={listeningOptions.captureId}
                    onChange={(event) => updateListeningOption('captureId', Number(event.target.value))}
                  />
                </label>
                <label>
                  Threads
                  <input
                    type="number"
                    min="1"
                    max="16"
                    value={listeningOptions.threads}
                    onChange={(event) => updateListeningOption('threads', Number(event.target.value))}
                  />
                </label>
                <label>
                  Step ms
                  <input
                    type="number"
                    min="1000"
                    max="8000"
                    value={listeningOptions.stepMs}
                    onChange={(event) => updateListeningOption('stepMs', Number(event.target.value))}
                  />
                </label>
                <label>
                  Length ms
                  <input
                    type="number"
                    min="4000"
                    max="20000"
                    value={listeningOptions.lengthMs}
                    onChange={(event) => updateListeningOption('lengthMs', Number(event.target.value))}
                  />
                </label>
                <label>
                  Keep ms
                  <input
                    type="number"
                    min="0"
                    max="3000"
                    value={listeningOptions.keepMs}
                    onChange={(event) => updateListeningOption('keepMs', Number(event.target.value))}
                  />
                </label>
                <label>
                  Max tokens
                  <input
                    type="number"
                    min="16"
                    max="160"
                    value={listeningOptions.maxTokens}
                    onChange={(event) => updateListeningOption('maxTokens', Number(event.target.value))}
                  />
                </label>
                <label>
                  VAD threshold
                  <input
                    type="number"
                    min="0.2"
                    max="0.95"
                    step="0.05"
                    value={listeningOptions.vadThreshold}
                    onChange={(event) => updateListeningOption('vadThreshold', Number(event.target.value))}
                  />
                </label>
                <label>
                  Beam size
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={listeningOptions.beamSize}
                    onChange={(event) => updateListeningOption('beamSize', Number(event.target.value))}
                  />
                </label>
                <label>
                  Audio context
                  <input
                    type="number"
                    min="0"
                    max="2048"
                    value={listeningOptions.audioContext}
                    onChange={(event) => updateListeningOption('audioContext', Number(event.target.value))}
                  />
                </label>
                <label>
                  Stabilize ms
                  <input
                    type="number"
                    min="300"
                    max="3000"
                    value={listeningOptions.stabilizeMs}
                    onChange={(event) => updateListeningOption('stabilizeMs', Number(event.target.value))}
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={listeningOptions.noGpu}
                    onChange={(event) => updateListeningOption('noGpu', event.target.checked)}
                  />
                  Disable GPU
                </label>
              </div>
              <p className="settings-note">
                Use Accurate when spoken words and transcript do not match. Capture `-1` uses the Windows default
                microphone. Try `0`, `1`, or `2` if the app listens to the wrong device. If the transcript is still
                unrelated to speech, the audio source is likely wrong, too far from the speaker, or too noisy.
              </p>
            </article>
          </section>
        </section>
      )}
    </main>
  );
}
