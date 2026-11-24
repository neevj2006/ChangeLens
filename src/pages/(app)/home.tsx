import { useEffect, useState, type FormEvent } from 'react'
import { useAuthStatus } from 'deepspace'
import { callAction } from '../../changelens/client'
import type { Check, Evidence, Watch, WatchInput } from '../../changelens/contract'

const initial: WatchInput = { vendor: '', url: '', plan: '', seats: 10, currency: 'USD', cadence: 'month' }
const button = 'rounded-md border border-border px-3 py-2 font-medium hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50'
const field = 'block w-full rounded-md border border-border bg-background px-3 py-2'
const card = 'min-w-0 space-y-3 rounded-xl border border-border bg-card p-4'
const outcome: Record<Check['outcome'], string> = {
  baseline_ready: 'Baseline ready', changed: 'Price changed', unchanged: 'Unchanged',
  cosmetic: 'Formatting changed', needs_review: 'Needs review', failed: 'Check failed',
}
const alerts: Record<Check['alert']['state'], string> = {
  not_applicable: 'No alert needed', pending: 'Sending', accepted: 'Accepted by email provider',
  failed: 'Delivery failed', unknown: 'Delivery unknown. Check your inbox.', disabled: 'Email unavailable',
}
const date = (value: string) => new Date(value).toLocaleString()
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100)

export default function HomePage() {
  const { isSignedIn, userId } = useAuthStatus()
  return isSignedIn ? <Workspace key={userId} /> : (
    <section className="mx-auto max-w-3xl space-y-3 px-4 py-14">
      <h1 className="text-4xl font-bold">ChangeLens</h1>
      <p>Track a vendor’s listed price and see what a change costs your team.</p>
      <p>Use Sign in in the navigation to create a private watch.</p>
    </section>
  )
}

function Workspace() {
  const [watches, setWatches] = useState<Watch[]>([])
  const [selected, setSelected] = useState<Watch | null>(null)
  const [form, setForm] = useState(false)
  const [checks, setChecks] = useState<Check[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [report, setReport] = useState<Check | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    callAction('listWatches', {}).then(rows => {
      if (active) setWatches(rows)
    }).catch((reason: unknown) => {
      if (active) setError(String(reason instanceof Error ? reason.message : reason))
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])

  async function run(task: () => Promise<void>) {
    setError('')
    setBusy(true)
    try { await task() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The request failed.') }
    finally { setBusy(false) }
  }

  async function show(watch: Watch) {
    setSelected(watch)
    setWatches(rows => rows.some(row => row.id === watch.id)
      ? rows.map(row => row.id === watch.id ? watch : row) : [...rows, watch])
    setChecks([])
    setCursor(null)
    setReport(watch.latest)
    const page = await callAction('listChecks', { id: watch.id })
    setChecks(page.checks)
    setCursor(page.nextBefore)
  }

  const key = selected && { id: selected.id, revision: selected.revision }
  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8" aria-busy={busy}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-bold">ChangeLens</h1>
          <p className="text-muted-foreground">Track listed prices and see the impact at your seat count.</p></div>
        <button className={primary} disabled={busy} onClick={() => { setSelected(null); setForm(true); setError('') }}>Add watch</button>
      </header>
      {busy && <p role="status">Working…</p>}
      {error && <p role="alert" className="rounded-md border border-destructive p-3">{error}</p>}
      <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className={card}>
          <h2 className="text-lg font-semibold">Watches</h2>
          {!watches.length && !busy && <p>No watches yet.</p>}
          <ul className="space-y-2">{watches.map(watch => <li key={watch.id}>
            <button className={button + ' w-full text-left break-words'} disabled={busy} aria-pressed={selected?.id === watch.id}
              onClick={() => { setForm(false); void run(async () => show(await callAction('getWatch', { id: watch.id }))) }}>
              <span className="block">{watch.vendor} · {watch.plan}</span>
              <span className="block text-sm">{watch.seats} seats · {watch.status}</span>
              {watch.latest && <span className="block text-sm">{outcome[watch.latest.outcome]} · {date(watch.latest.checkedAt)}</span>}
            </button>
          </li>)}</ul>
        </aside>
        <div className="min-w-0 space-y-4">
          {form && <WatchForm key={selected?.id ?? 'new'} watch={selected} busy={busy}
            close={() => setForm(false)} submit={input => run(async () => {
              const saved = key ? await callAction('updateWatch', { ...input, ...key }) : await callAction('createWatch', input)
              setForm(false)
              await show(saved)
            })} />}
          {selected && key && <>
            <section className={card}>
              <h2 className="break-words text-xl font-semibold">{selected.vendor} · {selected.plan}</h2>
              <p>{selected.currency} per {selected.cadence} · {selected.seats} seats · {selected.status}</p>
              <a className="break-all underline" href={selected.url} target="_blank" rel="noreferrer">Open pricing page</a>
              <div className="flex flex-wrap gap-2">
                <button className={primary} disabled={busy || selected.status !== 'armed'} onClick={() => void run(async () => show(await callAction('checkWatch', key)))}>Check now</button>
                <button className={button} disabled={busy} onClick={() => void run(async () => show(await callAction('captureBaseline', key)))}>{selected.baseline ? 'Capture new baseline' : 'Capture baseline'}</button>
                <button className={button} disabled={busy} onClick={() => setForm(true)}>Edit watch</button>
                <button className={button} disabled={busy} onClick={() => void run(async () => show(await callAction('setWatchPaused', { ...key, paused: selected.status !== 'paused' })))}>{selected.status === 'paused' ? 'Resume' : 'Pause'}</button>
                <button className={button} disabled={busy} onClick={() => void run(async () => {
                  if (!window.confirm('Remove this watch and its history?')) return
                  await callAction('removeWatch', key)
                  setWatches(rows => rows.filter(row => row.id !== key.id))
                  setSelected(null)
                  setForm(false)
                })}>Remove</button>
              </div>
            </section>
            {selected.baseline && <EvidenceCard heading="Confirmed baseline" evidence={selected.baseline} />}
            {selected.candidate && <section className={card}>
              <EvidenceCard heading="Review baseline" evidence={selected.candidate} />
              <button className={primary} disabled={busy} onClick={() => void run(async () => show(await callAction('confirmBaseline', {
                ...key, snapshotId: selected.candidate!.snapshotId,
              })))}>Confirm baseline and arm</button>
            </section>}
            {report && <Report check={report} refresh={() => run(async () =>
              setReport(await callAction('getCheck', { id: key.id, checkId: report.id })))} busy={busy} />}
            <section className={card}>
              <h2 className="text-lg font-semibold">Check history</h2>
              {!checks.length && <p>No checks recorded.</p>}
              <ul className="space-y-2">{checks.map(check => <li key={check.id}>
                <button className={button + ' w-full text-left'} disabled={busy} aria-pressed={report?.id === check.id}
                  onClick={() => void run(async () => setReport(await callAction('getCheck', { id: key.id, checkId: check.id })))}>
                  {outcome[check.outcome]} · {date(check.checkedAt)}
                </button>
              </li>)}</ul>
              {cursor && <button className={button} disabled={busy} onClick={() => void run(async () => {
                const page = await callAction('listChecks', { id: key.id, before: cursor })
                setChecks(rows => [...rows, ...page.checks])
                setCursor(page.nextBefore)
              })}>Load older checks</button>}
            </section>
          </>}
        </div>
      </div>
    </section>
  )
}

function WatchForm({ watch, busy, close, submit }: {
  watch: Watch | null; busy: boolean; close: () => void; submit: (input: WatchInput) => Promise<void>
}) {
  const values = watch ?? initial
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const inputs = new FormData(event.currentTarget)
    void submit({
      vendor: String(inputs.get('vendor')), url: String(inputs.get('url')), plan: String(inputs.get('plan')),
      seats: Number(inputs.get('seats')), currency: inputs.get('currency') as WatchInput['currency'],
      cadence: inputs.get('cadence') as WatchInput['cadence'],
    })
  }
  return <form className={card} onSubmit={save}>
    <h2 className="text-lg font-semibold">{watch ? 'Edit watch' : 'Add a watch'}</h2>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label>Vendor<input className={field} name="vendor" defaultValue={values.vendor} maxLength={100} required /></label>
      <label>Pricing URL<input className={field} name="url" type="url" defaultValue={values.url} maxLength={500} required /></label>
      <label>Plan<input className={field} name="plan" defaultValue={values.plan} maxLength={100} required /></label>
      <label>Seats<input className={field} name="seats" type="number" defaultValue={values.seats} min={1} max={100000} step={1} required /></label>
      <label>Currency<select className={field} name="currency" defaultValue={values.currency}>
        {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(currency => <option key={currency}>{currency}</option>)}
      </select></label>
      <label>Billing period<select className={field} name="cadence" defaultValue={values.cadence}>
        <option value="month">Monthly</option><option value="year">Annual</option>
      </select></label>
    </fieldset>
    <div className="flex gap-2"><button className={primary} disabled={busy}>Save watch</button>
      <button className={button} disabled={busy} type="button" onClick={close}>Cancel</button></div>
  </form>
}

