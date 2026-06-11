import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'

const CHROME_STORE_URL = 'https://chrome.google.com/webstore'

export default function Pricing() {
  return (
    <>
      <Helmet>
        <title>Pricing — Pomodoso</title>
        <meta name="description" content="Pomodoso is free forever. Pro adds sync, dashboard, and unlimited workspaces at $49/year." />
      </Helmet>

      <div className="min-h-screen bg-[#0d0e11] text-neutral-100">
        {/* Minimal nav */}
        <nav className="border-b border-white/5 px-6 py-4 max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="font-bold tracking-tight text-sm">Pomodoso</Link>
          <a
            href={CHROME_STORE_URL}
            className="px-3 py-1.5 rounded-md bg-white text-neutral-900 text-xs font-semibold hover:bg-neutral-100 transition-colors"
          >
            Add to Chrome
          </a>
        </nav>

        <main className="max-w-5xl mx-auto px-6 pt-20 pb-24">
          <div className="text-center mb-14">
            <h1 className="text-4xl font-bold tracking-tight mb-4">Simple pricing</h1>
            <p className="text-neutral-400 text-sm">
              The full extension is free. Pay only for cloud features.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {/* Free */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-7">
              <div className="text-xs text-neutral-500 mb-1">Free</div>
              <div className="text-3xl font-bold mb-1">$0</div>
              <div className="text-xs text-neutral-500 mb-6">forever</div>
              <ul className="space-y-2.5 mb-8">
                {[
                  'Full Chrome extension',
                  'Pomodoro + Stopwatch timer',
                  'Tasks & priorities',
                  'Habit tracking',
                  'Ticket auto-detection',
                  'Google Calendar',
                  '1 workspace',
                  'Local storage only',
                  '30-day history',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-neutral-300">
                    <span className="text-green-400 text-xs">✓</span> {f}
                  </li>
                ))}
              </ul>
              <a
                href={CHROME_STORE_URL}
                className="block text-center py-2.5 rounded-lg border border-white/10 text-sm font-medium text-neutral-300 hover:bg-white/5 transition-colors"
              >
                Add to Chrome
              </a>
            </div>

            {/* Pro */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-7 relative">
              <div className="absolute top-4 right-4 text-xs bg-white/10 text-neutral-300 px-2 py-0.5 rounded-full">
                Popular
              </div>
              <div className="text-xs text-neutral-500 mb-1">Pro</div>
              <div className="text-3xl font-bold mb-1">$49</div>
              <div className="text-xs text-neutral-500 mb-6">per year · ~$4/mo</div>
              <ul className="space-y-2.5 mb-6">
                {[
                  'Everything in Free',
                  'Multi-device sync',
                  'Web dashboard',
                  'Unlimited workspaces',
                  'Full history',
                  'No upgrade prompts',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-neutral-300">
                    <span className="text-green-400 text-xs">✓</span> {f}
                  </li>
                ))}
              </ul>
              <div className="text-xs text-neutral-500 mb-4">Also available: $7/month</div>
              <a
                href="https://app.pomodoso.com"
                className="block text-center py-2.5 rounded-lg bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 transition-colors"
              >
                Get Pro →
              </a>
            </div>

            {/* Founder Lifetime */}
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] p-7 relative">
              <div className="absolute top-4 right-4 text-xs bg-amber-400/15 text-amber-300 px-2 py-0.5 rounded-full">
                Limited
              </div>
              <div className="text-xs text-amber-400/70 mb-1">Founder Lifetime</div>
              <div className="text-3xl font-bold mb-1">$99</div>
              <div className="text-xs text-neutral-500 mb-6">once · first 200 users</div>
              <ul className="space-y-2.5 mb-6">
                {[
                  'Everything in Pro',
                  'Lifetime access',
                  'All future features',
                  'Priority support',
                  'Early access to AI features',
                  'Forever, no recurring fees',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-neutral-300">
                    <span className="text-amber-400 text-xs">✓</span> {f}
                  </li>
                ))}
              </ul>
              <a
                href="https://app.pomodoso.com"
                className="block text-center py-2.5 rounded-lg bg-amber-400 text-neutral-900 text-sm font-semibold hover:bg-amber-300 transition-colors"
              >
                Get Lifetime →
              </a>
            </div>
          </div>

          <p className="text-center text-xs text-neutral-500 mt-10">
            All plans include a{' '}
            <span className="text-neutral-400">no-questions-asked refund</span> within 7 days.
          </p>
        </main>
      </div>
    </>
  )
}
