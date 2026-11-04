import { Link } from 'react-router-dom';
import { Seo } from '../../seo.tsx';
import { AppChecker } from './AppChecker.tsx';
import { SiteHeader } from './SiteHeader.tsx';

// /apps/validate: check any app file and try it, without installing it.

const PLACEHOLDER = `schema_version: 1
id: my-app
name: My app
version: 1.0.0
collections:
  …`;

export default function ValidatePage() {
  return (
    <div className="pomo-site">
      <Seo
        title="Validate a Pomodoso app file"
        description="Paste or upload a Pomodoso app file: see exactly what to fix, then try the app live before installing it."
        path="/apps/validate"
      />
      <SiteHeader current="validate" />

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 80px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#A8432D' }}>VALIDATOR</span>
          <h1 style={{ margin: 0, fontSize: 'clamp(1.9rem, 4.5vw, 2.25rem)', letterSpacing: '-0.02em' }}>Check an app file</h1>
          <p style={{ margin: 0, color: '#44423C', maxWidth: 680 }}>
            Paste a file, written by hand or by an assistant, or upload it. It's checked as you type, with the same rules Pomodoso uses to install and publish. When it's valid you can try the app right here. The file stays in your browser.
          </p>
          <p style={{ margin: 0, color: '#44423C', maxWidth: 680 }}>
            Not sure what a key means? See the <Link to="/apps/docs">app docs</Link>. To write one with AI, start at <Link to="/apps/build">Build with an AI assistant</Link>.
          </p>
        </section>
        <AppChecker placeholder={PLACEHOLDER} />
      </main>
    </div>
  );
}
