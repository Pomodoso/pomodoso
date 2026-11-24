import { useEffect, useState } from 'react'

// Where the mobile app's auth emails land (sign-up confirmation, magic link,
// password reset). Supabase redirects here with the session in the URL hash,
// and this page hands it to the app through its pomodoso:// scheme.
//
// The emails used to redirect to pomodoso://auth-callback directly. Phones
// opened that in Gmail's in-app browser or Chrome, which block a redirect to a
// custom scheme, so the user was left on a blank page. A link the user taps is
// never blocked, hence the button; the automatic attempt covers Safari.
//
// Deliberately outside Root/AuthProvider (see main.tsx): the web Supabase
// client would otherwise read the tokens from the hash and sign the browser in,
// spending a refresh token that belongs to the phone.
const APP_URL = 'pomodoso://auth-callback'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; deepLink: string; recovery: boolean }
  | { kind: 'error'; message: string }

export default function AppCallback() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    const hash = window.location.hash
    // Tokens out of the address bar (and so out of history, screenshots and
    // anything that later reads location.href) before anything else runs.
    window.history.replaceState(null, '', window.location.pathname)

    const params = new URLSearchParams(hash.slice(1))
    const error = params.get('error_description') ?? params.get('error')
    if (error) {
      setState({ kind: 'error', message: error.replace(/\+/g, ' ') })
      return
    }
    if (!params.get('access_token')) {
      setState({ kind: 'error', message: 'This link has already been used or has expired.' })
      return
    }

    const deepLink = `${APP_URL}${hash}`
    setState({ kind: 'ready', deepLink, recovery: params.get('type') === 'recovery' })
    window.location.href = deepLink
  }, [])

  return (
    <div style={{ background: '#FBFAF7', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🍅</div>
        {state.kind === 'loading' && <p style={muted}>Opening Pomodoso…</p>}

        {state.kind === 'ready' && (
          <>
            <h1 style={title}>{state.recovery ? 'Reset your password' : 'Your email is confirmed'}</h1>
            <p style={muted}>
              {state.recovery
                ? 'Open Pomodoso to choose a new password.'
                : 'Open Pomodoso to finish signing in.'}
            </p>
            <a href={state.deepLink} style={button}>Open Pomodoso</a>
            {!state.recovery && (
              <p style={{ ...muted, fontSize: 13, marginTop: 20 }}>
                If the app doesn’t open, open Pomodoso yourself and sign in with your email and password.
              </p>
            )}
          </>
        )}

        {state.kind === 'error' && (
          <>
            <h1 style={title}>This link didn’t work</h1>
            <p style={muted}>{state.message}</p>
            <p style={{ ...muted, fontSize: 13, marginTop: 20 }}>
              Open Pomodoso and sign in, or request a new link from the app.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

const title: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: '#1A1A17', margin: '0 0 8px' }
const muted: React.CSSProperties = { fontSize: 15, color: '#5F5D55', lineHeight: 1.5, margin: 0 }
const button: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 24,
  padding: '14px 28px',
  borderRadius: 12,
  background: '#C8553D',
  color: '#fff',
  fontWeight: 700,
  fontSize: 16,
  textDecoration: 'none',
}
