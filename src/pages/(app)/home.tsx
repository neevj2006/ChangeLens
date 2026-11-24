import { Activity, ExternalLink, Plus } from 'lucide-react'
import '../../changelens/design.css'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuthStatus } from 'deepspace'
import { formatSummary, MAX_SEATS, money, totalsAtSeats } from '../../changelens/report'
import { ComparisonView, PortfolioView } from '../../changelens/portfolio-view'
import { ReportFindings, WatchSettings } from '../../changelens/watch-settings'
import { callAction } from '../../changelens/client'
import type { Capabilities, Check, Evidence, Impact, Watch, WatchInput } from '../../changelens/contract'

const initial: WatchInput = { vendor: '', url: '', plan: '', seats: 10, currency: 'USD', cadence: 'month' }
const button = 'rounded-md border border-border px-3 py-2 font-medium hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50'
const field = 'block w-full rounded-md border border-border bg-background px-3 py-2'
const card = 'cl-panel space-y-3'
const outcome: Record<Check['outcome'], string> = {
  baseline_ready: 'Baseline ready', changed: 'Price changed', unchanged: 'Unchanged',
  cosmetic: 'Formatting changed', needs_review: 'Needs review', failed: 'Check failed',
}
const alerts: Record<Check['alert']['state'], string> = {
  not_applicable: 'No alert needed', pending: 'Sending', accepted: 'Accepted by email provider',
  failed: 'Delivery failed', unknown: 'Delivery unknown. Check your inbox.', disabled: 'Email unavailable',
}
const date = (value: string) => new Date(value).toLocaleString()

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
  const [capabilities, setCapabilities] = useState<Capabilities>()
  const [selected, setSelected] = useState<Watch | null>(null)
  const [form, setForm] = useState(false)
  const [checks, setChecks] = useState<Check[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [report, setReport] = useState<Check | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    callAction('getCapabilities', {}).then(result => {
      if (active) setCapabilities(result)
    }).catch(() => undefined)
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
    <section className="cl-workspace mx-auto max-w-7xl space-y-7 px-4 py-8 sm:px-8 sm:py-10" aria-busy={busy}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-3"><h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Pricing workspace</h1>
          <p className="leading-relaxed text-muted-foreground">Track listed prices and see the impact at your seat count.</p></div>
        <button className={primary} disabled={busy} onClick={() => { setSelected(null); setForm(true); setError('') }}><span className="inline-flex items-center gap-2"><Plus size={17} aria-hidden="true" />Add watch</span></button>
      </header>
      {busy && <p role="status">Working…</p>}
      {error && <p role="alert" className="rounded-md border border-destructive p-3">{error}</p>}
      <div className={selected ? "grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]" : "grid gap-4"}>
        <aside className={card + ' self-start'}>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Activity size={17} aria-hidden="true" /> Watches <span className="ml-auto text-sm text-muted-foreground">{watches.length}</span></h2>
          {!watches.length && !busy && <p>No watches yet.</p>}
          <ul className={selected ? "grid gap-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}>{watches.map(watch => <li key={watch.id}>
            <button className={button + ' cl-watch h-full w-full break-words text-left'} disabled={busy} aria-pressed={selected?.id === watch.id}
              onClick={() => { setForm(false); void run(async () => show(await callAction('getWatch', { id: watch.id }))) }}>
              <span className="block">{watch.vendor} · {watch.plan}</span>
              <span className="block text-sm">{watch.seats} seats · {watch.status}</span>
              {watch.latest && <span className="block text-sm">{outcome[watch.latest.outcome]} · {date(watch.latest.checkedAt)}</span>}
            </button>
          </li>)}</ul>
        </aside>
        {(form || selected) && <div className="min-w-0 space-y-4">
          {form && capabilities?.vendorCapture === false && <p className={card}>Live capture is currently available for the demo pricing page.</p>}
          {form && <WatchForm key={selected?.id ?? 'new'} watch={selected} busy={busy}
            close={() => setForm(false)} submit={input => run(async () => {
              const saved = key ? await callAction('updateWatch', { ...input, ...key }) : await callAction('createWatch', input)
              setForm(false)
              await show(saved)
            })} />}
          {selected && key && <>
            <section className={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="break-words text-2xl font-semibold tracking-tight">{selected.vendor} · {selected.plan}</h2>
                <button type="button" className={button} onClick={() => { setSelected(null); setForm(false); setError('') }}>All watches</button>
              </div>
              <p>{selected.currency} per {selected.cadence} · {selected.seats} seats · {selected.status}</p>
              <a className="cl-link inline-block" href={selected.url} target="_blank" rel="noreferrer">Open pricing page <ExternalLink aria-hidden="true" /></a>
              <div className="flex flex-wrap gap-2 pt-2">
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
            <WatchSettings key={selected.id} watch={selected} busy={busy} capabilities={capabilities} save={request => void run(async () => show(await request()))} />
            {selected.baseline && <EvidenceCard watchId={selected.id} heading="Confirmed baseline" evidence={selected.baseline} />}
            {selected.candidate && <section className={card}>
              <EvidenceCard watchId={selected.id} heading="Review baseline" evidence={selected.candidate} />
              <button className={primary} disabled={busy} onClick={() => void run(async () => show(await callAction('confirmBaseline', {
                ...key, snapshotId: selected.candidate!.snapshotId,
              })))}>Confirm baseline and arm</button>
            </section>}
            {report && <Report key={report.id} check={report} refresh={() => run(async () =>
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
        </div>}
      </div>
      <PortfolioView busy={busy} run={run} open={(id, checkId) => void run(async () => {
        setForm(false)
        await show(await callAction('getWatch', { id }))
        if (checkId) setReport(await callAction('getCheck', { id, checkId }))
        document.querySelector('h1')?.scrollIntoView({ block: 'start' })
      })} />
      <ComparisonView watches={watches} busy={busy} run={run} />
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
      <label>Seats<input className={field} name="seats" type="number" defaultValue={values.seats} min={1} max={MAX_SEATS} step={1} required /></label>
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

function EvidenceCard({ heading, evidence, watchId }: { heading: string; evidence: Evidence; watchId: string }) {
  const [image, setImage] = useState<{ id: string; src: string }>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const currentImage = image?.id === evidence.snapshotId ? image : undefined
  async function showScreenshot() {
    setLoading(true)
    setError(false)
    try {
      const data = await callAction('getScreenshot', { id: watchId, snapshotId: evidence.snapshotId })
      setImage({ id: evidence.snapshotId, src: 'data:' + data.type + ';base64,' + data.base64 })
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }
  return <section className={card}>
    <h3 className="font-semibold">{heading}</h3>
    <p>{evidence.plan} · {money(evidence.priceMinor, evidence.currency)} per seat per {evidence.cadence}</p>
    <blockquote className="whitespace-pre-wrap [overflow-wrap:anywhere] border-l-2 border-border pl-3">{evidence.excerpt}</blockquote>
    <p className="text-sm"><a className="cl-link" href={evidence.sourceUrl} target="_blank" rel="noreferrer">Pricing source<ExternalLink aria-hidden="true" /></a> · {date(evidence.capturedAt)}</p>
    {evidence.screenshot === 'available' ? <>
      <button className={button} disabled={loading} aria-expanded={!!currentImage}
        onClick={() => currentImage ? setImage(undefined) : void showScreenshot()}>
        {loading ? 'Loading screenshot…' : currentImage ? 'Hide screenshot' : 'Show screenshot'}
      </button>
      {error && <p role="alert">Screenshot could not be loaded.</p>}
      {currentImage && <img className="h-auto max-w-full rounded-md" src={currentImage.src}
        alt={'Pricing page captured for ' + evidence.plan + ' on ' + date(evidence.capturedAt)} />}
    </> : <p className="text-sm text-muted-foreground">Screenshot unavailable for this capture.</p>}
  </section>
}

function Report({ check, refresh, busy }: { check: Check; refresh: () => Promise<void>; busy: boolean }) {
  const { impact, context } = check
  return <section className={card + ' cl-report'} aria-label="Check report">
    <h2 className="text-lg font-semibold">{outcome[check.outcome]}</h2><p>{check.message}</p>
    {impact ? <>
      <div className="cl-impact space-y-2 p-4 sm:p-5"><p className="text-2xl font-semibold tracking-tight sm:text-4xl">{money(impact.oldTotalMinor, impact.old.currency)} → {money(impact.newTotalMinor, impact.current.currency)}</p>
      <p className="font-semibold">{impact.deltaMinor > 0 ? '+' : ''}{money(impact.deltaMinor, impact.current.currency)}/{impact.current.cadence} for {impact.seats} seats</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <EvidenceCard watchId={check.watchId} heading="Previous price" evidence={impact.old} />
        <EvidenceCard watchId={check.watchId} heading="Current price" evidence={impact.current} />
      </div>
      {impact.assumptions.map(text => <p key={text}>{text}</p>)}
      <ImpactTools impact={impact} vendor={check.vendor} />
      <p>Email alert · {alerts[check.alert.state]}</p>
      {context.state === 'pending' && <p>Looking for context…</p>}
      {context.state === 'empty' && <p>No relevant context found</p>}
      {context.state === 'failed' && <p>Context lookup did not complete.</p>}
      {context.state === 'found' && <ul className="list-disc pl-5">{context.sources.map(source => <li key={source.url}>
        <a className="cl-link" href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink aria-hidden="true" /></a>
        {source.publishedAt && ' · ' + date(source.publishedAt)}
      </li>)}</ul>}
    </> : check.evidence && <EvidenceCard watchId={check.watchId} heading="Pricing evidence" evidence={check.evidence} />}
    <ReportFindings check={check} />
    {check.snapshot && <details><summary>Captured page text</summary><pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">{check.snapshot.markdown}</pre></details>}
    <button className={button} disabled={busy} onClick={() => void refresh()}>Refresh report</button>
  </section>
}



function ImpactTools({ impact, vendor }: { impact: Impact; vendor?: string }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const [input, setInput] = useState(String(impact.seats))
  const seats = Number(input)
  const valid = /^\d+$/.test(input) && Number.isSafeInteger(seats) && seats >= 1 && seats <= MAX_SEATS
  const totals = valid ? totalsAtSeats(impact.old.priceMinor, impact.current.priceMinor, seats) : null
  const summary = formatSummary(impact, vendor)
  const amount = (value: number) => money(value, impact.current.currency)

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary)
      setCopy('copied')
    } catch {
      setCopy('fallback')
    }
  }

  return <div className="space-y-3">
    <button className={button} onClick={() => void copySummary()}>Copy summary</button>
    {copy === 'copied' && <p role="status">Impact summary copied.</p>}
    {copy === 'fallback' && <label className="block">
      Copy the summary below
      <textarea className={field} readOnly value={summary} rows={6} onFocus={event => event.target.select()} />
    </label>}
    <section className={card} aria-label="Seat-count calculator">
      <h3 className="font-semibold">Seat-count calculator</h3>
      <label>Hypothetical seats
        <input className={field} type="number" inputMode="numeric" min={1} max={MAX_SEATS}
          step={1} value={input} onChange={event => setInput(event.target.value)} aria-invalid={!valid} />
      </label>
      {totals ? <output className="block">
        {amount(totals.oldTotalMinor)} → {amount(totals.newTotalMinor)}
        {' · '}{totals.deltaMinor > 0 ? '+' : ''}{amount(totals.deltaMinor)}/{impact.current.cadence}
      </output> : <p role="status">Enter a whole seat count from 1 to {MAX_SEATS.toLocaleString()}.</p>}
    </section>
  </div>
}
