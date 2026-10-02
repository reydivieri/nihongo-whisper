import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

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

const MAX_SEGMENTS = 5000;

export class NotesStore {
  private readonly dir = path.join(app.getPath('userData'), 'notes');
  private cache = new Map<string, SessionNote>();
  private dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;

  get folder() {
    return this.dir;
  }

  async list(): Promise<NoteSummary[]> {
    await this.ensureDir();
    const files = (await fs.promises.readdir(this.dir)).filter((file) => file.endsWith('.json'));
    const notes: SessionNote[] = [];
    for (const file of files) {
      const note = await this.read(file.replace(/\.json$/, ''));
      if (note) notes.push(note);
    }
    return notes
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((note) => ({
        id: note.id,
        title: note.title,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        segmentCount: note.segments.length,
        preview: note.segments[0]?.indonesian || note.segments[0]?.japanese || '',
        hasConclusion: Boolean(note.conclusion?.text)
      }));
  }

  async get(id: string) {
    return this.read(id);
  }

  async create(meta: Partial<Pick<SessionNote, 'title' | 'audioSource' | 'translatorModel' | 'segments'>> = {}) {
    const now = new Date();
    const id = this.makeId(now);
    const note: SessionNote = {
      id,
      title: meta.title?.trim() || `Sesi ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(now)}`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      audioSource: meta.audioSource,
      translatorModel: meta.translatorModel,
      segments: (meta.segments ?? []).slice(0, MAX_SEGMENTS)
    };
    this.cache.set(id, note);
    await this.write(note);
    return note;
  }

  /** Upserts a segment (newest first) without rewriting the file on every call. */
  async upsertSegment(id: string, segment: NoteSegment) {
    const note = await this.read(id);
    if (!note) return { ok: false, error: 'Note tidak ditemukan.' };
    const index = note.segments.findIndex((item) => item.id === segment.id);
    if (index >= 0) note.segments[index] = segment;
    else note.segments = [segment, ...note.segments].slice(0, MAX_SEGMENTS);
    this.touch(note);
    return { ok: true };
  }

  async update(id: string, patch: Partial<Pick<SessionNote, 'title' | 'endedAt' | 'audioSource' | 'translatorModel'>> & { conclusion?: string }) {
    const note = await this.read(id);
    if (!note) return { ok: false, error: 'Note tidak ditemukan.' };
    if (patch.title !== undefined) note.title = patch.title.trim() || note.title;
    if (patch.endedAt !== undefined) note.endedAt = patch.endedAt;
    if (patch.audioSource !== undefined) note.audioSource = patch.audioSource;
    if (patch.translatorModel !== undefined) note.translatorModel = patch.translatorModel;
    if (patch.conclusion !== undefined) note.conclusion = { text: patch.conclusion, createdAt: new Date().toISOString() };
    this.touch(note);
    return { ok: true };
  }

  async delete(id: string) {
    this.cache.delete(id);
    this.dirty.delete(id);
    try {
      await fs.promises.unlink(this.filePath(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return { ok: true };
  }

  async toMarkdown(id: string) {
    const note = await this.read(id);
    if (!note) return null;
    const lines = [
      `# ${note.title}`,
      '',
      `- Dibuat: ${new Date(note.createdAt).toLocaleString('id-ID')}`,
      note.endedAt ? `- Selesai: ${new Date(note.endedAt).toLocaleString('id-ID')}` : '',
      note.audioSource ? `- Sumber audio: ${note.audioSource}` : '',
      note.translatorModel ? `- Model terjemahan: ${note.translatorModel}` : '',
      ''
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '');
    if (note.conclusion?.text) lines.push('## Kesimpulan', '', note.conclusion.text, '');
    lines.push('## Transkrip', '');
    for (const segment of [...note.segments].reverse()) {
      lines.push(`**${segment.time}** — ${segment.japanese}`, '', `> ${segment.indonesian || '(belum diterjemahkan)'}`, '');
    }
    return lines.join('\n');
  }

  async flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const note = this.cache.get(id);
      if (note) await this.write(note);
    }
  }

  private touch(note: SessionNote) {
    note.updatedAt = new Date().toISOString();
    this.dirty.add(note.id);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, 1000);
    }
  }

  private async read(id: string): Promise<SessionNote | null> {
    if (!/^[\w-]+$/.test(id)) return null;
    const cached = this.cache.get(id);
    if (cached) return cached;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.filePath(id), 'utf8')) as SessionNote;
      if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.segments)) return null;
      this.cache.set(id, parsed);
      return parsed;
    } catch {
      // Missing or corrupt note files are skipped instead of crashing the app.
      return null;
    }
  }

  private async write(note: SessionNote) {
    await this.ensureDir();
    const target = this.filePath(note.id);
    const temp = `${target}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify(note, null, 2), 'utf8');
    await fs.promises.rename(temp, target);
  }

  private async ensureDir() {
    await fs.promises.mkdir(this.dir, { recursive: true });
  }

  private filePath(id: string) {
    return path.join(this.dir, `${id}.json`);
  }

  private makeId(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    let id = base;
    for (let n = 2; this.cache.has(id) || fs.existsSync(this.filePath(id)); n += 1) id = `${base}-${n}`;
    return id;
  }
}
