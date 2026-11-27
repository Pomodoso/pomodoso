import { useState } from 'react'
import { Head } from 'vite-react-ssg'
import { CHROME_STORE_URL } from '../lib/extension.ts'

// Opened by Chrome right after the extension is removed
// (chrome.runtime.setUninstallURL in the extension's background): a short,
// anonymous "why did you remove it?". The URL carries only the extension
// version (v) and the day it was installed (i, turned into days installed
// here). The answer goes to POST /feedback/uninstall, without the account.

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080'

// Kept in step with REASONS in backend/src/routes/feedback.rs.
const REASONS: { id: string; label: string }[] = [
  { id: 'not_using', label: 'I wasn’t using it enough' },
  { id: 'missing_feature', label: 'It was missing something I need' },
  { id: 'too_complex', label: 'It was too complicated' },
  { id: 'broken', label: 'Something didn’t work' },
  { id: 'other_app', label: 'I use another app for this' },
  { id: 'privacy', label: 'I’m worried about its permissions or privacy' },
  { id: 'just_trying', label: 'I was only trying it out' },
  { id: 'other', label: 'Something else' },
]

const ACCENT = '#C8553D'

export default function Goodbye() {
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!reason) return
    setState('sending')
    // Read at submit, not render: the page is prerendered, where there is no
    // query string to read.
    const params = new URLSearchParams(window.location.search)
    // Days since the install day the extension passed (i=YYYY-MM-DD).
    const installed = Date.parse(params.get('i') ?? '')
    const days = Number.isFinite(installed) ? Math.max(0, Math.floor((Date.now() - installed) / 86_400_000)) : undefined
    try {
      const res = await fetch(`${API_URL}/feedback/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          comment: comment.trim() || undefined,
          version: params.get('v') || undefined,
          days_installed: days,
        }),
      })
      setState(res.ok ? 'sent' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div style={{ background: '#0a0a0e', minHeight: '100vh', padding: '60px 20px', display: 'flex', justifyContent: 'center' }}>
      <Head>
        <title>Pomodoso · Sorry to see you go</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginBottom: 28 }}>🍅 Pomodoso</div>

        {state === 'sent' ? (
          <div>
            <h1 style={titleStyle}>Thank you</h1>
            <p style={textStyle}>This goes straight to the person who builds Pomodoso, and it shapes what gets fixed next.</p>
            <a href={CHROME_STORE_URL} style={{ fontSize: 13, color: ACCENT }}>Removed it by mistake? Install it again</a>
          </div>
        ) : (
          <form onSubmit={send}>
            <h1 style={titleStyle}>Sorry to see you go</h1>
            <p style={textStyle}>What made you remove Pomodoso? One click helps. It’s anonymous: your account isn’t included.</p>

            <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <legend style={{ position: 'absolute', left: -9999 }}>Why did you remove it?</legend>
              {REASONS.map(r => {
                const selected = reason === r.id
                return (
                  <label key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    padding: '9px 12px', borderRadius: 8, fontSize: 14,
                    border: `1px solid ${selected ? ACCENT : 'rgba(255,255,255,0.1)'}`,
                    background: selected ? 'rgba(200,85,61,0.12)' : 'transparent',
                    color: selected ? '#fff' : 'rgba(255,255,255,0.75)',
                  }}>
                    <input type="radio" name="reason" value={r.id} checked={selected} onChange={() => setReason(r.id)} style={{ accentColor: ACCENT }} />
                    {r.label}
                  </label>
                )
              })}
            </fieldset>

            <label style={{ display: 'block', marginBottom: 16 }}>
              <span style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Anything else? (optional)</span>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={2000}
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 14,
                  padding: '8px 10px', borderRadius: 8, color: '#fff',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
                }}
              />
            </label>

            {state === 'error' && (
              <p style={{ fontSize: 13, color: '#f87171', margin: '0 0 12px' }}>It couldn’t be sent. Check your connection and try again.</p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <a href={CHROME_STORE_URL} style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Removed it by mistake?</a>
              <button
                type="submit"
                disabled={!reason || state === 'sending'}
                style={{
                  padding: '9px 18px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600,
                  background: ACCENT, color: '#fff',
                  cursor: !reason || state === 'sending' ? 'default' : 'pointer',
                  opacity: !reason || state === 'sending' ? 0.5 : 1,
                }}
              >
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const titleStyle: React.CSSProperties = { fontSize: '1.6rem', fontWeight: 800, color: '#fff', margin: '0 0 8px', letterSpacing: '-0.02em' }
const textStyle: React.CSSProperties = { fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, margin: '0 0 20px' }
