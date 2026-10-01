import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  History,
  Languages,
  Mic,
  MicOff,
  Radio,
  RefreshCw,
  Plus,
  Settings,
  Sparkles
} from 'lucide-react';
import { AudioVisualizer, type AudioMetrics } from './AudioVisualizer';
import { HistoryView } from './HistoryView';
import { SpeechChunker } from './speechChunker';
import type { AudioSource, EngineStatus, ListeningOptions, LocalModel, SessionNote, TranscriptPayload } from './types';

type Line = {
  id: string;
  japanese: string;
  indonesian: string;
  time: string;
  status: 'translating' | 'done' | 'error';
  accuracy: number;
};

type View = 'monitor' | 'history' | 'settings';

const audioSourceLabels: Record<AudioSource, string> = {
  mic: 'Mikrofon',
  system: 'Audio sistem (Zoom/Meet)',
  mix: 'Mikrofon + audio sistem'
};

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));

const conclusionCommand = '\u5148\u306e\u8a71\u304b\u3089\u7d50\u8ad6\u3092\u51fa\u3057\u3066\u304f\u3060\u3055\u3044';
const transcriptStorageKey = 'nihongo-whisper.transcript-history.v2';
const activeNoteStorageKey = 'nihongo-whisper.active-note';
const audioSourceStorageKey = 'nihongo-whisper.audio-source';

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage only remembers UI preferences; notes live on disk.
  }
};

const loadStoredLines = (): Line[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(transcriptStorageKey) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Line => {
      if (!item || typeof item !== 'object') return false;
      const line = item as Partial<Line>;
      return typeof line.id === 'string' &&
        typeof line.japanese === 'string' &&
        typeof line.indonesian === 'string' &&
        typeof line.time === 'string' &&
        typeof line.accuracy === 'number' &&
        (line.status === 'translating' || line.status === 'done' || line.status === 'error');
    }).slice(0, 120);
  } catch {
    return [];
  }
};

const emptyAudioMetrics: AudioMetrics = {
  waveform: new Float32Array(0),
  volume: 0,
  vadScore: 0,
  peakDb: Number.NEGATIVE_INFINITY,
  rmsDb: Number.NEGATIVE_INFINITY,
  sampleRate: 0,
  clipping: false
};

const estimateAccuracy = ({ rmsDb, vadScore, clipping }: AudioMetrics) => {
  if (!Number.isFinite(rmsDb)) return 0;
  const signalScore = Math.max(0, Math.min(1, (rmsDb + 55) / 35));
  const voiceScore = Math.max(0, Math.min(1, vadScore / 0.68));
  const clippingPenalty = clipping ? 0.2 : 0;
  return Math.round(Math.max(0, Math.min(0.99, 0.42 + signalScore * 0.3 + voiceScore * 0.26 - clippingPenalty)) * 100);
};

