import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BLOCK_DOCS,
  BLOCK_TYPES,
  BUILTIN_REFS,
  COLLECTION_DOCS,
  COLLECTION_KINDS,
  COMPUTED_DOCS,
  COMPUTED_OPS,
  FIELD_DOCS,
  FIELD_TYPES,
  FORMAT_DOCS,
  GUIDE_BLOCK_EXAMPLES,
  GUIDE_COMPUTED_EXAMPLES,
  GUIDE_FIRST_APP,
  GUIDE_HOOK_EXAMPLES,
  GUIDE_PLAYGROUND,
  GUIDE_WIDGET_EXAMPLES,
  HOOK_DOCS,
  HOOK_EVENTS,
  NAMED_RANGES,
  PLUGIN_FILE_MAX_BYTES,
  PLUGIN_JSON_SCHEMA_URL,
  STAT_FORMATS,
  TODAY_WIDGET_TYPES,
  TOP_LEVEL_DOCS,
  WIDGET_DOCS,
  guideManifestData,
  guideSeedRecords,
  localDayOf,
  validatePluginData,
  type PluginRecord,
} from '@pomodoso/types/plugins';
import { Seo } from '../../seo.tsx';
import { AppChecker } from './AppChecker.tsx';
import { LivePreview } from './LivePreview.tsx';
import { SiteHeader } from './SiteHeader.tsx';

// /apps/docs: the format explained for people writing an app by hand. The
// descriptions come from docs.ts and the examples from guide.ts (both typed
// over the catalog), so a new block, widget, hook or operator can't ship
// without its section here. Every example renders live on a small
// playground app with sample data; previews mount on the client only.

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18 } as const;
const code = { ...card, margin: 0, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.65, overflowX: 'auto', whiteSpace: 'pre' } as const;
const dark = { background: '#1A1A17', color: '#EDEBE4', borderRadius: 12, padding: 18, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 } as const;
const muted = { margin: 0, color: '#44423C' } as const;

const TOC = [
  ['what', 'What an app is'],
  ['first-app', 'Your first app'],
  ['file', 'The file'],
  ['collections', 'Collections and fields'],
  ['values', 'Settings and values'],
  ['computed', 'Computed values'],
  ['blocks', 'Blocks'],
  ['today', 'Today widget'],
  ['hooks', 'Hooks'],
  ['rules', 'Rules'],
  ['formats', 'Stat formats'],
  ['updates', 'Updating an app'],
  ['publish', 'Check, install, publish'],
] as const;

