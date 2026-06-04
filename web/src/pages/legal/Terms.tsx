import { Link } from 'react-router-dom'

export default function Terms() {
  return (
    <div style={{ background: '#0a0a0e', minHeight: '100vh', padding: '60px 20px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.4)', textDecoration: 'none', marginBottom: 40 }}>← Back</Link>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Terms of Service</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 48 }}>Last updated: June 2026</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 36, fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75 }}>
          {[
            {
              title: '1. Acceptance of Terms',
              body: 'By installing or using Pomodoso (the "Extension" or "Service"), you agree to these Terms of Service. If you do not agree, do not use the Service. These terms apply to all users, including free and paid plan subscribers.',
            },
            {
              title: '2. Description of Service',
              body: 'Pomodoso is a Chrome browser extension that helps you track your work. The free tier operates entirely on your local device. Paid (Pro) plans add cloud sync, web dashboard access, and other features as described on the pricing page.',
            },
            {
              title: '3. User Accounts',
              body: 'An account is required only for Pro features. You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. You must provide accurate information when creating an account.',
            },
            {
              title: '4. Acceptable Use',
              body: 'You agree not to: (a) use the Service for any illegal purpose; (b) attempt to gain unauthorized access to any part of the Service; (c) reverse engineer, decompile, or disassemble the Service except as permitted by law; (d) use the Service to transmit any harmful or malicious code.',
            },
            {
              title: '5. Paid Plans and Billing',
              body: 'Paid plans are billed in advance. Subscriptions auto-renew unless cancelled. Lifetime plans are a one-time purchase with no recurring fees. We use Stripe for payment processing — your payment details are never stored on our servers.',
            },
            {
              title: '6. Refund Policy',
              body: 'We offer a 7-day no-questions-asked refund on all paid plans. To request a refund, contact us at support@pomodoso.com within 7 days of purchase. Lifetime plans are also eligible for refund within 7 days of purchase.',
            },
            {
              title: '7. Intellectual Property',
              body: 'The Chrome extension is open source (MIT license). The backend service, web dashboard, and marketing materials are proprietary. You may not use our name, logo, or brand identity without written permission.',
            },
            {
              title: '8. Disclaimers',
              body: 'The Service is provided "as is" without warranties of any kind. We do not guarantee uninterrupted availability. We are not liable for any loss of data or productivity resulting from use or inability to use the Service.',
            },
            {
              title: '9. Changes to Terms',
              body: 'We may update these terms from time to time. We will notify users of material changes via email or in-app notice. Continued use of the Service after changes constitutes acceptance of the new terms.',
            },
            {
              title: '10. Contact',
              body: 'Questions about these Terms? Contact us at support@pomodoso.com.',
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
