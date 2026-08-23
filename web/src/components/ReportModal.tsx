import { useState } from 'react';
import { trackEvent } from '../lib/analytics.ts';

export function ReportModal({ title, filename, content, onClose }: {
  title: string;
  filename: string;
  content: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    trackEvent('report_copied');
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const download = () => {
    trackEvent('report_downloaded');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, width: 'min(640px, 100%)', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
            <i className="ti ti-file-text" style={{ marginRight: 6 }} />
            {title}
          </span>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tert)', fontSize: 16 }}
            title="Close"
          >
            <i className="ti ti-x" />
          </button>
        </div>
        <textarea
          readOnly
          value={content}
          style={{
            flex: 1, minHeight: 320, resize: 'none', border: 'none', outline: 'none',
            padding: '14px 18px', fontFamily: 'var(--font-mono)', fontSize: 12.5,
            lineHeight: 1.55, color: 'var(--text)', background: 'var(--bg-darker)',
          }}
        />
        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--border)', justifyContent: 'flex-end' }}>
          <button className="pomo-btn" onClick={download}>
            <i className="ti ti-download" /> Download .md
          </button>
          <button className="pomo-btn" onClick={copy}>
            <i className={`ti ${copied ? 'ti-check' : 'ti-copy'}`} /> {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
