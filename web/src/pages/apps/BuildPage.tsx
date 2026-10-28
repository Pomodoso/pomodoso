import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STARTER_PROMPT } from '@pomodoso/types/plugins';
import { Seo } from '../../seo.tsx';
import { SiteHeader } from './SiteHeader.tsx';

// /apps/build: building an app, mostly with an AI assistant. Points at the
// generated references (llms.txt, llms-full.txt, the JSON Schema) and the
// agent skill, and hands over a starter prompt.

const SKILL_URL = 'https://github.com/Pomodoso/pomodoso/blob/main/shared/plugin/skill/pomodoso-plugin/SKILL.md';

const FILES = [
  { path: '/llms.txt', title: 'Short index', desc: 'What an app is, the rules, and links, in plain markdown.', href: '/llms.txt', cta: 'Open' },
  { path: '/llms-full.txt', title: 'Full reference', desc: 'Every block, computed value and hook, with complete examples and common mistakes. One paste.', href: '/llms-full.txt', cta: 'Open' },
  { path: 'pomodoso-plugin/SKILL.md', title: 'Agent skill', desc: 'For Claude Code and other agents: writes the file, checks it, fixes errors, and bumps the version.', href: SKILL_URL, cta: 'Get the skill' },
  { path: '/schema/plugin.v1.json', title: 'JSON Schema', desc: 'Autocomplete in your editor. Models can check their output against it.', href: '/schema/plugin.v1.json', cta: 'Open' },
];

const TODAY_EXAMPLE = `today:
  default_on: true          # suggested; the user can turn it off
  widget:
    type: mini-counter
    label: Cigarettes
    value: $today
    max: $limit
    adds: cigarette         # the +1 button

hooks:
  - on: pomodoro_end
    ask: Did you smoke during this break?
    yes: { add: cigarette }
  - on: weekly_report
    line: "{$week_count} cigarettes ({$week_delta} vs last week)"`;

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18 } as const;
const dark = { background: '#1A1A17', color: '#EDEBE4', borderRadius: 12, padding: 18, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 } as const;

export default function BuildPage() {
  const [copied, setCopied] = useState<'prompt' | 'full' | null>(null);

  const copy = (what: 'prompt' | 'full') => {
    const text =
      what === 'prompt'
        ? Promise.resolve(STARTER_PROMPT)
        : fetch('/llms-full.txt').then((r) => r.text()).then((ref) => `${STARTER_PROMPT}\n\n---\n\n${ref}`);
    void text
      .then((t) => navigator.clipboard.writeText(t))
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied(null), 1500);
      });
  };

  return (
    <div className="pomo-site">
      <Seo
        title="Build a Pomodoso app with an AI assistant"
        description="Point ChatGPT, Claude or your agent at Pomodoso's reference and describe what you want to track. Get a working app file, checked before it installs."
        path="/apps/build"
      />
      <SiteHeader current="build" />

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 64px', display: 'flex', flexDirection: 'column', gap: 36 }}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#A8432D' }}>BUILD AN APP</span>
          <h1 style={{ margin: 0, fontSize: 'clamp(1.9rem, 4.5vw, 2.25rem)', letterSpacing: '-0.02em' }}>Build with an AI assistant</h1>
          <p style={{ margin: 0, color: '#44423C', maxWidth: 680 }}>
            Most apps get written by an assistant. Point yours at these files and describe what you want to track. Each one covers the whole format, so the model doesn't have to guess.
          </p>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {FILES.map((f) => (
            <div key={f.path} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <code style={{ alignSelf: 'flex-start', color: '#A8432D' }}>{f.path}</code>
              <span style={{ fontWeight: 600 }}>{f.title}</span>
              <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{f.desc}</span>
              <a href={f.href} style={{ fontSize: 14, marginTop: 'auto' }} {...(f.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>{f.cta}</a>
            </div>
          ))}
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Starter prompt</h2>
          <pre style={dark}>{STARTER_PROMPT}</pre>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="pomo-site-btn pomo-site-btn-primary" style={{ height: 40 }} onClick={() => copy('prompt')}>{copied === 'prompt' ? 'Copied' : 'Copy prompt'}</button>
            <button type="button" className="pomo-site-btn pomo-site-btn-secondary" style={{ height: 40 }} onClick={() => copy('full')}>{copied === 'full' ? 'Copied' : 'Copy prompt + full reference'}</button>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
            "Prompt + full reference" is for assistants that can't open links: it pastes the whole reference with the prompt.
          </p>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>The Today widget is opt-in, declared in the file</h2>
          <p style={{ margin: 0, color: '#44423C' }}>
            An app always gets its own screen under Apps. It can only appear on Today if its file has a <code>today</code> block, and even then the user chooses whether to turn it on. Hooks add a question during breaks or the next day, and lines to the reports.
          </p>
          <pre style={{ ...card, margin: 0, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7, overflowX: 'auto' }}>{TODAY_EXAMPLE}</pre>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Check it, then install or publish</h2>
          <p style={{ margin: 0, color: '#44423C' }}>
            Paste the file into Pomodoso: in the extension, Apps → Add an app → From a file, or in your <Link to="/dashboard/apps">dashboard → Apps</Link> to publish it. Both run the same checks as the directory, say exactly what to fix, and show the app before anything is saved.
          </p>
        </section>
      </main>
    </div>
  );
}
