export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-zinc-500 text-sm mb-10">Last updated: June 2026</p>

        <div className="space-y-8 text-zinc-400 leading-relaxed text-sm">
          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Local-only operation</h2>
            <p>
              Pomodoso operates entirely on your device.{' '}
              <strong className="text-zinc-300">No data is transmitted to any Pomodoso server.</strong>{' '}
              All tasks, habits, sessions, and settings are stored in your browser's local storage (
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-zinc-300">IndexedDB</code>
              ). Uninstalling the extension permanently removes this data.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Data accessed by the extension</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 pr-4 text-zinc-300 font-medium">Data</th>
                    <th className="text-left py-2 pr-4 text-zinc-300 font-medium">Purpose</th>
                    <th className="text-left py-2 text-zinc-300 font-medium">Transmitted?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr>
                    <td className="py-2.5 pr-4">Google account email</td>
                    <td className="py-2.5 pr-4">Identify Calendar connection</td>
                    <td className="py-2.5 text-zinc-500">Only to Google — never to Pomodoso</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Google Calendar events (today)</td>
                    <td className="py-2.5 pr-4">Show meetings in the popup</td>
                    <td className="py-2.5 text-zinc-500">Only to Google — never to Pomodoso</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Active tab URL</td>
                    <td className="py-2.5 pr-4">Detect Linear / GitHub / Sentry tickets</td>
                    <td className="py-2.5 text-zinc-500">Never — read locally only</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Page title and issue ID</td>
                    <td className="py-2.5 pr-4">Pre-fill task name from detected ticket</td>
                    <td className="py-2.5 text-zinc-500">Never — stored locally as a task</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Selected text</td>
                    <td className="py-2.5 pr-4">Quick task creation from any page</td>
                    <td className="py-2.5 text-zinc-500">Never — stored locally as a task</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Google Calendar (optional)</h2>
            <p>
              Calendar sync is an optional feature that requires you to connect a Google account. When enabled,
              the extension uses Google's OAuth 2.0 flow to obtain a token with read-only access to your calendars.
              This token is stored locally in your browser and is used exclusively to fetch today's events directly
              from Google's Calendar API. We never see or store your calendar data.
            </p>
            <p className="mt-2">
              You can revoke access at any time from the extension's Settings page or from your{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300 underline"
              >
                Google Account permissions
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">What we never collect</h2>
            <ul className="space-y-1.5">
              {[
                'Browsing history or visited URLs',
                'Full page content or screenshots',
                'Keystrokes or form inputs',
                'Any data from pages outside the supported sites',
                'Anything not listed above',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Third-party services</h2>
            <ul className="space-y-2">
              <li>
                <strong className="text-zinc-300">Google</strong> — Calendar API and OAuth 2.0 authentication.
                Used only when you explicitly connect a Google account. Governed by{' '}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-400 hover:text-orange-300 underline"
                >
                  Google's Privacy Policy
                </a>
                .
              </li>
              <li><strong className="text-zinc-300">Supabase</strong> — authentication for Pro (cloud sync) accounts. <strong className="text-zinc-300">Stripe</strong> — payment processing for paid plans.</li>
              <li><strong className="text-zinc-300">Sentry</strong> — error monitoring and crash reporting on the web app.</li>
              <li><strong className="text-zinc-300">Google Analytics</strong> &amp; <strong className="text-zinc-300">Vercel</strong> — anonymous usage and traffic analytics for the web app (Vercel also hosts it).</li>
              <li><strong className="text-zinc-300">Crisp</strong> — support chat on the website; receives your email and name when you start a conversation.</li>
            </ul>
            <p className="mt-3">The browser extension itself contains no analytics, crash-reporting, or advertising SDK, and transmits nothing to Pomodoso on the free tier. The services above apply to the Pomodoso web app and dashboard (and, for Supabase/Stripe, to Pro accounts).</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Changes to this policy</h2>
            <p>
              If we make material changes, we will update the date at the top of this page.
              Continued use of the extension after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Contact</h2>
            <p>
              Privacy questions:{' '}
              <a href="mailto:alberto@paparelli.com.ar" className="text-orange-400 hover:text-orange-300 underline">
                alberto@paparelli.com.ar
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