function EvidenceCard({ heading, evidence }: { heading: string; evidence: Evidence }) {
  return <section className={card}>
    <h3 className="font-semibold">{heading}</h3>
    <p>{evidence.plan} · {money(evidence.priceMinor, evidence.currency)} per seat per {evidence.cadence}</p>
    <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">{evidence.excerpt}</blockquote>
    <p className="text-sm"><a className="underline" href={evidence.sourceUrl} target="_blank" rel="noreferrer">Pricing source</a> · {date(evidence.capturedAt)}</p>
  </section>
}

function Report({ check, refresh, busy }: { check: Check; refresh: () => Promise<void>; busy: boolean }) {
  const { impact, context } = check
  return <section className={card} aria-label="Check report">
    <h2 className="text-lg font-semibold">{outcome[check.outcome]}</h2><p>{check.message}</p>
    {impact ? <>
      <p className="text-xl font-semibold">{money(impact.oldTotalMinor, impact.old.currency)} → {money(impact.newTotalMinor, impact.current.currency)}</p>
      <p className="font-semibold">{impact.deltaMinor > 0 ? '+' : ''}{money(impact.deltaMinor, impact.current.currency)}/{impact.current.cadence} for {impact.seats} seats</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <EvidenceCard heading="Previous price" evidence={impact.old} />
        <EvidenceCard heading="Current price" evidence={impact.current} />
      </div>
      {impact.assumptions.map(text => <p key={text}>{text}</p>)}
      <p>Email alert · {alerts[check.alert.state]}</p>
      {context.state === 'pending' && <p>Looking for context…</p>}
      {context.state === 'empty' && <p>No relevant context found</p>}
      {context.state === 'failed' && <p>Context lookup did not complete.</p>}
      {context.state === 'found' && <ul className="list-disc pl-5">{context.sources.map(source => <li key={source.url}>
        <a className="break-words underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
        {source.publishedAt && ' · ' + date(source.publishedAt)}
      </li>)}</ul>}
    </> : check.evidence && <EvidenceCard heading="Pricing evidence" evidence={check.evidence} />}
    {check.snapshot && <details><summary>Captured page text</summary><pre className="whitespace-pre-wrap break-words">{check.snapshot.markdown}</pre></details>}
    <button className={button} disabled={busy} onClick={() => void refresh()}>Refresh report</button>
  </section>
}
