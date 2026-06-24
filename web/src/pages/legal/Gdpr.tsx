import { Link } from 'react-router-dom'

export default function Gdpr() {
  return (
    <div style={{ background: '#0a0a0e', minHeight: '100vh', padding: '60px 20px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.4)', textDecoration: 'none', marginBottom: 40 }}>Back</Link>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.02em' }}>GDPR</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 48 }}>Last updated: June 2026</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 36, fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75 }}>
          {[
            {
              title: 'Overview',
              body: 'Pomodoso is designed with privacy first. The free tier of the product stores all data exclusively on your device and transmits nothing to our servers. If you are an EU resident using the Pro plan (cloud sync), this page describes how we handle your data under the General Data Protection Regulation (GDPR).',
            },
            {
              title: 'Data controller',
              body: 'The data controller for Pomodoso Pro cloud services is the Pomodoso team. You can contact us at hello@pomodose.app for any data-related requests.',
            },
            {
              title: 'What data we collect (Pro only)',
              body: 'When you use cloud sync (Pro), we store: your email address (from your Supabase auth account), your tasks, habits, habit logs, pomodoro sessions, and workspace metadata. This data is used solely to provide sync functionality and is encrypted in transit.',
            },
            {
              title: 'Legal basis for processing',
              body: 'We process your data based on the performance of a contract (providing the Pro sync service you subscribed to) and your explicit consent at sign-up.',
            },
            {
              title: 'Data retention',
              body: 'Your data is retained for as long as your account is active. If you delete your account, all associated data is permanently deleted within 30 days.',
            },
            {
              title: 'Your rights',
              body: 'As an EU resident, you have the right to: access your personal data, correct inaccurate data, request deletion of your data, restrict or object to processing, and data portability. To exercise any of these rights, contact us at hello@pomodose.app.',
            },
            {
              title: 'Data transfers',
              body: 'Your data may be stored on servers outside the EU (currently Railway.app infrastructure). We ensure appropriate safeguards are in place for any such transfers.',
            },
            {
              title: 'Sub-processors',
              body: 'We rely on the following third-party processors to operate the service, each handling only the data needed for its function: Supabase (authentication), Railway (backend hosting and database), Vercel (web hosting), Stripe (payments), Resend (transactional email), Sentry (error monitoring and crash reporting), Crisp (support chat — your email/name when you start a conversation), and Google Analytics (anonymous usage analytics).',
            },
            {
              title: 'Cookies & analytics',
              body: 'The Pomodoso website and dashboard use cookies for authentication sessions, and Google Analytics, which may set cookies or collect anonymous usage metrics to help us improve the product. We do not use advertising cookies.',
            },
            {
              title: 'Contact the supervisory authority',
              body: 'If you believe your data protection rights have been violated, you have the right to lodge a complaint with your national data protection supervisory authority.',
            },
          ].map(s => (
            <section key={s.title}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: 8 }}>{s.title}</h2>
              <p style={{ margin: 0 }}>{s.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