const md = (s: string): ReactNode[] =>
  // `code` spans in the catalog descriptions.
  s.split(/(`[^`]+`)/).map((part, i) => (part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part));

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function useSeed(): PluginRecord[] {
  return useMemo(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return guideSeedRecords(localDayOf(new Date().toISOString(), tz));
  }, []);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} style={{ display: 'flex', flexDirection: 'column', gap: 12, scrollMarginTop: 24 }}>
      <h2 style={{ margin: 0, fontSize: 22, letterSpacing: '-0.01em' }}>{title}</h2>
      {children}
    </section>
  );
}

function Table({ rows, head }: { rows: [string, string][]; head: [string, string] }) {
  return (
    <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '9px 14px', borderTop: '1px solid var(--color-border)', verticalAlign: 'top', whiteSpace: 'nowrap' }}><code>{k}</code></td>
              <td style={{ padding: '9px 14px', borderTop: '1px solid var(--color-border)', color: '#44423C' }}>{md(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One catalog entry: what it does, its snippet, and the snippet running on the playground. */
function Example({ id, name, doc, yaml, part, seed }: { id: string; name: string; doc: string; yaml: string; part: Parameters<typeof guideManifestData>[0]; seed: PluginRecord[] }) {
  const mounted = useMounted();
  const manifest = useMemo(() => {
    const r = validatePluginData(guideManifestData(part));
    return r.ok ? r.manifest : null;
    // `part` is built from constant strings on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yaml]);
  return (
    <div id={id} style={{ display: 'flex', flexDirection: 'column', gap: 8, scrollMarginTop: 24 }}>
      <h3 style={{ margin: 0, fontSize: 17 }}><code style={{ fontSize: '0.95em' }}>{name}</code></h3>
      <p style={muted}>{md(doc)}</p>
      <pre style={code}>{yaml}</pre>
      {mounted && manifest ? <LivePreview manifest={manifest} initialRecords={seed} /> : null}
    </div>
  );
}

export default function DocsPage() {
  const seed = useSeed();

  return (
    <div className="pomo-site">
      <Seo
        title="Pomodoso app docs: build an app by hand"
        description="How a Pomodoso app file works: collections, computed values, blocks, the Today widget and hooks, with a live example of each."
        path="/apps/docs"
      />
      <SiteHeader current="docs" />

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 80px', display: 'flex', flexDirection: 'column', gap: 44 }}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#A8432D' }}>APP DOCS</span>
          <h1 style={{ margin: 0, fontSize: 'clamp(1.9rem, 4.5vw, 2.25rem)', letterSpacing: '-0.02em' }}>Build an app by hand</h1>
          <p style={{ ...muted, maxWidth: 680 }}>
            Everything a Pomodoso app file can say, with a working example of each piece. Prefer to describe it and let a model write it? See <Link to="/apps/build">Build with an AI assistant</Link>.
          </p>
          <nav aria-label="On this page" style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px 18px', fontSize: 14, marginTop: 8 }}>
            {TOC.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
          </nav>
        </section>

        <Section id="what" title="What an app is">
          <p style={muted}>
            An app is one YAML file. Pomodoso reads it and builds a small app from it: its own screen under Apps, the records it keeps, and, if you want, a widget on Today, a question after pomodoros and a line in your reports.
          </p>
          <p style={muted}>
            The file is configuration, not code. It picks from a fixed set of building blocks (the ones on this page) and Pomodoso draws them. It can't run scripts, load anything from the internet or read your other data. That's what lets anyone install an app from the directory without worrying about it. If something isn't on this page, the format can't do it yet.
          </p>
          <p style={muted}>A file has three main parts:</p>
          <ul style={{ ...muted, paddingLeft: 20, lineHeight: 1.7, listStyle: 'disc' }}>
            <li><b>Collections</b>: what you store (glasses of water, books, a mood per day).</li>
            <li><b>Computed values</b>: numbers worked out from those records (glasses today, days in a row on goal).</li>
            <li><b>Views</b>: the screens, each a list of blocks (a button, a progress bar, a chart) that show and add records.</li>
          </ul>
        </Section>

        <Section id="first-app" title="Your first app">
          <p style={muted}>A water tracker, start to finish. Read the steps, then edit the file below: it's checked as you type and the preview updates. To check a file of your own, use the <Link to="/apps/validate">validator</Link>.</p>
          <ol style={{ ...muted, paddingLeft: 20, lineHeight: 1.75, display: 'flex', flexDirection: 'column', gap: 6, listStyle: 'decimal' }}>
            <li><b>Name it.</b> <code>schema_version: 1</code>, an <code>id</code> in lower-kebab-case (it never changes), a <code>name</code> and a <code>version</code> like <code>1.0.0</code>.</li>
            <li><b>Add a setting</b> for what the user should choose on install: here, <code>goal</code>, glasses a day. Anywhere in the file, <code>$goal</code> reads it.</li>
            <li><b>Declare a collection.</b> Each glass is an <code>event</code> (something that happens at a moment) with one field, <code>size</code>. It has a <code>default</code>, so a single tap can add a glass without a form.</li>
            <li><b>Compute what to show.</b> <code>today</code> counts today's glasses; <code>streak</code> counts days in a row with at least <code>$goal</code>.</li>
            <li><b>Build the screen.</b> A view is a list of blocks, top to bottom: a button that adds a glass, a progress bar, a stat and a chart.</li>
            <li><b>Optional extras.</b> A <code>today</code> widget (the user decides whether to show it), a question after each pomodoro, and a line in the daily report.</li>
          </ol>
          <AppChecker initial={GUIDE_FIRST_APP} seed={seed} />
        </Section>

        <Section id="file" title="The file">
          <p style={muted}>The top-level keys, in the order they usually appear. Only <code>schema_version</code>, <code>id</code>, <code>name</code>, <code>version</code>, <code>collections</code> and <code>views</code> are required. A file is at most {PLUGIN_FILE_MAX_BYTES / 1024} KB.</p>
          <Table head={['Key', 'What it is for']} rows={Object.entries(TOP_LEVEL_DOCS)} />
          <p style={muted}>
            Keys you name yourself (collections, fields, settings, computed values, views) are lower_snake_case: letters, numbers and <code>_</code>, starting with a letter, up to 40 characters. Unknown keys are errors, not ignored, so a typo never goes unnoticed.
          </p>
        </Section>

        <Section id="collections" title="Collections and fields">
          <p style={muted}>A collection is a kind of record your app keeps. Pick its <code>kind</code> by how the records behave:</p>
          <Table head={['Kind', 'Use it for']} rows={COLLECTION_KINDS.map((k) => [k, COLLECTION_DOCS[k]])} />
          <p style={muted}>
            Each collection has <code>fields</code>. Every field needs a <code>key</code> and a <code>type</code>; <code>label</code> is what the form shows (the key, humanized, by default). Fields are required unless you add <code>optional: true</code> or give them a <code>default</code>. Every record also has built-in fields you can sort and filter by without declaring them: <code>created_at</code>, <code>updated_at</code>, plus <code>occurred_at</code> on events and <code>day</code> on dailies. On an item, <code>title_field</code> says which field names the record. Forms for events also ask <b>When</b> (now by default), so one you forgot can be logged at the time it happened.
          </p>
          <Table head={['Field type', 'What it holds']} rows={FIELD_TYPES.map((t) => [t, FIELD_DOCS[t]])} />
          <p style={muted}>
            Select options are written as plain keys (<code>[water, tea, coffee]</code>, shown humanized) or as <code>{'{ value, label, color }'}</code> when you want a different label or a color (<code>"#2D8A7A"</code>) for boards and the year grid.
          </p>
        </Section>

        <Section id="values" title="Settings and values">
          <p style={muted}>
            <code>settings</code> are values the user fills in on install, like a starting limit or a goal. Each has a <code>key</code>, a <code>type</code> (number, text, boolean or select), a <code>label</code> and usually a <code>default</code>.
          </p>
          <p style={muted}>
            Wherever the file expects a value, write a number or a <code>$reference</code>: a setting, a computed value, or a built-in ({BUILTIN_REFS.map((r, i) => <span key={r}>{i > 0 ? ', ' : ''}<code>${r}</code></span>)}). <code>$tab.url</code>, <code>$tab.title</code> and <code>$tab.image</code> (the page's preview image, the one shown when you share a link) are the page open in the browser, and only work in an add-button's <code>prefill</code>: one tap saves the book, movie or article you're looking at. Inside text, labels and report lines, wrap it in braces: <code>{'"{$today} of {$goal} glasses"'}</code>.
          </p>
        </Section>

        <Section id="computed" title="Computed values">
          <p style={muted}>
            Under <code>computed</code>, each entry gets a name and exactly one operator. Read it with <code>$name</code>; entries can use each other, as long as they don't go in a circle.
          </p>
          <p style={muted}>
            <b>Ranges</b> pick a period: {NAMED_RANGES.map((r, i) => <span key={r}>{i > 0 ? ', ' : ''}<code>{r}</code></span>)}, or a rolling window like <code>14d</code> or <code>12mo</code>. <b>where</b> filters records by field: a value (<code>{'{ drink: tea }'}</code>), or <code>in</code>, <code>exists</code>, <code>lt</code>, <code>lte</code>, <code>gt</code>, <code>gte</code> (<code>{'{ size: { gte: 300 } }'}</code>). <b>group</b> (day, week or month) turns a count or sum into a series for charts.
          </p>
          {COMPUTED_OPS.map((op) => (
            <Example key={op} id={`computed-${op}`} name={op} doc={COMPUTED_DOCS[op]} yaml={GUIDE_COMPUTED_EXAMPLES[op]} part={{ computed: GUIDE_COMPUTED_EXAMPLES[op] }} seed={seed} />
          ))}
        </Section>

        <Section id="blocks" title="Blocks">
          <p style={muted}>
            <code>views</code> are the app's screens. Each has an <code>id</code>, an optional <code>label</code> (its tab name when there's more than one) and <code>blocks</code>, shown top to bottom.
          </p>
          <p style={muted}>
            The examples below run on a small playground app with sample data: water glasses (an event), books (items) and a mood per day. Try them: nothing is saved.
          </p>
          <details style={card}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>The playground's file</summary>
            <pre style={{ ...code, border: 'none', padding: '12px 0 0' }}>{GUIDE_PLAYGROUND}</pre>
          </details>
          {BLOCK_TYPES.map((b) => (
            <Example key={b} id={`block-${b}`} name={b} doc={BLOCK_DOCS[b]} yaml={GUIDE_BLOCK_EXAMPLES[b]} part={{ blocks: GUIDE_BLOCK_EXAMPLES[b] }} seed={seed} />
          ))}
        </Section>

        <Section id="today" title="Today widget">
          <p style={muted}>
            An app always has its own screen under Apps. It can also show one small widget on the Today tab, if its file has a <code>today</code> block, and only when the user turns it on. <code>default_on: true</code> suggests starting with it on.
          </p>
          {TODAY_WIDGET_TYPES.map((w) => (
            <Example key={w} id={`widget-${w}`} name={w} doc={WIDGET_DOCS[w]} yaml={GUIDE_WIDGET_EXAMPLES[w]} part={{ today: GUIDE_WIDGET_EXAMPLES[w] }} seed={seed} />
          ))}
        </Section>

        <Section id="hooks" title="Hooks">
          <p style={muted}>
            Hooks connect the app to the rest of Pomodoso: a question during the break after a pomodoro or the next morning, and lines in the daily and weekly reports. A question takes exactly one answer: <code>yes</code> (adds a record) or <code>pick</code> (sets a select on a daily record).
          </p>
          {HOOK_EVENTS.map((h) => (
            <Example key={h} id={`hook-${h}`} name={h} doc={HOOK_DOCS[h]} yaml={GUIDE_HOOK_EXAMPLES[h]} part={{ hooks: GUIDE_HOOK_EXAMPLES[h] }} seed={seed} />
          ))}
        </Section>

        <Section id="rules" title="Rules">
          <p style={muted}>
            A rule fills fields by itself when a record starts matching <code>when</code>. The usual one stamps a date: when a book becomes read, set <code>finished_on</code> to today. <code>only_if_empty: true</code> keeps a date the user already typed.
          </p>
          <pre style={code}>{`rules:
  - collection: book
    when: { status: read }
    set: { finished_on: $today_date }
    only_if_empty: true`}</pre>
        </Section>

        <Section id="formats" title="Stat formats">
          <p style={muted}>The <code>format</code> of a stat says how its value reads.</p>
          <Table head={['Format', 'Reads as']} rows={STAT_FORMATS.map((f) => [f, FORMAT_DOCS[f]])} />
        </Section>

        <Section id="updates" title="Updating an app">
          <p style={muted}>
            Bump <code>version</code> on every change. Adding things (a field, a block, a view) is a minor or patch version, and installed copies update without losing anything.
          </p>
          <p style={muted}>
            Renaming or removing a field, collection or option, or changing a field's type, would strand the records people already have. That's a breaking change: it needs a new major version and a <code>migrate</code> block that says how to carry the old records over. Pomodoso compares the new file with the published one and tells you when you need one.
          </p>
          <pre style={code}>{`version: 2.0.0
migrate:
  from: "1.x"
  steps:
    - rename_field: { collection: book, from: author, to: writer }
    - map_values: { collection: book, field: status, map: { to_read: wishlist } }`}</pre>
          <p style={muted}>
            Steps run in order: <code>rename_collection</code>, <code>rename_field</code>, <code>map_values</code> and <code>drop_field</code>. After a <code>rename_collection</code>, later steps use the new name. An app's <code>id</code> belongs to whoever published it first, so a copy of someone else's app needs a new <code>id</code>.
          </p>
        </Section>

        <Section id="publish" title="Check, install, publish">
          <p style={muted}>
            Paste the file into Pomodoso: in the extension, Apps → Add an app → From a file, or in your <Link to="/dashboard/apps">dashboard → Apps</Link> to publish it to the directory. Both run the same checks as the editor above, say exactly what to fix, and show the app before anything is saved.
          </p>
          <p style={muted}>
            To check any file without installing it, paste or upload it in the <Link to="/apps/validate">validator</Link> and try it there.
          </p>
          <p style={muted}>From a terminal, with the same validator:</p>
          <pre style={dark}>npx @pomodoso/plugin validate my-app.yaml</pre>
          <p style={muted}>
            For autocomplete and inline errors in your editor, point it at the JSON Schema: add <code># yaml-language-server: $schema={PLUGIN_JSON_SCHEMA_URL}</code> as the first line of the file (VS Code with the YAML extension).
          </p>
        </Section>
      </main>
    </div>
  );
}
