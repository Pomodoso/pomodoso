import { useState } from 'react';
import type { SelectedTask, TaskStatus } from './App';

const STATUS_DOT: Record<TaskStatus, string> = {
  todo: 'var(--color-border-strong)',
  in_progress: 'var(--color-warning)',
  done: 'var(--color-success)',
  delayed: 'var(--color-text-muted)',
  cancelled: 'var(--color-text-faint)',
};

const TITLE_MAX = 128;

interface NotePickerStateProps {
  text: string;
  allTasks: Record<string, SelectedTask>;
  onAdd: (task: SelectedTask) => void;
  onBack: () => void;
}

export function NotePickerState({ text, allTasks, onAdd, onBack }: NotePickerStateProps) {
  const [search, setSearch] = useState('');

  const preview = text.length > TITLE_MAX ? text.slice(0, TITLE_MAX) + '…' : text;

  const tasks = Object.values(allTasks)
    .filter(t => t.status !== 'cancelled')
    .filter(t =>
      search === '' ||
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.ticketId ?? '').toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 18, lineHeight: 1, padding: '0 4px', display: 'flex', alignItems: 'center' }}
        >←</button>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>Add to notes</span>
      </div>

      {/* Text being added */}
      <div style={{
        margin: '10px 14px 0',
        padding: '8px 12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>
          Text to append
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.5, fontStyle: 'italic' }}>
          "{preview}"
        </div>
        {text.length > TITLE_MAX && (
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 4 }}>
            Full text will be appended with timestamp
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>🔍</span>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            style={{
              flex: 1, border: 'none', background: 'none', outline: 'none',
              fontSize: 12, color: 'var(--color-text)', fontFamily: 'inherit',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-faint)', padding: 0, lineHeight: 1 }}
            >×</button>
          )}
        </div>
      </div>

      {/* Task list */}
      <div className="scroll-area" style={{ padding: '8px 14px 12px' }}>
        {tasks.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--color-text-faint)' }}>
            {search ? 'No tasks match' : 'No tasks yet'}
          </div>
        ) : (
          tasks.map(task => (
            <button
              key={task.id}
              onClick={() => onAdd(task)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', marginBottom: 4,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: STATUS_DOT[task.status],
              }} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {task.title}
              </span>
              {task.ticketId && (
                <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-info)', flexShrink: 0 }}>
                  {task.ticketId}
                </span>
              )}
              {task.description && (
                <span style={{ fontSize: 10, color: 'var(--color-text-faint)', flexShrink: 0 }}>
                  has notes
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
