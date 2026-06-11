import { Link } from 'react-router-dom'

export default function Refund() {
  return (
    <div style={{ background: '#0a0a0e', minHeight: '100vh', padding: '60px 20px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.4)', textDecoration: 'none', marginBottom: 40 }}>← Back</Link>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Refund Policy</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 48 }}>Last updated: June 2026</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 36, fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75 }}>
          {[
            {
              title: '7-day money-back guarantee',
              body: 'We offer a full refund on any Pomodoso paid plan (Pro Annual, Pro Monthly, or Founder Lifetime) within 7 days of purchase — no questions asked. If you are not satisfied for any reason, contact us and we will process your refund promptly.',
            },
            {
              title: 'How to request a refund',
              body: 'Email support@pomodoso.com from the address associated with your account. Include "Refund Request" in the subject line. We will confirm and process your refund within 2 business days. Refunds are returned to the original payment method.',
            },
            {
              title: 'After the 7-day window',
              body: 'Refunds are not available after 7 days from the original purchase date. If you have a special circumstance, contact us and we will review it on a case-by-case basis.',
            },
            {
              title: 'Cancellations',
              body: 'Cancelling a subscription stops future charges but does not refund the current billing period. Pro features remain available until the end of the paid period. To cancel, visit Dashboard → Settings → Billing → Manage subscription.',
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
