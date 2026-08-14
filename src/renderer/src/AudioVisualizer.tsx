import { useEffect, useRef } from 'react';

export type AudioMetrics = {
  waveform: Float32Array;
  volume: number;
  vadScore: number;
  peakDb: number;
  rmsDb: number;
  sampleRate: number;
  clipping: boolean;
};

type Props = {
  metrics: AudioMetrics;
  threshold: number;
  active: boolean;
};

const levelColor = (metrics: AudioMetrics, active: boolean) => {
  if (!active || metrics.volume < 1) return '#6b7280';
  if (metrics.clipping || metrics.volume >= 80) return '#ef4444';
  if (metrics.volume >= 50) return '#eab308';
  return '#22c55e';
};

const formatDb = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)} dB` : '-∞ dB');

export function AudioVisualizer({ metrics, threshold, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b1726';
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(125, 211, 252, 0.12)';
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += 50) {
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += 25) {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(width, y + 0.5);
      context.stroke();
    }

    context.strokeStyle = levelColor(metrics, active);
    context.lineWidth = 2;
    context.beginPath();
    const data = metrics.waveform;
    if (!active || data.length === 0) {
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
    } else {
      for (let index = 0; index < data.length; index += 1) {
        const x = (index / Math.max(1, data.length - 1)) * width;
        const y = (0.5 + data[index] * 0.46) * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
    }
    context.stroke();
  }, [active, metrics]);

  const color = levelColor(metrics, active);

  return (
    <section className="audio-visualizer" aria-label="Real-time audio monitor">
      <div className="visualizer-heading">
        <div>
          <span className="visualizer-kicker">MICROPHONE SIGNAL</span>
          <h3>Live audio waveform</h3>
        </div>
        <span className={`recording-state ${active ? 'active' : ''}`}>
          {active ? '🔴 Recording' : 'Waiting...'}
        </span>
      </div>

      <canvas ref={canvasRef} width={600} height={150} />

      <div className="audio-readouts">
        <div className="bar-readout">
          <div className="bar-label"><span>Volume</span><strong>{Math.round(metrics.volume)}%</strong></div>
          <div className="meter-track"><span style={{ width: `${metrics.volume}%`, background: color }} /></div>
        </div>
        <div className="bar-readout">
          <div className="bar-label"><span>VAD score</span><strong>{metrics.vadScore.toFixed(2)}</strong></div>
          <div className="meter-track vad-track">
            <span className="vad-fill" style={{ width: `${metrics.vadScore * 100}%` }} />
            <i style={{ left: `${threshold * 100}%` }} title={`VAD threshold ${threshold.toFixed(2)}`} />
          </div>
          <small>Threshold {threshold.toFixed(2)}</small>
        </div>
        <div className="numeric-readout"><span>Peak</span><strong>{formatDb(metrics.peakDb)}</strong></div>
        <div className="numeric-readout"><span>RMS</span><strong>{formatDb(metrics.rmsDb)}</strong></div>
        <div className="numeric-readout"><span>Sample rate</span><strong>{metrics.sampleRate ? `${(metrics.sampleRate / 1000).toFixed(0)} kHz` : '—'}</strong></div>
      </div>
    </section>
  );
}
