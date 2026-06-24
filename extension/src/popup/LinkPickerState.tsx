import { useState } from 'react';
import type { TicketRef } from '@pomodoso/types';
import type { SelectedTask, TaskStatus } from './App';

const STATUS_DOT: Record<TaskStatus, string> = {
  todo: 'var(--color-border-strong)',
  in_progress: 'var(--color-warning)',
  done: 'var(--color-success)',
  delayed: 'var(--color-text-muted)',
  cancelled: 'var(--color-text-faint)',
};

interface LinkPickerStateProps {
  ticket: TicketRef;
  allTasks: Record<string, SelectedTask>;
  todayPriorities: SelectedTask[];
  todayTasks: SelectedTask[];
  backlog: SelectedTask[];
  onLink: (task: SelectedTask) => void;
  onBack: () => void;
}

function LinkIcon({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function LinkPickerState({ ticket, allTasks, todayPriorities, todayTasks, backlog, onLink, onBack }: LinkPickerStateProps) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const searching = q !== '';

  const matches = (t: SelectedTask) =>
    t.title.toLowerCase().includes(q) || (t.ticketId ?? '').toLowerCase().includes(q);

  // Default view: only today's tasks (priorities first) then the backlog — the
  // things you're actually working on. Closed/done tasks aren't loaded here.
  // While searching we scan every local task (incl. done) so a finished issue is
  // still findable. TODO: once closed tasks stop syncing locally, route the
  // search query to a backend endpoint instead of `allTasks`.
  const today = [...todayPriorities, ...todayTasks];
  const groups: { label: string; items: SelectedTask[] }[] = searching
    ? [{
        label: 'Results',
        items: Object.values(allTasks).filter(t => t.status !== 'cancelled' && matches(t)),
      }]
    : [
        { label: 'Today', items: today },
        { label: 'Backlog', items: backlog },
      ];

  const total = groups.reduce((n, g) => n + g.items.length, 0);

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
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>Link to task</span>
      </div>

      {/* Ticket being linked */}
      <div style={{
        margin: '10px 14px 0',
        padding: '8px 12px',
        background: 'var(--color-accent-soft)',
        border: '1px solid var(--color-accent)',
        borderRadius: 'var(--radius-md)',
        display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0,
      }}>
        <LinkIcon size={12} color="var(--color-accent)" />
        {ticket.external_id && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', flexShrink: 0 }}>
            {ticket.external_id}
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ticket.title}
        </span>
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
        {total === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--color-text-faint)' }}>
            {searching ? 'No tasks match' : 'Nothing in Today or Backlog'}
          </div>
        ) : (
          groups.map(group => group.items.length === 0 ? null : (
            <div key={group.label}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--color-text-faint)', margin: '8px 2px 4px',
              }}>
                {group.label}
              </div>
              {group.items.map(task => (
                <button
                  key={task.id}
                  onClick={() => onLink(task)}
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
                  {(task.links?.length ?? 0) > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-faint)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
                      <LinkIcon size={10} color="var(--color-text-faint)" /> {task.links!.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
