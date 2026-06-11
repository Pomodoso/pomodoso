import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.tsx'

const CHROME_URL = 'https://chromewebstore.google.com/detail/pomodoso/kloaflkoffpkpldhaipegeabhhkijhbj'
const ACCENT = '#f97316'
const CONTACT = 'hello@pomodose.app'

const card: React.CSSProperties = {
  background: 'linear-gradient(150deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 100%)',
  border: '1px solid rgba(255,255,255,0.07)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)',
  borderRadius: 14,
}

function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none">
      <circle cx="48" cy="48" r="36" stroke="#C8553D" strokeWidth="6" />
      <circle cx="74" cy="22" r="9" fill="#C8553D" />
      <circle cx="48" cy="48" r="10" fill="#1A1A17" />
    </svg>
  )
}

export default function Landing() {
  const { session, loading } = useAuth()
  const authed = !loading && !!session
  return (
    <div style={{ background: 'linear-gradient(175deg, #111118 0%, #0a0a0e 60%, #08080b 100%)', color: '#f1f1f2', fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh' }}>
      <Nav authed={authed} />
      <Hero authed={authed} />
      <FeatureCarousel />
      <HowItWorks />
      <Pricing authed={authed} />
      <FAQ />
      <PageFooter />
    </div>
  )
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

function Nav({ authed }: { authed: boolean }) {
  const lnk = (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.color = '#fff')
  const lnkOut = (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.45)')
  return (
    <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(14px)', background: 'rgba(11,11,16,0.85)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <Logo size={22} />
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: '#fff' }}>Pomodoso</span>
          </Link>
          <div style={{ display: 'flex', gap: 22 }}>
            {[['#features', 'Features'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']].map(([href, label]) => (
              <a key={label} href={href} style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', textDecoration: 'none' }} onMouseEnter={lnk} onMouseLeave={lnkOut}>{label}</a>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {authed ? (
            <Link to="/dashboard" style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, background: ACCENT, color: '#fff', textDecoration: 'none', boxShadow: `0 2px 10px ${ACCENT}40` }}>Dashboard</Link>
          ) : (
            <>
              <Link to="/login" style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', padding: '6px 12px', textDecoration: 'none' }}>Sign in</Link>
              <a href={CHROME_URL} style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, background: ACCENT, color: '#fff', textDecoration: 'none', boxShadow: `0 2px 10px ${ACCENT}40` }}>Add to Chrome</a>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero({ authed }: { authed: boolean }) {
  const gridBg = {
    backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
    backgroundSize: '52px 52px',
  }
  return (
    <section style={{ paddingTop: 140, paddingBottom: 90, textAlign: 'center', position: 'relative', overflow: 'hidden', ...gridBg }}>
      <div style={{ position: 'absolute', top: -60, left: '50%', transform: 'translateX(-50%)', width: 800, height: 500, background: `radial-gradient(ellipse at 50% 0%, ${ACCENT}18 0%, transparent 60%)`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 60%, #0a0a0e 100%)', pointerEvents: 'none' }} />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px', position: 'relative' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 13px', borderRadius: 999, border: `1px solid ${ACCENT}35`, background: 'rgba(249,115,22,0.07)', fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 26 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT, flexShrink: 0, boxShadow: `0 0 6px ${ACCENT}` }} />
          Cloud Sync now available - Early Adopter pricing active
        </div>

        <h1 style={{ fontSize: 'clamp(2.5rem,6vw,4rem)', fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.07, margin: '0 0 18px', color: '#fff' }}>
          Track your work,<br />
          <span style={{ color: ACCENT }}>not your energy.</span>
        </h1>

        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7, maxWidth: 480, margin: '0 auto 34px' }}>
          Auto-detects your tickets as you browse, runs your pomodoro timer, tracks habits, and assembles your daily report without breaking your flow.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          <a href={CHROME_URL} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, background: ACCENT, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', boxShadow: `0 0 0 1px ${ACCENT}90, 0 6px 20px ${ACCENT}35` }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.9" />
              <path d="M12 8h8.5M12 8a4 4 0 0 0-4 4m4-4H3.5M8 12a4 4 0 0 0 4 4m-4-4H3.5a8.5 8.5 0 0 0 4.74 7.53M16 12a4 4 0 0 1-4 4m4-4h4.5a8.5 8.5 0 0 1-4.74 7.53M12 16l-3.26 5.53" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add to Chrome - It's free
          </a>
          {authed ? (
            <Link to="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.8)', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>
              Open Dashboard
            </Link>
          ) : (
            <a href="#pricing" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.8)', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>
              See cloud plans <span style={{ opacity: 0.5 }}>›</span>
            </a>
          )}
        </div>

        {/* Browser strip */}
        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          {[
            { name: 'Chrome', icon: 'ti-brand-chrome', available: true },
            { name: 'Edge', icon: 'ti-brand-edge', available: true },
            { name: 'Firefox', icon: 'ti-brand-firefox', available: false },
            { name: 'Safari', icon: 'ti-brand-safari', available: false },
          ].map(b => (
            <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: b.available ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)' }}>
              <i className={`ti ${b.icon}`} style={{ fontSize: 16 }} aria-hidden="true" />
              {b.name}{!b.available && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}> soon</span>}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 10 }}>100% local by default · No account required · Open source</p>
      </div>
    </section>
  )
}

