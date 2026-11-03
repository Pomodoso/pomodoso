import { useState, type CSSProperties } from 'react';
import { CHROME_STORE_URL, installInExtension } from '../lib/extension.ts';

// Install an app from the directory into the Pomodoso extension. The extension
// shows its install preview and the user confirms there; this only asks.

type Outcome = 'opened' | 'waiting' | 'no-extension';

export function InstallAppButton({ slug, name, className, style, label = 'Install' }: {
  slug: string;
  name: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const install = () => {
    void installInExtension(slug).then((r) => setOutcome(!r?.ok ? 'no-extension' : r.opened ? 'opened' : 'waiting'));
  };

  return (
    <>
      <button type="button" className={className} style={style} aria-label={`${label} ${name}`} onClick={install}>
        <i className="ti ti-download" aria-hidden="true" />
        {label}
      </button>
      {outcome ? <InstallOutcome outcome={outcome} /> : null}
    </>
  );
}

function InstallOutcome({ outcome }: { outcome: Outcome }) {
  const style: CSSProperties = { fontSize: 12, color: 'var(--text-sec, var(--color-text-muted))', flexBasis: '100%' };
  if (outcome === 'opened') return <div role="status" style={style}>Opened in Pomodoso. Confirm the install there.</div>;
  if (outcome === 'waiting') return <div role="status" style={style}>Click the Pomodoso icon in Chrome's toolbar to finish installing.</div>;
  return (
    <div role="status" style={style}>
      Installing needs the Pomodoso extension for Chrome (1.4 or later), signed in.{' '}
      <a href={CHROME_STORE_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, var(--color-accent))' }}>Get it</a>
    </div>
  );
}
