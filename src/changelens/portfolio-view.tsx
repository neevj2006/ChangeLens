import { ExternalLink } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { callAction } from './client'
import type { Cadence, Comparison, Currency, Portfolio, Watch } from './contract'
import { MAX_SEATS, money } from './report'
import { action, control, CurrencyInput, panel, PeriodInput } from './watch-settings'

type Run = (task: () => Promise<void>) => Promise<void>
const date = (value: string) => new Date(value).toLocaleString()
const signed = (value: number, currency: Currency) => (value > 0 ? '+' : '') + money(value, currency)
const section = 'space-y-2 border-t border-border pt-3'

export function PortfolioView({ busy, run, open }: {
  busy: boolean; run: Run; open: (watchId: string, checkId?: string) => void
}) {
  const [portfolio, setPortfolio] = useState<Portfolio>()
  const [days, setDays] = useState('30')
  return <section className={panel} aria-label="Portfolio">
    <h2 className="text-xl font-semibold">Portfolio</h2>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault()
      void run(async () => setPortfolio(await callAction('getPortfolio', { windowDays: Number(days) })))
    }}>
      <label>Change window (days)<input className={control} type="number" min={1} max={365} value={days}
        onChange={event => setDays(event.target.value)} required /></label>
      <button className={action} disabled={busy}>{portfolio ? 'Refresh portfolio' : 'Load portfolio'}</button>
    </form>
    {portfolio && <div className="grid gap-4 lg:grid-cols-2">
      <div className={section}>
        <h3 className="font-semibold">Listed cost impacts</h3>
        {!portfolio.totals.length && <p>No comparable changes in the selected window.</p>}
        <ul className="space-y-2">{portfolio.totals.map(group => <li key={group.currency + group.cadence}>
          {group.currency} · {signed(group.deltaMinor, group.currency)}/{group.cadence} across {group.watchCount} {group.watchCount === 1 ? 'watch' : 'watches'}
        </li>)}</ul>
        {!!portfolio.excluded.length && <details><summary>{portfolio.excluded.length} excluded from totals</summary>
          <ul className="space-y-2">{portfolio.excluded.map(item => <li key={item.watchId}>{item.reason}
            {' '}<button className="cl-link" onClick={() => open(item.watchId)}>Open excluded watch</button>
          </li>)}</ul>
        </details>}
      </div>
      <div className={section}>
        <h3 className="font-semibold">Recent price changes</h3>
        {!portfolio.changes.length && <p>No verified price changes in this window.</p>}
        <ul className="space-y-2">{portfolio.changes.map(item => <li key={item.checkId}>
          <button className="cl-link" onClick={() => open(item.watchId, item.checkId)}>{item.vendor} report</button>
          {' · '}{signed(item.impact.deltaMinor, item.impact.current.currency)}/{item.impact.current.cadence}
          {' · '}<time dateTime={item.checkedAt}>{date(item.checkedAt)}</time>
        </li>)}</ul>
      </div>
      <div className={section}>
        <h3 className="font-semibold">Upcoming renewals</h3>
        {!portfolio.renewals.length && <p>No upcoming notice deadlines.</p>}
        <ul className="space-y-2">{portfolio.renewals.map(item => <li key={item.watchId}>
          <button className="cl-link" onClick={() => open(item.watchId)}>{item.vendor}</button>
          <p>Notice by {item.noticeDate} · renews {item.renewalDate}</p>
        </li>)}</ul>
      </div>
      <div className={section}>
        <h3 className="font-semibold">Needs attention</h3>
        {!portfolio.attention.length && <p>No watches need attention.</p>}
        <ul className="space-y-2">{portfolio.attention.map(item => <li key={item.watchId}>
          <button className="cl-link" onClick={() => open(item.watchId, item.checkId ?? undefined)}>{item.vendor}</button>
          <p>{item.reason}{item.at ? ' · ' + date(item.at) : ''}</p>
        </li>)}</ul>
      </div>
    </div>}
  </section>
}

export function ComparisonView({ watches, busy, run }: { watches: Watch[]; busy: boolean; run: Run }) {
  const [comparison, setComparison] = useState<Comparison>()
  const [ids, setIds] = useState<string[]>([])
  const available = ids.filter(id => watches.some(watch => watch.id === id))
  const start = watches[0]
  function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const features = [...new Set(String(values.get('features')).split('\n').map(feature => feature.trim()).filter(Boolean))]
    void run(async () => setComparison(await callAction('compareWatches', {
      ids: available, seats: Number(values.get('seats')),
      currency: values.get('currency') as Currency, cadence: values.get('cadence') as Cadence, features,
    })))
  }
  return <section className={panel} aria-label="Compare plans">
    <h2 className="text-xl font-semibold">Compare plans</h2>
    {watches.length < 2 ? <p>Add at least two watches to compare plans.</p> : <form className="space-y-3" onSubmit={compare}>
      <fieldset disabled={busy} className="space-y-2">
        <legend>Choose 2 to 8 watches</legend>
        <div className="grid gap-2 sm:grid-cols-2">{watches.map(watch => <label key={watch.id}>
          <input type="checkbox" checked={available.includes(watch.id)}
            disabled={!available.includes(watch.id) && available.length === 8}
            onChange={event => setIds(event.target.checked ? [...available, watch.id] : available.filter(id => id !== watch.id))} />
          {' '}{watch.vendor} · {watch.plan}
        </label>)}</div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>Comparison seats<input className={control} name="seats" type="number" min={1} max={MAX_SEATS} defaultValue={start.seats} required /></label>
        <CurrencyInput currency={start.currency} />
        <PeriodInput cadence={start.cadence} />
      </div>
      <label>Must-have features (one per line)<textarea className={control} name="features" maxLength={2019} rows={3} /></label>
      <div className="pt-3"><button className={action} disabled={busy || available.length < 2}>Compare selected watches</button></div>
    </form>}
    {comparison && <div className="space-y-3">
      <h3 className="font-semibold">Listed prices at {comparison.seats} seats · {comparison.currency} per {comparison.cadence}</h3>
      <div className="grid gap-3 md:grid-cols-2">{comparison.options.map(option => <article className={panel} key={option.id}>
        <h4 className="font-semibold">{option.vendor} · {option.plan}</h4>
        <p>{option.totalMinor === null ? option.reason : money(option.totalMinor, comparison.currency) + '/' + comparison.cadence}</p>
        {option.evidence && <p><a className="cl-link" href={option.evidence.sourceUrl} target="_blank" rel="noreferrer">Pricing evidence<ExternalLink aria-hidden="true" /></a>
          {' · '}{date(option.evidence.capturedAt)}{option.stale ? ' · Older than 30 days' : ''}</p>}
        <ul className="space-y-1">{option.features.map(feature => <li key={feature.feature}>{feature.feature} · {feature.state}
          {feature.excerpt && <blockquote className="whitespace-pre-wrap [overflow-wrap:anywhere]">{feature.excerpt}</blockquote>}
        </li>)}</ul>
      </article>)}</div>
    </div>}
  </section>
}
