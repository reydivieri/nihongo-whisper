import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, FolderOpen, History, Pencil, Play, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { NoteSummary, SessionNote } from './types';

type HistoryViewProps = {
  activeNoteId: string | null;
  listening: boolean;
  refreshKey: number;
  onContinue: (note: SessionNote) => void;
  onDeleted: (id: string) => void;
};

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export function HistoryView({ activeNoteId, listening, refreshKey, onContinue, onDeleted }: HistoryViewProps) {
  const [summaries, setSummaries] = useState<NoteSummary[]>([]);
  const [selected, setSelected] = useState<SessionNote | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [fullText, setFullText] = useState<Record<string, string>>({});

  const load = async () => {
    const list = await window.nihongoWhisper.notes.list();
    setSummaries(list);
    if (!selected && list[0]) void select(list[0].id);
  };

  const select = async (id: string) => {
    const note = await window.nihongoWhisper.notes.get(id);
    setSelected(note);
    setMessage('');
  };

  useEffect(() => {
    void load();
    if (selected) void select(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Full-text search needs segment contents, so load them lazily once a query is typed.
  useEffect(() => {
    if (!query.trim()) return;
    const missing = summaries.filter((summary) => fullText[summary.id] === undefined);
    if (!missing.length) return;
    void Promise.all(missing.map((summary) => window.nihongoWhisper.notes.get(summary.id))).then((notes) => {
      setFullText((current) => {
        const next = { ...current };
        for (const note of notes) {
          if (!note) continue;
          next[note.id] = [note.title, note.conclusion?.text ?? '', ...note.segments.flatMap((s) => [s.japanese, s.indonesian])]
            .join('\n')
            .toLowerCase();
        }
        return next;
      });
    });
  }, [query, summaries, fullText]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return summaries;
    return summaries.filter((summary) =>
      (fullText[summary.id] ?? `${summary.title}\n${summary.preview}`.toLowerCase()).includes(needle)
    );
  }, [query, summaries, fullText]);

  const rename = async () => {
    if (!selected) return;
    const title = window.prompt('Judul note', selected.title)?.trim();
    if (!title) return;
    await window.nihongoWhisper.notes.update(selected.id, { title });
    await select(selected.id);
    await load();
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(`Hapus note "${selected.title}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    await window.nihongoWhisper.notes.remove(selected.id);
    onDeleted(selected.id);
    setSelected(null);
    await load();
  };

  const exportNote = async () => {
    if (!selected) return;
    const result = await window.nihongoWhisper.notes.exportMarkdown(selected.id);
    if (result.ok) setMessage(`Tersimpan: ${result.filePath}`);
    else if (!result.canceled) setMessage(result.error ?? 'Export gagal.');
  };

  const copyNote = async () => {
    if (!selected) return;
    const text = [...selected.segments]
      .reverse()
      .map((segment) => `[${segment.time}] ${segment.japanese}\n${segment.indonesian}`)
      .join('\n\n');
    const conclusion = selected.conclusion?.text ? `Kesimpulan:\n${selected.conclusion.text}\n\n` : '';
    await navigator.clipboard.writeText(`${selected.title}\n\n${conclusion}${text}`);
    setMessage('Disalin ke clipboard.');
  };

  return (
    <section className="workspace history-workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">
            <History size={16} /> Session notes
          </p>
          <h2>Riwayat pembicaraan</h2>
        </div>
        <div className="preset-actions">
          <button className="compact-action" onClick={() => void load()} title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button className="compact-action" onClick={() => void window.nihongoWhisper.notes.openFolder()}>
            <FolderOpen size={14} /> Folder
          </button>
        </div>
      </header>

      <div className="history-layout">
        <aside className="note-list">
          <label className="note-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari judul, Jepang, Indonesia..." />
          </label>
          {filtered.length ? (
            filtered.map((summary) => (
              <button
                key={summary.id}
                className={`note-item ${selected?.id === summary.id ? 'active' : ''}`}
                onClick={() => void select(summary.id)}
              >
                <strong>
                  {summary.title}
                  {summary.id === activeNoteId ? <span className="note-live">aktif</span> : null}
                </strong>
                <small>
                  {formatDate(summary.createdAt)} · {summary.segmentCount} segmen{summary.hasConclusion ? ' · ✓ kesimpulan' : ''}
                </small>
                {summary.preview ? <p>{summary.preview}</p> : null}
              </button>
            ))
          ) : (
            <p className="note-empty">{summaries.length ? 'Tidak ada hasil.' : 'Belum ada note. Mulai listening untuk membuat sesi.'}</p>
          )}
        </aside>

        <article className="note-detail">
          {selected ? (
            <>
              <div className="settings-title-row">
                <div>
                  <h3>{selected.title}</h3>
                  <small>
                    {formatDate(selected.createdAt)}
                    {selected.endedAt ? ` – ${formatDate(selected.endedAt)}` : ''}
                    {selected.audioSource ? ` · ${selected.audioSource}` : ''}
                    {selected.translatorModel ? ` · ${selected.translatorModel}` : ''}
                  </small>
                </div>
                <div className="preset-actions">
                  <button className="compact-action" onClick={() => onContinue(selected)} disabled={listening || selected.id === activeNoteId}>
                    <Play size={14} /> Lanjutkan
                  </button>
                  <button className="compact-action" onClick={() => void rename()} title="Ganti judul">
                    <Pencil size={14} />
                  </button>
                  <button className="compact-action" onClick={() => void copyNote()} title="Salin">
                    <Copy size={14} />
                  </button>
                  <button className="compact-action" onClick={() => void exportNote()} title="Export Markdown">
                    <Download size={14} />
                  </button>
                  <button className="compact-action danger" onClick={() => void remove()} disabled={selected.id === activeNoteId && listening} title="Hapus">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {message ? <p className="model-status ready">{message}</p> : null}
              {selected.conclusion?.text ? (
                <div className="conclusion-panel done">
                  <div className="section-title">
                    <h3>Kesimpulan</h3>
                    <span>{formatDate(selected.conclusion.createdAt)}</span>
                  </div>
                  <p>{selected.conclusion.text}</p>
                </div>
              ) : null}
              <div className="transcript-list">
                {[...selected.segments].reverse().map((segment) => (
                  <article className="transcript-row" key={segment.id}>
                    <time>{segment.time}</time>
                    <div>
                      <p className="jp">{segment.japanese}</p>
                      <p className={`id ${segment.status}`}>{segment.indonesian || '—'}</p>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="note-empty">Pilih note di sebelah kiri.</p>
          )}
        </article>
      </div>
    </section>
  );
}