export function App() {
  const [view, setView] = useState<View>('monitor');
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<EngineStatus>({ state: 'stopped', message: 'Ready.' });
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('default');
  const [micStatus, setMicStatus] = useState<'waiting' | 'recording' | 'error'>('waiting');
  const [audioMetrics, setAudioMetrics] = useState<AudioMetrics>(emptyAudioMetrics);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [activeLocalModel, setActiveLocalModel] = useState('qwen3:1.7b');
  const [localModelStatus, setLocalModelStatus] = useState('Memeriksa runtime lokal...');
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
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioMetricsRef = useRef<AudioMetrics>(emptyAudioMetrics);
  const recentVoiceMetricsRef = useRef<{ metrics: AudioMetrics; observedAt: number } | null>(null);
  const lastMetricsUpdateRef = useRef(0);
  const [activeNote, setActiveNote] = useState<Pick<SessionNote, 'id' | 'title'> | null>(null);
  const activeNoteIdRef = useRef<string | null>(null);
  const [audioSource, setAudioSource] = useState<AudioSource>(() => {
    const stored = readStorage(audioSourceStorageKey);
    return stored === 'system' || stored === 'mix' ? stored : 'mic';
  });
  const runningSourceRef = useRef<AudioSource | null>(null);
  const extraStreamsRef = useRef<MediaStream[]>([]);
  const chunkerRef = useRef<SpeechChunker | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const activeLocalModelRef = useRef(activeLocalModel);
  activeLocalModelRef.current = activeLocalModel;

  const setActiveSession = (note: Pick<SessionNote, 'id' | 'title'> | null) => {
    activeNoteIdRef.current = note?.id ?? null;
    setActiveNote(note ? { id: note.id, title: note.title } : null);
    writeStorage(activeNoteStorageKey, note?.id ?? null);
  };

  const saveSegment = (line: Line) => {
    const id = activeNoteIdRef.current;
    if (!id) return;
    void window.nihongoWhisper.notes.upsertSegment(id, line);
  };

  const ensureSession = async () => {
    if (activeNoteIdRef.current) return activeNoteIdRef.current;
    const note = await window.nihongoWhisper.notes.create({
      audioSource: audioSourceLabels[audioSource],
      translatorModel: activeLocalModelRef.current
    });
    setActiveSession(note);
    setHistoryRefreshKey((key) => key + 1);
    return note.id;
  };

  const loadSessionIntoMonitor = (note: SessionNote) => {
    setActiveSession(note);
    setLines(note.segments);
    setConclusion(note.conclusion?.text ?? '');
    setConclusionStatus(note.conclusion?.text ? 'done' : 'idle');
  };

  // Restore the active session and migrate the v2.3 localStorage history into a note.
  useEffect(() => {
    void (async () => {
      const legacy = loadStoredLines();
      if (legacy.length) {
        await window.nihongoWhisper.notes.create({ title: 'Imported history (v2.3)', segments: legacy });
        writeStorage(transcriptStorageKey, null);
        setHistoryRefreshKey((key) => key + 1);
      }
      const storedId = readStorage(activeNoteStorageKey);
      const note = storedId ? await window.nihongoWhisper.notes.get(storedId) : null;
      if (note) loadSessionIntoMonitor(note);
      else writeStorage(activeNoteStorageKey, null);
    })();
  }, []);

  const latestJapanese = lines[0]?.japanese ?? 'Belum ada suara Jepang yang ditangkap.';
  const latestIndonesian = lines[0]?.indonesian ?? 'Terjemahan akan muncul di sini setelah transkrip diterima.';

  const completion = useMemo(() => {
    const done = lines.filter((line) => line.status === 'done').length;
    if (!lines.length) return '0/0';
    return `${done}/${lines.length}`;
  }, [lines]);

  const averageAccuracy = useMemo(() => {
    if (!lines.length) return 0;
    return Math.round(lines.reduce((total, line) => total + line.accuracy, 0) / lines.length);
  }, [lines]);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    audioMetricsRef.current = audioMetrics;
  }, [audioMetrics]);

  const handleTranscript = useCallback(async (payload: TranscriptPayload) => {
    const text = payload.text.trim();
    if (!text) return;

    const historyBeforeCommand = linesRef.current;
    const id = crypto.randomUUID();
    const recentVoice = recentVoiceMetricsRef.current;
    const metricsForEstimate = recentVoice && Date.now() - recentVoice.observedAt < 10000
      ? recentVoice.metrics
      : audioMetricsRef.current;
    recentVoiceMetricsRef.current = null;
    const nextLine: Line = {
      id,
      japanese: text,
      indonesian: '',
      time: formatTime(payload.timestamp),
      status: 'translating',
      accuracy: estimateAccuracy(metricsForEstimate)
    };

    setLines((current) => [nextLine, ...current].slice(0, 500));
    saveSegment(nextLine);
    const translated = await window.nihongoWhisper.translate(text);
    const translatedText = translated.ok ? translated.translation ?? '' : translated.error ?? 'Translation failed.';
    saveSegment({ ...nextLine, indonesian: translatedText, status: translated.ok ? 'done' : 'error' });

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
        const noteId = activeNoteIdRef.current;
        if (noteId) void window.nihongoWhisper.notes.update(noteId, { conclusion: result.conclusion ?? '' });
      } else {
        setConclusion(result.error ?? 'Unable to create conclusion.');
        setConclusionStatus('error');
      }
    } else if (!command.ok) {
      setError(command.error ?? 'Unable to detect conclusion command.');
    }
  }, []);

  const loadLocalModels = async () => {
    setLocalModelStatus('Memeriksa runtime lokal...');
    const result = await window.nihongoWhisper.getLocalModels();
    setActiveLocalModel(result.activeModel);
    setLocalModels(result.models);
    if (result.ok) {
      setLocalModelStatus(`${result.models.length} model lokal siap digunakan.`);
    } else {
      setLocalModelStatus(result.error ?? 'Runtime lokal tidak tersedia.');
    }
  };

  const changeLocalModel = async (model: string) => {
    const result = await window.nihongoWhisper.setLocalModel(model);
    if (result.ok) {
      setActiveLocalModel(result.activeModel ?? model);
      setLocalModelStatus(`Model aktif: ${result.activeModel ?? model}`);
    } else {
      setError(result.error ?? 'Tidak dapat mengaktifkan model lokal.');
    }
  };

  useEffect(() => {
    void loadLocalModels();
  }, []);

  const refreshDevices = async () => {
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
      setAudioDevices(devices);
      if (selectedDeviceId !== 'default' && !devices.some((device) => device.deviceId === selectedDeviceId)) {
        setSelectedDeviceId('default');
      }
    } catch (event) {
      setMicStatus('error');
      setError(`Tidak dapat memindai mikrofon: ${event instanceof Error ? event.message : String(event)}`);
    }
  };

  const stopAudioMonitoring = () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    extraStreamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    extraStreamsRef.current = [];
    chunkerRef.current = null;
    recentVoiceMetricsRef.current = null;
    audioMetricsRef.current = emptyAudioMetrics;
    setAudioMetrics(emptyAudioMetrics);
    setMicStatus('waiting');
  };

  const openMicrophone = () =>
    navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedDeviceId === 'default' ? undefined : { exact: selectedDeviceId },
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

  const openSystemAudio = async () => {
    // Electron's display-media handler answers with WASAPI loopback audio of the whole system.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });
    if (!stream.getAudioTracks().length) throw new Error('Audio sistem tidak tersedia di perangkat ini.');
    return stream;
  };

  const startAudioMonitoring = async (source: AudioSource) => {
    stopAudioMonitoring();
    const streams: MediaStream[] = [];
    try {
      if (source === 'mic' || source === 'mix') streams.push(await openMicrophone());
      if (source === 'system' || source === 'mix') streams.push(await openSystemAudio());
      const [stream, ...extraStreams] = streams;
      const context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.18;
      const mixer = context.createGain();
      mixer.connect(analyser);
      for (const item of streams) context.createMediaStreamSource(item).connect(mixer);
      const samples = new Float32Array(analyser.fftSize);

      if (source !== 'mic') {
        // whisper-stream can only read SDL capture devices, so system audio is chunked
        // here and transcribed by whisper-server in the main process.
        chunkerRef.current = new SpeechChunker((chunk) => window.nihongoWhisper.pushAudioChunk(chunk), {
          sampleRate: context.sampleRate,
          maxMs: listeningOptions.lengthMs
        });
        const processor = context.createScriptProcessor(4096, 1, 1);
        const mute = context.createGain();
        mute.gain.value = 0;
        mixer.connect(processor);
        processor.connect(mute);
        mute.connect(context.destination);
        processor.onaudioprocess = (event) => chunkerRef.current?.push(event.inputBuffer.getChannelData(0));
      }

      mediaStreamRef.current = stream;
      extraStreamsRef.current = extraStreams;
      audioContextRef.current = context;
      setMicStatus('recording');
      await refreshDevices();

      const readAudio = (timestamp: number) => {
        analyser.getFloatTimeDomainData(samples);
        if (timestamp - lastMetricsUpdateRef.current >= 70) {
          let sumSquares = 0;
          let peak = 0;
          for (const sample of samples) {
            const absolute = Math.abs(sample);
            sumSquares += sample * sample;
            peak = Math.max(peak, absolute);
          }
          const rms = Math.sqrt(sumSquares / samples.length);
          const rmsDb = 20 * Math.log10(Math.max(rms, 0.00000001));
          const peakDb = 20 * Math.log10(Math.max(peak, 0.00000001));
          const volume = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
          const vadScore = Math.max(0, Math.min(1, (rmsDb + 55) / 45));
          const nextMetrics: AudioMetrics = {
            waveform: samples.slice(),
            volume,
            vadScore,
            peakDb,
            rmsDb,
            sampleRate: context.sampleRate,
            clipping: peak >= 0.98
          };
          const recentVoice = recentVoiceMetricsRef.current;
          if (
            vadScore >= 0.2 &&
            (!recentVoice || Date.now() - recentVoice.observedAt > 10000 || estimateAccuracy(nextMetrics) >= estimateAccuracy(recentVoice.metrics))
          ) {
            recentVoiceMetricsRef.current = { metrics: nextMetrics, observedAt: Date.now() };
          }
          audioMetricsRef.current = nextMetrics;
          setAudioMetrics(nextMetrics);
          lastMetricsUpdateRef.current = timestamp;
        }
        animationFrameRef.current = requestAnimationFrame(readAudio);
      };
      animationFrameRef.current = requestAnimationFrame(readAudio);
      return stream;
    } catch (event) {
      const message = event instanceof Error ? event.message : String(event);
      streams.forEach((item) => item.getTracks().forEach((track) => track.stop()));
      setMicStatus('error');
      setError(`Tidak dapat membuka sumber audio: ${message}`);
      return null;
    }
  };

  useEffect(() => {
    void refreshDevices();
    const handleDeviceChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      void audioContextRef.current?.close();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      setError(`Aplikasi error: ${event.message || 'Unknown renderer error'}`);
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
      setError(`Operasi gagal: ${reason}`);
    };
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    const unsubscribeStatus = window.nihongoWhisper.onWhisperStatus((payload) => {
      setStatus(payload);
      setListening(payload.state === 'running' || payload.state === 'starting');
      if (payload.state === 'stopped' && mediaStreamRef.current) stopAudioMonitoring();
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

  const start = async () => {
    setError('');
    const source = audioSource;
    if (source !== 'mic') {
      // Load the whisper-server model first so chunks are not dropped while it starts.
      const engine = await window.nihongoWhisper.startChunkTranscriber({
        threads: listeningOptions.threads,
        beamSize: listeningOptions.beamSize,
        noGpu: listeningOptions.noGpu
      });
      if (!engine.ok) {
        setError(engine.error ?? 'Unable to start system audio listener.');
        return;
      }
    }
    const stream = await startAudioMonitoring(source);
    if (!stream) {
      if (source !== 'mic') await window.nihongoWhisper.stopChunkTranscriber();
      return;
    }
    runningSourceRef.current = source;
    const noteId = await ensureSession();
    void window.nihongoWhisper.notes.update(noteId, { audioSource: audioSourceLabels[source], translatorModel: activeLocalModel });
    if (source !== 'mic') {
      setListening(true);
      return;
    }
    const result = await window.nihongoWhisper.startWhisper(listeningOptions);
    if (!result.ok) {
      stopAudioMonitoring();
      setMicStatus('error');
      setError(result.error ?? 'Unable to start microphone listener.');
    }
  };

  const stop = async () => {
    chunkerRef.current?.flush();
    stopAudioMonitoring();
    if (runningSourceRef.current === 'mic') await window.nihongoWhisper.stopWhisper();
    else await window.nihongoWhisper.stopChunkTranscriber();
    runningSourceRef.current = null;
    setListening(false);
    const noteId = activeNoteIdRef.current;
    if (noteId) await window.nihongoWhisper.notes.update(noteId, { endedAt: new Date().toISOString() });
    setHistoryRefreshKey((key) => key + 1);
  };

  const newSession = async () => {
    if (listening) await stop();
    setActiveSession(null);
    setLines([]);
    setConclusion('');
    setConclusionStatus('idle');
    setHistoryRefreshKey((key) => key + 1);
  };

  const changeAudioSource = (source: AudioSource) => {
    setAudioSource(source);
    writeStorage(audioSourceStorageKey, source);
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
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
            <History size={18} />
            History
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

        <div className="device-panel">
          <label htmlFor="audio-source">Sumber audio</label>
          <select
            id="audio-source"
            value={audioSource}
            disabled={listening}
            onChange={(event) => changeAudioSource(event.target.value as AudioSource)}
          >
            {(Object.keys(audioSourceLabels) as AudioSource[]).map((source) => (
              <option key={source} value={source}>{audioSourceLabels[source]}</option>
            ))}
          </select>
          <div className="device-title-row">
            <label htmlFor="microphone-device">Microphone</label>
            <button type="button" onClick={() => void refreshDevices()} title="Refresh microphone list" aria-label="Refresh microphone list">
              <RefreshCw size={15} />
            </button>
          </div>
          <select
            id="microphone-device"
            value={selectedDeviceId}
            disabled={listening}
            onChange={(event) => setSelectedDeviceId(event.target.value)}
          >
            <option value="default">System default</option>
            {audioDevices.filter((device) => device.deviceId !== 'default').map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`} — {device.deviceId}
              </option>
            ))}
          </select>
          <span className={`mic-device-status ${micStatus}`}>
            {micStatus === 'recording' ? '🔴 Recording' : micStatus === 'error' ? '❌ Error' : 'Waiting...'}
          </span>
          <small>ID: {selectedDeviceId}</small>
        </div>

        <button className="primary-action" onClick={listening ? stop : start}>
          {listening ? <MicOff size={20} /> : <Mic size={20} />}
          {listening ? 'Stop Listening' : 'Start Listening'}
        </button>

        <button className="secondary-action" onClick={() => void newSession()} title="Simpan sesi ini di History dan mulai sesi baru">
          <Plus size={18} />
          New Session
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
          <div>
            <strong>{lines.length ? `${averageAccuracy}%` : '—'}</strong>
            <span>estimated accuracy</span>
          </div>
        </div>

        <div className="settings-card">
          <Settings size={18} />
          <p>Version 2.4. Session notes &amp; system audio capture.</p>
        </div>
      </aside>

      {view === 'history' ? (
        <HistoryView
          activeNoteId={activeNote?.id ?? null}
          listening={listening}
          refreshKey={historyRefreshKey}
          onContinue={(note) => {
            loadSessionIntoMonitor(note);
            setView('monitor');
          }}
          onDeleted={(id) => {
            if (id === activeNoteIdRef.current) {
              setActiveSession(null);
              setLines([]);
              setConclusion('');
              setConclusionStatus('idle');
            }
          }}
        />
      ) : view === 'monitor' ? (
        <section className="workspace">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">
                <Radio size={16} /> Japanese audio monitor
              </p>
              <h2>{activeNote?.title ?? 'Realtime Japanese to Indonesian'}</h2>
            </div>
            <div className="session-chip">
              <Sparkles size={16} /> Offline whisper.cpp / Local translation
            </div>
          </header>

          {error ? (
            <div className="error-banner" role="alert">
              <strong>❌ Error</strong>
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Tutup pesan error">×</button>
            </div>
          ) : null}

          <AudioVisualizer metrics={audioMetrics} threshold={listeningOptions.vadThreshold} active={micStatus === 'recording'} />

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
                    <div className="transcript-line-heading">
                      <p className="jp">{line.japanese}</p>
                      <span className="accuracy-badge" title="Estimated from microphone signal quality and VAD score">
                        ~{line.accuracy}% accuracy
                      </span>
                    </div>
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
              <Sparkles size={16} /> Version 2.4
            </div>
          </header>

          <section className="settings-grid">
            <article className="settings-panel-large">
              <h3>Transcription Engine</h3>
              <div className="offline-badge">Offline · whisper.cpp</div>
              <p>
                Audio diproses gratis dan lokal oleh whisper.cpp. Akurasi dan kecepatan bergantung pada model, kualitas mikrofon, noise ruangan, dan perangkat yang dipilih.
              </p>
            </article>

            <article className="settings-panel-large">
              <h3>Translation Engine</h3>
              <div className="offline-badge">Offline · local runtime</div>
              <p>
                Terjemahan dan kesimpulan memakai backend lokal. whisper.cpp hanya membuat transkrip dan tidak dapat menerjemahkan sendiri.
              </p>
            </article>

            <article className="settings-panel-large">
              <div className="settings-title-row">
                <h3>Local AI Model</h3>
                <button className="model-refresh" type="button" onClick={() => void loadLocalModels()} title="Refresh local models">
                  <RefreshCw size={14} />
                </button>
              </div>
              <label>
                Model aktif
                <select value={activeLocalModel} onChange={(event) => void changeLocalModel(event.target.value)}>
                  {localModels.length ? localModels.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name} · {(model.size / 1024 / 1024 / 1024).toFixed(1)} GB
                    </option>
                  )) : <option value={activeLocalModel}>{activeLocalModel}</option>}
                </select>
              </label>
              <p className={localModels.length ? 'model-status ready' : 'model-status'}>{localModelStatus}</p>
              <p>Audio dan teks diproses lokal. Tidak ada API key atau upload ke layanan eksternal.</p>
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
