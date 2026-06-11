import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'

const CHROME_STORE_URL = 'https://chrome.google.com/webstore'

export default function Home() {
  return (
    <>
      <Helmet>
        <title>Pomodoso — Track your work, not your energy</title>
        <meta name="description" content="Chrome extension that auto-detects Linear and GitHub tickets, integrates a Pomodoro timer, tracks habits, and connects to Google Calendar. Local-first, free." />
        <meta property="og:title" content="Pomodoso — Track your work, not your energy" />
        <meta property="og:description" content="Auto-detect tickets. Pomodoro timer. Habit tracking. Google Calendar. All in one Chrome extension." />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "Pomodoso",
          "applicationCategory": "ProductivityApplication",
          "operatingSystem": "Chrome",
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
          "description": "Chrome extension for developers. Auto-detects Linear and GitHub tickets, integrates a Pomodoro timer, tracks habits, and connects to Google Calendar."
        })}</script>
      </Helmet>

      <div className="min-h-screen bg-[#0d0e11] text-neutral-100 font-sans">
        <Nav />
        <Hero />
        <Features />
        <PricingTeaser />
        <FounderCapture />
        <Footer />
      </div>
    </>
  )
}

function Nav() {
  return (
    <nav className="border-b border-white/5 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
      <span className="font-bold tracking-tight text-sm">Pomodoso</span>
      <div className="flex items-center gap-6 text-sm text-neutral-400">
        <Link to="/pricing" className="hover:text-neutral-200 transition-colors">Pricing</Link>
        <a href="https://app.pomodoso.com" className="hover:text-neutral-200 transition-colors">Dashboard</a>
        <a
          href={CHROME_STORE_URL}
          className="px-3 py-1.5 rounded-md bg-white text-neutral-900 text-xs font-semibold hover:bg-neutral-100 transition-colors"
        >
          Add to Chrome
        </a>
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <section className="max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-neutral-400 mb-8">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
        Free Chrome extension · Open source
      </div>
      <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
        Track your work,<br />not your energy
      </h1>
      <p className="text-lg text-neutral-400 max-w-2xl mx-auto mb-10 leading-relaxed">
        Pomodoso auto-detects your Linear and GitHub tickets while you browse,
        integrates a Pomodoro timer, tracks habits, and connects to Google Calendar.
        Everything becomes a daily report.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <a
          href={CHROME_STORE_URL}
          className="px-6 py-3 rounded-lg bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 transition-colors"
        >
          Add to Chrome — Free
        </a>
        <Link
          to="/pricing"
          className="px-6 py-3 rounded-lg border border-white/10 text-sm text-neutral-300 hover:bg-white/5 transition-colors"
        >
          See pricing →
        </Link>
      </div>
    </section>
  )
}

const FEATURES = [
  {
    icon: '◎',
    title: 'Auto ticket detection',
    desc: 'Detects Linear, GitHub, Jira, and custom URLs as you work. No copy-paste.',
  },
  {
    icon: '⏱',
    title: 'Pomodoro + Stopwatch',
    desc: 'Two modes that fit how you actually work. Timer per task, sessions logged.',
  },
  {
    icon: '◫',
    title: 'Google Calendar',
    desc: 'Connects your calendar to track real meeting time alongside focus time.',
  },
  {
    icon: '◉',
    title: 'Workspaces',
    desc: 'Separate Work and Personal completely. Switch with one click.',
  },
  {
    icon: '☑',
    title: 'Habit tracking',
    desc: 'Daily and weekly habits with streaks. Boolean or counter-based.',
  },
  {
    icon: '📋',
    title: 'Daily report',
    desc: 'Today\'s focus time, pomos, tickets, and habits — ready to copy.',
  },
]

function Features() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-20">
      <h2 className="text-xs uppercase tracking-widest text-neutral-500 mb-10 text-center">What it does</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map(f => (
          <div key={f.title} className="rounded-xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors">
            <div className="text-xl mb-3">{f.icon}</div>
            <h3 className="text-sm font-semibold mb-1.5">{f.title}</h3>
            <p className="text-xs text-neutral-500 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function PricingTeaser() {
  return (
    <section className="max-w-3xl mx-auto px-6 py-20">
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center">
        <h2 className="text-2xl font-bold mb-3">Free forever. Pro for power users.</h2>
        <p className="text-sm text-neutral-400 mb-8 max-w-md mx-auto">
          The core extension is completely free. Pro adds sync across devices, a web dashboard, and unlimited workspaces.
        </p>
        <div className="flex justify-center gap-12 mb-8">
          {[
            { plan: 'Free', price: '$0', features: ['1 workspace', 'Local-only', 'All core features'] },
            { plan: 'Pro', price: '$29/yr', features: ['Unlimited workspaces', 'Multi-device sync', 'Web dashboard'] },
          ].map(({ plan, price, features }) => (
            <div key={plan} className="text-left">
              <div className="text-xs text-neutral-500 mb-1">{plan}</div>
              <div className="text-xl font-bold mb-3">{price}</div>
              <ul className="space-y-1.5">
                {features.map(f => (
                  <li key={f} className="text-xs text-neutral-400 flex items-center gap-1.5">
                    <span className="text-green-400">✓</span> {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Link
          to="/pricing"
          className="text-sm text-neutral-400 hover:text-neutral-200 underline underline-offset-4 transition-colors"
        >
          See full pricing details →
        </Link>
      </div>
    </section>
  )
}

function FounderCapture() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: wire to Resend audience
    setDone(true)
  }

  return (
    <section className="max-w-lg mx-auto px-6 py-16 text-center">
      <h2 className="text-lg font-semibold mb-2">Get notified when Pro launches</h2>
      <p className="text-sm text-neutral-400 mb-6">
        Early supporters get a special one-time offer before it's public.
      </p>
      {done ? (
        <p className="text-sm text-green-400">You're on the list.</p>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="flex gap-2">
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm placeholder-neutral-500 focus:outline-none focus:border-white/20"
          />
          <button
            type="submit"
            className="px-5 py-2.5 rounded-lg bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 transition-colors"
          >
            Notify me
          </button>
        </form>
      )}
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/5 px-6 py-8 max-w-6xl mx-auto flex items-center justify-between text-xs text-neutral-500">
      <span>© {new Date().getFullYear()} Pomodoso</span>
      <div className="flex items-center gap-5">
        <Link to="/pricing" className="hover:text-neutral-300 transition-colors">Pricing</Link>
        <a href="/privacy" className="hover:text-neutral-300 transition-colors">Privacy</a>
        <a href="https://github.com" className="hover:text-neutral-300 transition-colors">GitHub</a>
      </div>
    </footer>
  )
}
