import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { PLUGIN_FILE_MAX_BYTES, parsePluginFile, type PluginRecord } from '@pomodoso/types/plugins';
import { LivePreview } from './LivePreview.tsx';

// Paste, upload or drop an app file: it's checked as you type with the same
// validator as the extension, the directory and the server, and rendered
// live when valid. Nothing leaves the page. Used by /apps/validate and the
// walkthrough on /apps/docs.

const code = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18,
  margin: 0, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre', overflowX: 'auto',
} as const;

export function AppChecker({ initial = '', seed, placeholder, minRows = 14 }: {
  initial?: string;
  /** Sample records; only those of collections the file declares are used. */
  seed?: PluginRecord[];
  placeholder?: string;
  minRows?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [text, setText] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const result = useMemo(() => (text.trim() ? parsePluginFile(text) : null), [text]);

  const load = (file: File | undefined) => {
    if (!file) return;
    if (file.size > PLUGIN_FILE_MAX_BYTES) {
      setFileError(`${file.name} is ${Math.round(file.size / 1024)} KB; an app file is at most ${PLUGIN_FILE_MAX_BYTES / 1024} KB.`);
      return;
    }
    setFileError(null);
    void file.text().then(setText);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    load(e.dataTransfer.files[0]);
  };

  const records = result?.ok && seed ? seed.filter((r) => result.manifest.collections.some((c) => c.key === r.collection)) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea
        aria-label="App file"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        spellCheck={false}
        rows={Math.min(48, Math.max(minRows, text.split('\n').length + 1))}
        style={{ ...code, width: '100%', boxSizing: 'border-box', resize: 'vertical', color: 'var(--color-text)', borderColor: dragging ? 'var(--color-accent)' : 'var(--color-border)', borderStyle: dragging ? 'dashed' : 'solid' }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="pomo-site-btn pomo-site-btn-secondary" style={{ height: 32, fontSize: 13, cursor: 'pointer' }}>
          Upload a file
          <input type="file" accept=".yaml,.yml,.json,text/yaml,application/json" hidden onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {text !== initial ? (
          <button type="button" className="pomo-site-btn pomo-site-btn-secondary" style={{ height: 32, fontSize: 13 }} onClick={() => { setText(initial); setFileError(null); }}>
            {initial ? 'Reset' : 'Clear'}
          </button>
        ) : null}
        {result ? (
          <span style={{ fontSize: 14, fontWeight: 600, color: result.ok ? '#2D8A7A' : '#A8432D' }}>
            {result.ok
              ? `Valid: ${result.manifest.name} · ${result.manifest.id} · v${result.manifest.version}`
              : `${result.issues.length} problem${result.issues.length === 1 ? '' : 's'} to fix`}
          </span>
        ) : (
          <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>Paste a file, drop one on the box, or upload it.</span>
        )}
      </div>
      {fileError ? <p style={{ margin: 0, fontSize: 14, color: '#A8432D' }}>{fileError}</p> : null}
      {result && !result.ok ? (
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, fontSize: 14, color: '#A8432D', listStyle: 'disc' }}>
          {result.issues.slice(0, 30).map((i, n) => (
            <li key={n}>
              {i.path ? <code>{i.path}</code> : i.line !== undefined ? <code>line {i.line}</code> : null}
              {i.path || i.line !== undefined ? ': ' : ''}
              {i.message}
            </li>
          ))}
          {result.issues.length > 30 ? <li>…and {result.issues.length - 30} more</li> : null}
        </ul>
      ) : null}
      {/* Keyed by the file, so an edit starts the preview over with the new collections. */}
      {mounted && result?.ok ? <LivePreview key={text} manifest={result.manifest} initialRecords={records} /> : null}
    </div>
  );
}