// ─── Main Features (6 impactful) ──────────────────────────────────────────────

// ─── Feature Carousel ────────────────────────────────────────────────────────

const SLIDES = [
  {
    src: '/screenshots/screenshot_1_timer_1280x800.png',
    tab: 'Timer',
    label: 'Stay in the flow',
  },
  {
    src: '/screenshots/screenshot_2_tasks_1280x800.png',
    tab: 'Tasks',
    label: 'Prioritize what matters',
  },
  {
    src: '/screenshots/screenshot_3_detection_1280x800.png',
    tab: 'Detection',
    label: 'Detect tasks automatically',
  },
  {
    src: '/screenshots/screenshot_4_calendar_1280x800.png',
    tab: 'Calendar',
    label: 'Your calendar, always visible',
  },
  {
    src: '/screenshots/screenshot_5_habits_1280x800.png',
    tab: 'Habits',
    label: 'Build habits that stick',
  },
]

function FeatureCarousel() {
  const [active, setActive] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setActive(i => (i + 1) % SLIDES.length)
    }, 4000)
  }

  useEffect(() => {
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const goTo = (i: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    setActive(i)
    startTimer()
  }

  return (
    <section id="features" style={{ padding: '80px 0 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 40, padding: '0 20px' }}>
        <p style={{ fontSize: 11, color: ACCENT, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Features</p>
        <h2 style={{ fontSize: 'clamp(1.7rem,3.5vw,2.5rem)', fontWeight: 800, letterSpacing: '-0.025em', margin: '0 0 10px', color: '#fff' }}>
          Everything you need,{' '}
          <span style={{ color: ACCENT }}>nothing you don't</span>
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.38)', maxWidth: 420, margin: '0 auto' }}>Built for developers who already have enough tools open.</p>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 28, padding: '0 20px', flexWrap: 'wrap' }}>
        {SLIDES.map((s, i) => (
          <button key={s.tab} onClick={() => goTo(i)} style={{
            padding: '6px 16px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
            background: active === i ? ACCENT : 'rgba(255,255,255,0.06)',
            color: active === i ? '#fff' : 'rgba(255,255,255,0.45)',
            boxShadow: active === i ? `0 2px 10px ${ACCENT}50` : 'none',
          }}>
            {s.tab}
          </button>
        ))}
      </div>

      {/* Screenshot */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 20px', position: 'relative' }}>
        <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)', position: 'relative' }}>
          {SLIDES.map((s, i) => (
            <img key={s.src} src={s.src} alt={s.label} style={{
              width: '100%', display: 'block',
              position: i === 0 ? 'relative' : 'absolute',
              top: i === 0 ? undefined : 0, left: i === 0 ? undefined : 0,
              opacity: active === i ? 1 : 0,
              transition: 'opacity 0.4s ease',
              pointerEvents: active === i ? 'auto' : 'none',
            }} />
          ))}
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
          {SLIDES.map((_, i) => (
            <button key={i} onClick={() => goTo(i)} style={{
              width: active === i ? 20 : 6, height: 6, borderRadius: 999, border: 'none', cursor: 'pointer',
              background: active === i ? ACCENT : 'rgba(255,255,255,0.2)',
              transition: 'all 0.3s', padding: 0,
            }} />
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── How It Works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    { n: '01', title: 'Install the extension', desc: 'Add Pomodoso to Chrome in one click. No account, no setup, no config files.' },
    { n: '02', title: 'Browse your tools', desc: 'Open an issue, PR, or any tracked page and the ticket appears in the popup automatically.' },
    { n: '03', title: 'Start your pomodoro', desc: 'Hit start and work. Pomodoso logs time, tickets, habits, and meetings quietly in the background.' },
  ]
  return (
    <section style={{ borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.018)', padding: '72px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <h2 style={{ fontSize: 'clamp(1.5rem,3vw,2.1rem)', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', margin: '0 0 8px' }}>Up and running in 60 seconds</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)' }}>No API keys, no accounts, no config needed.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
          {steps.map(s => (
            <div key={s.n} style={{ ...card, padding: '24px 26px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, fontFamily: 'monospace', marginBottom: 14, letterSpacing: '0.08em' }}>{s.n}</div>
              <div style={{ fontSize: 14, fontWeight: 650, color: '#fff', marginBottom: 7 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.65 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

const FREE_FEATURES = [
  'Full Chrome extension',
  'Pomodoro + Stopwatch timer',
  'Tasks, priorities and recurrent (no limit)',
  'Habit tracking + weekly history',
  'Task auto-detection + select & convert',
  'Google Calendar',
  'Data import and export',
  'Full history in the extension',
  '1 workspace - Local storage',
]

const PRO_FEATURES = [
  'Everything in Free',
  'Multi-device sync (end-to-end encrypted)',
  'Web dashboard and analytics',
  'Full history in the extension and web',
  'Unlimited workspaces',
  'No upgrade prompts',
]

function Pricing({ authed }: { authed: boolean }) {
  const [annual, setAnnual] = useState(true)

  const btnBase: React.CSSProperties = { display: 'block', textAlign: 'center', padding: '11px', borderRadius: 9, fontSize: 13, fontWeight: 700, textDecoration: 'none', cursor: 'pointer', border: 'none', width: '100%' }

  return (
    <section id="pricing" style={{ maxWidth: 880, margin: '0 auto', padding: '80px 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 44 }}>
        <p style={{ fontSize: 11, color: ACCENT, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Pricing</p>
        <h2 style={{ fontSize: 'clamp(1.7rem,3.5vw,2.5rem)', fontWeight: 800, letterSpacing: '-0.025em', color: '#fff', margin: '0 0 10px' }}>Simple, honest pricing</h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.38)' }}>The extension is free forever. Pay only for cloud features.</p>
        {/* Toggle */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, marginTop: 24, padding: '4px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
          {[{ key: 'monthly', label: 'Monthly' }, { key: 'annual', label: 'Yearly' }].map(({ key, label }) => {
            const active = annual ? key === 'annual' : key === 'monthly'
            return (
              <button key={key} onClick={() => setAnnual(key === 'annual')}
                style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: active ? '#fff' : 'transparent', color: active ? '#111' : 'rgba(255,255,255,0.45)', transition: 'all 0.15s' }}>
                {label}
                {key === 'annual' && <span style={{ marginLeft: 5, fontSize: 10, background: `${ACCENT}20`, color: ACCENT, padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>-43%</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, alignItems: 'stretch' }}>
        {/* Free */}
        <div style={{ ...card, padding: '28px 28px 24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 10 }}>Free</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginBottom: 4 }}>
            <span style={{ fontSize: 44, fontWeight: 800, color: '#fff', letterSpacing: '-0.04em' }}>$0</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginBottom: 24 }}>forever</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
            {FREE_FEATURES.map(f => (
              <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                <span style={{ color: '#4ade80', fontSize: 11, flexShrink: 0, marginTop: 2 }}>✓</span> {f}
              </li>
            ))}
          </ul>
          <a href={CHROME_URL} style={{ ...btnBase, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
            Add to Chrome
          </a>
        </div>

        {/* Pro */}
        <div style={{ borderRadius: 16, border: `1px solid ${ACCENT}45`, background: `linear-gradient(155deg, ${ACCENT}08 0%, rgba(255,255,255,0.02) 60%)`, boxShadow: `inset 0 1px 0 ${ACCENT}30`, padding: '28px 28px 24px', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent 0%, ${ACCENT}70 50%, transparent 100%)` }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: ACCENT, fontWeight: 700 }}>Pro</div>
            <div style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: `${ACCENT}20`, border: `1px solid ${ACCENT}35`, color: ACCENT }}>MOST POPULAR</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 44, fontWeight: 800, color: '#fff', letterSpacing: '-0.04em' }}>{annual ? '$49' : '$7'}</span>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>{annual ? '/year' : '/month'}</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginBottom: 24 }}>
            {annual ? '~$4/month - cancel anytime' : 'or $49/year (save 43%)'}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
            {PRO_FEATURES.map(f => (
              <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
                <span style={{ color: ACCENT, fontSize: 11, flexShrink: 0, marginTop: 2 }}>✓</span> {f}
              </li>
            ))}
          </ul>
          {authed ? (
            <Link to="/settings/billing" style={{ ...btnBase, background: ACCENT, color: '#fff', boxShadow: `0 4px 16px ${ACCENT}45` }}>
              Get Pro
            </Link>
          ) : (
            <Link to="/login" style={{ ...btnBase, background: ACCENT, color: '#fff', boxShadow: `0 4px 16px ${ACCENT}45` }}>
              Get Pro
            </Link>
          )}
        </div>
      </div>

      {/* Founder Lifetime */}
      <div style={{ marginTop: 12, borderRadius: 14, border: '1px solid rgba(255,200,0,0.18)', background: 'linear-gradient(135deg, rgba(251,191,36,0.05) 0%, rgba(255,255,255,0.015) 100%)', boxShadow: 'inset 0 1px 0 rgba(251,191,36,0.1)', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Founder Lifetime Deal</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24' }}>LIMITED TIME</span>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
            Own Pomodoso forever. $99 once, all future Pro features included, no recurring fees.
          </p>
        </div>
        {authed ? (
          <Link to="/settings/billing" style={{ flexShrink: 0, padding: '8px 18px', borderRadius: 8, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>Get Lifetime</Link>
        ) : (
          <Link to="/login" style={{ flexShrink: 0, padding: '8px 18px', borderRadius: 8, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>Get Lifetime</Link>
        )}
      </div>

      <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.22)', marginTop: 14 }}>
        Refund available if the product does not work as described
      </p>
    </section>
  )
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const FAQS = [
  { q: 'Does Pomodoso work without an account?', a: 'Yes. The full extension works completely offline, no account required. Everything is stored locally on your device. An account is only needed for Pro cloud features like multi-device sync and the web dashboard.' },
  { q: 'Does Pomodoso read my browser history or ticket content?', a: 'No. Pomodoso only detects tickets on pages you currently have open, by reading the URL and page title. It never reads body content, sends browsing history to any server, or tracks you across sites.' },
  { q: 'What happens to my data if I cancel Pro?', a: 'Your data stays on your device forever. If you cancel Pro, sync and the web dashboard become unavailable but all your local data remains intact. Nothing is deleted.' },
  { q: 'Is Pomodoso open source?', a: 'Yes. The Chrome extension is MIT licensed and fully auditable on GitHub. The backend sync server is source-available.' },
  { q: 'What is the Founder Lifetime Deal?', a: 'A one-time payment that gives you Pro forever, including all future features. Available for a limited time after launch as a thank-you to early supporters. Once it closes, it is gone.' },
  { q: 'Can I use Pomodoso on multiple devices?', a: 'The Free plan is single-device (local storage only). Pro includes sync across unlimited devices via end-to-end encrypted cloud sync.' },
  { q: 'Which browsers are supported?', a: 'Chrome and Edge are fully supported today. Firefox and Safari support is planned.' },
]

function FAQ() {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <section id="faq" style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px 80px' }}>
      <h2 style={{ textAlign: 'center', fontSize: 'clamp(1.5rem,3vw,2rem)', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', marginBottom: 32 }}>Frequently asked questions</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {FAQS.map((faq, i) => (
          <div key={i} style={{ ...card, overflow: 'hidden' }}>
            <button onClick={() => setOpen(open === i ? null : i)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 550, color: '#fff' }}>{faq.q}</span>
              <span style={{ fontSize: 18, color: 'rgba(255,255,255,0.3)', flexShrink: 0, transition: 'transform 0.2s', transform: open === i ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>›</span>
            </button>
            {open === i && (
              <div style={{ padding: '0 20px 15px', fontSize: 13, color: 'rgba(255,255,255,0.48)', lineHeight: 1.7 }}>{faq.a}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function PageFooter() {
  const s: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.38)', textDecoration: 'none' }
  const h = (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.75)')
  const l = (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.38)')
  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '18px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}>
          <Logo size={18} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.45)' }}>Pomodoso</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <Link to="/terms" style={s} onMouseEnter={h} onMouseLeave={l}>Terms of Service</Link>
          <Link to="/privacy" style={s} onMouseEnter={h} onMouseLeave={l}>Privacy Policy</Link>
          <Link to="/refund" style={s} onMouseEnter={h} onMouseLeave={l}>Refund Policy</Link>
          <Link to="/gdpr" style={s} onMouseEnter={h} onMouseLeave={l}>GDPR</Link>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" style={s} onMouseEnter={h} onMouseLeave={l}>GitHub</a>
          <a href={`mailto:${CONTACT}`} style={s} onMouseEnter={h} onMouseLeave={l}>Contact</a>
        </div>
      </div>
    </footer>
  )
}
