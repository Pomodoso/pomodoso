import type { ReactNode } from 'react';

// The header of a foldable Today section (Habits, Challenges, Apps): a
// chevron and the label as one button. Folded, it shows a one-line summary
// so the section still says something ("2 / 5 done", "3 apps").

export function TodaySectionHeader({ label, open, onToggle, summary, right }: {
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Shown while folded, next to the label. */
  summary?: ReactNode;
  /** Shown while open, on the right (a count, a toggle). */
  right?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: open ? 6 : 0 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1,
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M6 3l5 5-5 5" />
        </svg>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {!open && summary ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {summary}</span>
        ) : null}
      </button>
      {open && right ? right : null}
    </div>
  );
}
