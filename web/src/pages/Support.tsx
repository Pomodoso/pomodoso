import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.tsx'
import { useCrisp } from '../lib/useCrisp.ts'

// Dedicated page that auto-opens the Crisp chat. It's the target for the
// extension's "Support" link (the popup can't host the chat itself).
export default function Support() {
  const { session, user } = useAuth()
  const email = user?.email ?? session?.user.email
  const name = user?.name ?? (session?.user.user_metadata?.full_name as string | undefined)
  useCrisp({ email, name, open: true })

  return (
    <div style={{ background: '#0a0a0e', minHeight: '100vh', padding: '60px 20px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.4)', textDecoration: 'none', marginBottom: 40 }}>← Back</Link>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Support</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75, margin: '0 0 16px' }}>
          The chat should open automatically in the corner — ask us anything and we'll get back to you.
        </p>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 1.75, margin: 0 }}>
          If the chat doesn't load, email us at{' '}
          <a href="mailto:support@pomodoso.com" style={{ color: 'rgba(255,255,255,0.7)' }}>support@pomodoso.com</a>.
        </p>
      </div>
    </div>
  )
}
