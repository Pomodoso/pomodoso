export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-zinc-500 text-sm mb-10">Last updated: November 2026</p>

        <div className="space-y-8 text-zinc-400 leading-relaxed text-sm">
          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Local-first operation</h2>
            <p>
              All tasks, habits, sessions, apps, and settings are stored in your browser's local storage (
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-zinc-300">IndexedDB</code>
              ). Uninstalling the extension permanently removes this data.{' '}
              <strong className="text-zinc-300">Without an account, none of it is transmitted to any Pomodoso server.</strong>{' '}
              Your content reaches our servers only if you sign in and enable sync. Signing in, browsing the app
              directory and publishing an app involve the limited requests described under{' '}
              <a href="#apps" className="text-orange-400 hover:text-orange-300 underline">Apps</a> and Third-party services.
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
                    <td className="py-2.5 pr-4">Show today's meetings next to your tasks and let you log time against them</td>
                    <td className="py-2.5 text-zinc-500">Read on your device; if you sign in and enable sync, the meeting's title, time and duration are stored on Pomodoso's backend to sync across your devices</td>
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
                  <tr>
                    <td className="py-2.5 pr-4">Active tab URL and title, when you add an entry to an app that asks for them</td>
                    <td className="py-2.5 pr-4">Pre-fill the entry (for example, a link in a reading list)</td>
                    <td className="py-2.5 text-zinc-500">Stored locally as your entry; on Pomodoso's backend only if you enable sync</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Google Calendar (optional)</h2>
            <p>
              Connecting Google Calendar is optional and user-initiated. When you connect it, Pomodoso uses
              Google's OAuth 2.0 flow to obtain a <strong className="text-zinc-300">read-only</strong> token
              (<code>calendar.readonly</code>). We never create, edit or delete any calendar data.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">What we access:</strong> your list of calendars (so you can choose
              which to display) and, from the calendars you select, the events for the current day only — each
              event's title, start time and duration.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">How we use it:</strong> solely to show today's meetings alongside
              your tasks and to let you log time against a meeting. It is never used for advertising, profiling, or
              any purpose other than these user-facing features, and it is never sold.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">Where it is stored:</strong> the OAuth token is stored locally in
              your browser and never leaves your device. Calendar events are fetched directly from Google on your
              device. If you sign in and enable sync, the derived meeting records (title, time, duration, and any
              time you log) are stored on Pomodoso's backend so they appear across your devices — the raw Google
              token and any other calendar data are not transmitted to us.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">Retention & deletion:</strong> disconnecting Calendar in Settings
              deletes the local token and cached meetings immediately. Any synced meeting records are removed when
              you delete them or delete your account; you can also revoke access from your Google Account at any
              time (link below).
            </p>
            <p className="mt-2 text-zinc-500">
              Pomodoso's use of information received from Google APIs adheres to the{' '}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300 underline">
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
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
            <h2 className="text-white font-semibold text-lg mb-3">How we share and disclose Google user data</h2>
            <p>
              This section states, specifically, with whom Pomodoso shares, transfers, or discloses data
              obtained through Google APIs (your Google account email and the calendar events you choose to
              display — collectively, <strong className="text-zinc-300">"Google user data"</strong>).
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">We do not sell, rent, trade, or share Google user data</strong>{' '}
              with any third party for advertising, marketing, profiling, or any purpose unrelated to the
              features you explicitly enabled. We do not transfer it to data brokers, ad networks, or similar
              services.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">Our analytics, monitoring, and support providers never receive
              Google user data.</strong> Google Analytics, Sentry, and Crisp (listed under Third-party services
              below) operate only on the Pomodoso web app and do not receive your Google account email or any
              Google Calendar data.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">The only case in which Google user data leaves your device</strong>{' '}
              is optional cloud sync. If you sign in and enable sync, calendar-derived meeting records (each
              event's title, start time, duration, and any time you log against it) are transmitted to and stored
              on Pomodoso's own backend so they appear across your devices. That backend and its database are
              hosted by <strong className="text-zinc-300">Railway</strong> (our infrastructure provider), which
              stores and serves this data solely on our behalf as a sub-processor and does not use it for its own
              purposes. The raw Google OAuth token, your calendar list, and any Google data beyond those derived
              meeting records are <strong className="text-zinc-300">never transmitted to us or to anyone else</strong>.
              If you do not enable sync, no Google user data ever leaves your device.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">Legal and safety disclosures:</strong> we may disclose Google user
              data if required to do so by law or valid legal process, or where we reasonably believe disclosure
              is necessary to protect the rights, property, or safety of Pomodoso, our users, or the public.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">Business transfers:</strong> if Pomodoso is involved in a merger,
              acquisition, or sale of assets, Google user data may transfer to the successor entity, which will
              remain bound by this policy or a policy at least as protective.
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">No AI/ML training:</strong> we do not use Google user data to
              develop, improve, or train generalized or non-personalized AI or machine-learning models.
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
              <li><strong className="text-zinc-300">Supabase</strong> — authentication for Pomodoso accounts. <strong className="text-zinc-300">Stripe</strong> — payment processing for paid plans.</li>
              <li><strong className="text-zinc-300">Sentry</strong> — error monitoring and crash reporting on the web app.</li>
              <li><strong className="text-zinc-300">Google Analytics</strong> — anonymous usage analytics for the web app. <strong className="text-zinc-300">Vercel</strong> — web app hosting.</li>
              <li><strong className="text-zinc-300">Crisp</strong> — support chat on the website; receives your email and name when you start a conversation.</li>
            </ul>
            <p className="mt-3">The browser extension itself contains no analytics, crash-reporting, or advertising SDK. Without an account it transmits nothing to Pomodoso, except the app directory requests described under Apps if you browse the directory. With a free account it also signs you in and checks your plan; your content is transmitted only if you enable sync or publish an app. The services above apply to the Pomodoso web app and dashboard (and, for Supabase, to any account; for Stripe, to paid plans).</p>
          </section>

          <section id="apps">
            <h2 className="text-white font-semibold text-lg mb-3">Apps</h2>
            <p>
              Apps are small trackers you add to Pomodoso. An app is a data file, not code: it can't run scripts
              or send your data anywhere, and it only sees its own entries. Using apps requires a free account.
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-2">
              <li>
                <strong className="text-zinc-300">Your entries</strong> stay on your device. If you sign in and
                enable sync, they are stored on Pomodoso's backend so they appear across your devices and in your
                dashboard. Apps can hold whatever you choose to enter, which may include sensitive information such
                as health notes. App authors never receive your entries.
              </li>
              <li>
                <strong className="text-zinc-300">The directory:</strong> browsing it, installing from it and the
                periodic check for updates to apps you installed from it are requests to{' '}
                <code className="bg-white/5 px-1.5 py-0.5 rounded text-zinc-300">api.pomodoso.com</code>. They carry
                no entries; like any web request, they reveal your IP address to our servers.
              </li>
              <li>
                <strong className="text-zinc-300">Publishing:</strong> an app you publish is uploaded to our servers
                and linked to your account. A public app, including any author name in its file, is visible to
                anyone. Private apps are visible only to you. Taking an app down removes it from the directory;
                copies people already installed keep working.
              </li>
              <li>
                <strong className="text-zinc-300">Reports:</strong> if you report an app, we store your reason and
                your account with the report.
              </li>
              <li>
                <strong className="text-zinc-300">On pomodoso.com</strong> the extension runs a small script, on that
                site only, so "Install in Pomodoso" can open the app's install preview. It passes the app's id and
                nothing else; you confirm inside the extension.
              </li>
            </ul>
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
              <a href="mailto:privacy@pomodoso.com" className="text-orange-400 hover:text-orange-300 underline">
                privacy@pomodoso.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
