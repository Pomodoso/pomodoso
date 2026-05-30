import { useState } from 'react';
import { ModeToggle } from '@pomodoso/ui';
import type { TimerMode, TicketRef, TimerStartPayload } from '@pomodoso/types';

const DURATION_OPTIONS = [
  { label: '15m', seconds: 15 * 60 },
  { label: '25m', seconds: 25 * 60 },
  { label: '50m', seconds: 50 * 60 },
];

const PROVIDER_LABELS: Record<string, string> = {
  linear: 'Linear',
  github: 'GitHub',
  manual: 'Manual',
};

interface TicketDetectedStateProps {
  ticket: TicketRef;
  onStart: (payload: TimerStartPayload) => Promise<void>;
}

export function TicketDetectedState({ ticket, onStart }: TicketDetectedStateProps) {
  const [mode, setMode] = useState<TimerMode>('pomodoro');
  const [selectedDuration, setSelectedDuration] = useState(25 * 60);

  const handleStart = () => {
    void onStart({
      mode,
      taskId: crypto.randomUUID(), // temp — will come from task selection later
      taskTitle: ticket.title,
      ticketId: null,
      ticketExternalId: ticket.external_id,
    });
  };

  const handleLogOnly = () => {
    // Log without starting timer — placeholder for next session
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🍅</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Pomodoso</span>
        </div>
        <ModeToggle value={mode} onChange={setMode} />
      </div>

      {/* Detection banner */}
      <div style={{
        margin: '12px 14px 0',
        padding: '8px 12px',
        background: 'var(--color-success-bg)',
        border: '1px solid var(--color-success)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>✓</span>
        <span style={{ fontSize: 12, color: 'var(--color-success)', fontWeight: 500 }}>
          {PROVIDER_LABELS[ticket.provider_kind] ?? ticket.provider_kind} ticket detected on this page
        </span>
      </div>

      {/* Ticket card */}
      <div style={{
        margin: '10px 14px 0',
        padding: '10px 12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-accent)',
            fontWeight: 600,
          }}>
            {ticket.external_id}
          </span>
          {ticket.status && (
            <StatusDot status={ticket.status} />
          )}
          <a
            href={ticket.external_url}
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-info)' }}
          >
            ↗ Open
          </a>
        </div>
        <div style={{
          fontSize: 13,
          color: 'var(--color-text)',
          fontWeight: 500,
          lineHeight: 1.4,
        }}>
          {ticket.title}
        </div>
        {ticket.linked_pr && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
            PR {ticket.linked_pr.number}
          </div>
        )}
      </div>

      {/* Duration picker (pomodoro only) */}
      {mode === 'pomodoro' && (
        <div style={{ padding: '10px 14px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Duration:</span>
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setSelectedDuration(opt.seconds)}
              style={{
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid',
                borderColor: selectedDuration === opt.seconds ? 'var(--color-accent)' : 'var(--color-border)',
                background: selectedDuration === opt.seconds ? 'var(--color-accent)' : 'transparent',
                color: selectedDuration === opt.seconds ? '#fff' : 'var(--color-text)',
                fontSize: 12,
                fontWeight: selectedDuration === opt.seconds ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ padding: '12px 14px 0', display: 'flex', gap: 8 }}>
        <button
          onClick={handleStart}
          style={{
            flex: 1,
            padding: '9px 12px',
            background: 'var(--color-accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          ▶ Start
          {mode === 'pomodoro' && (
            <span style={{ opacity: 0.8, fontWeight: 400, fontSize: 11 }}>
              · {DURATION_OPTIONS.find(o => o.seconds === selectedDuration)?.label}
            </span>
          )}
        </button>
        <button
          onClick={handleLogOnly}
          style={{
            padding: '9px 12px',
            background: 'transparent',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Log only
        </button>
      </div>

      <div style={{ flex: 1 }} />
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: 'var(--color-info)',
    in_progress: 'var(--color-warning)',
    in_review: 'var(--color-accent)',
    merged: 'var(--color-success)',
    done: 'var(--color-success)',
    blocked: '#C44',
    waiting: 'var(--color-text-muted)',
  };
  const color = colors[status] ?? 'var(--color-text-muted)';
  return (
    <span style={{
      display: 'inline-block',
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
    }} title={status} />
  );
}
