import type { FormEvent } from 'react'
import { callAction } from './client'
import type { Cadence, Check, Currency, Watch } from './contract'
import { money } from './report'

export const panel = 'min-w-0 space-y-3 rounded-xl border border-border bg-card p-4'
export const control = 'block w-full rounded-md border border-border bg-background px-3 py-2'
export const action = 'rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50'
const grid = 'grid gap-3 sm:grid-cols-2'
const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const
const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const formData = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault()
  return new FormData(event.currentTarget)
}
const minor = (raw: FormDataEntryValue | null) => Math.round(Number(raw) * 100)
const optionalNumber = (raw: FormDataEntryValue | null) => raw === null || raw === '' ? null : Number(raw)
const signedMoney = (value: number, currency: Currency) => (value > 0 ? '+' : '') + money(value, currency)

export function CurrencyInput({ currency }: { currency: Currency }) {
  return <label>Currency<select className={control} name="currency" defaultValue={currency}>
    {currencies.map(item => <option key={item}>{item}</option>)}
  </select></label>
}

export function PeriodInput({ cadence }: { cadence: Cadence }) {
  return <label>Billing period<select className={control} name="cadence" defaultValue={cadence}>
    <option value="month">Monthly</option><option value="year">Annual</option>
  </select></label>
}

export function WatchSettings({ watch, busy, save }: {
  watch: Watch; busy: boolean; save: (request: () => Promise<Watch>) => void
}) {
  const key = { id: watch.id, revision: watch.revision }
  const terms = watch.contract
  const schedule = watch.schedule
  const rule = watch.alertRule
  const gap = watch.contractGap
  return <section className={panel} aria-label="Watch settings">
    <h2 className="text-lg font-semibold">Watch settings</h2>
    <details>
      <summary className="cursor-pointer font-medium">Contract and renewal</summary>
      <form key={'contract-' + watch.revision} className="mt-3 space-y-3" onSubmit={event => {
        const values = formData(event)
        save(() => callAction('setContractTerms', { ...key, contract: {
          priceMinor: minor(values.get('rate')), currency: values.get('currency') as Currency,
          cadence: values.get('cadence') as Cadence, renewalDate: String(values.get('renewal')),
          noticeDate: String(values.get('notice')), timezone: String(values.get('timezone')).trim(),
          leadDays: optionalNumber(values.get('leadDays')),
        } }))
      }}>
        <fieldset className={grid} disabled={busy}>
          <label>Contracted rate per seat<input className={control} name="rate" type="number" min={0} max={1000000}
            step="0.01" defaultValue={terms ? terms.priceMinor / 100 : ''} required /></label>
          <CurrencyInput currency={terms?.currency ?? watch.currency} />
          <PeriodInput cadence={terms?.cadence ?? watch.cadence} />
          <label>Renewal date<input className={control} name="renewal" type="date" defaultValue={terms?.renewalDate} required /></label>
          <label>Cancellation notice deadline<input className={control} name="notice" type="date" defaultValue={terms?.noticeDate} required /></label>
          <label>Contract timezone<input className={control} name="timezone" defaultValue={terms?.timezone ?? localTimezone()} required /></label>
          <label>Reminder days before deadline<input className={control} name="leadDays" type="number" min={0} max={365}
            defaultValue={terms?.leadDays ?? ''} aria-describedby="renewal-optional" />
            <small id="renewal-optional">Leave blank to skip email reminders.</small></label>
        </fieldset>
        <div className="flex flex-wrap gap-2"><button className={action} disabled={busy}>Save contract</button>
          {terms && <button className={action} type="button" disabled={busy}
            onClick={() => save(() => callAction('setContractTerms', { ...key, contract: null }))}>Clear contract</button>}</div>
      </form>
      {gap?.state === 'comparable' && <p className="mt-3">Contract {money(gap.contractMinor, gap.currency)} · listed {money(gap.listedMinor, gap.currency)}
        {' · '}{signedMoney(gap.deltaMinor, gap.currency)}/{gap.cadence} at {gap.seats} seats</p>}
      {gap?.state === 'unavailable' && <p className="mt-3">{gap.reason}</p>}
      {watch.reminder && <p>Reminder {watch.reminder.state} · {new Date(watch.reminder.at).toLocaleString()}</p>}
    </details>
    <details>
      <summary className="cursor-pointer font-medium">Scheduled checks</summary>
      <form key={'schedule-' + watch.revision} className="mt-3 space-y-3" onSubmit={event => {
        const values = formData(event)
        save(() => callAction('setWatchSchedule', { ...key, schedule: {
          frequency: values.get('frequency') as 'daily' | 'weekly',
          timezone: String(values.get('timezone')).trim(), hour: Number(values.get('hour')),
        } }))
      }}>
        <fieldset className={grid} disabled={busy}>
          <label>Frequency<select className={control} name="frequency" defaultValue={schedule?.frequency ?? 'daily'}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select></label>
          <label>Local hour (0–23)<input className={control} name="hour" type="number" min={0} max={23} defaultValue={schedule?.hour ?? 9} required /></label>
          <label>Check timezone<input className={control} name="timezone" defaultValue={schedule?.timezone ?? localTimezone()} required /></label>
        </fieldset>
        <div className="flex flex-wrap gap-2"><button className={action} disabled={busy}>Save schedule</button>
          {schedule && <button className={action} type="button" disabled={busy}
            onClick={() => save(() => callAction('setWatchSchedule', { ...key, schedule: null }))}>Clear schedule</button>}</div>
      </form>
      {watch.monitoring && <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt>Next scheduled time</dt><dd>{watch.monitoring.nextAt ? new Date(watch.monitoring.nextAt).toLocaleString() : 'None'}</dd>
        <dt>Last successful capture</dt><dd>{watch.monitoring.lastSuccessAt ? new Date(watch.monitoring.lastSuccessAt).toLocaleString() : 'None yet'}</dd>
        <dt>Consecutive failures</dt><dd>{watch.monitoring.consecutiveFailures}</dd>
        {watch.monitoring.lastSkip && <><dt>Last skip</dt><dd>{watch.monitoring.lastSkip.reason}</dd></>}
      </dl>}
    </details>
    <details>
      <summary className="cursor-pointer font-medium">Price alert rules</summary>
      <form key={'rule-' + watch.revision} className="mt-3 space-y-3" onSubmit={event => {
        const values = formData(event)
        const amount = optionalNumber(values.get('amount'))
        const percent = optionalNumber(values.get('percent'))
        save(() => callAction('setAlertRule', { ...key, rule: {
          increases: values.has('increases'), decreases: values.has('decreases'),
          minAmountMinor: amount === null ? null : Math.round(amount * 100),
          minBasisPoints: percent === null ? null : Math.round(percent * 100),
        } }))
      }}>
        <fieldset className={grid} disabled={busy}>
          <label><input type="checkbox" name="increases" defaultChecked={rule?.increases ?? true} /> Increases</label>
          <label><input type="checkbox" name="decreases" defaultChecked={rule?.decreases ?? true} /> Decreases</label>
          <label>Minimum team cost change ({watch.currency})<input className={control} name="amount" type="number" min={0} max={100000000000}
            step="0.01" defaultValue={rule?.minAmountMinor == null ? '' : rule.minAmountMinor / 100} /></label>
          <label>Minimum change (%)<input className={control} name="percent" type="number" min={0} max={1000000}
            step="0.01" defaultValue={rule?.minBasisPoints == null ? '' : rule.minBasisPoints / 100} /></label>
        </fieldset>
        <p>When set, both minimums must pass.</p>
        <div className="flex flex-wrap gap-2"><button className={action} disabled={busy}>Save alert rule</button>
          {rule && <button className={action} type="button" disabled={busy}
            onClick={() => save(() => callAction('setAlertRule', { ...key, rule: null }))}>Restore default</button>}</div>
      </form>
    </details>
  </section>
}

export function ReportFindings({ check }: { check: Check }) {
  const { packaging, packagingChanges, alertDecision, contractGap } = check
  return <div className="space-y-3">
    {alertDecision && <p>Alert rule · {alertDecision.reason}</p>}
    {contractGap?.state === 'comparable' && <p>
      Contract {money(contractGap.contractMinor, contractGap.currency)} · listed {money(contractGap.listedMinor, contractGap.currency)}
      {' · '}{signedMoney(contractGap.deltaMinor, contractGap.currency)}/{contractGap.cadence} at {contractGap.seats} seats
    </p>}
    {contractGap?.state === 'unavailable' && <p>{contractGap.reason}</p>}
    {(packaging || !!packagingChanges?.length) && <section className={panel} aria-label="Packaging findings">
      <h3 className="font-semibold">Packaging findings</h3>
      {packaging && <div className="space-y-2">
        <p>Seat minimum · {packaging.state === 'changed' ? 'Changed' : 'Needs review'}</p>
        {packaging.belowMinimum && <p>The current minimum exceeds your seat count.</p>}
        <PackagingCitations previous={packaging.previous} current={packaging.current} />
      </div>}
      {packagingChanges?.map((finding, index) => <div key={index} className="space-y-2">
        <p>{finding.current?.label ?? finding.previous?.label} · {finding.state === 'changed' ? 'Changed' : 'Needs review'}</p>
        <PackagingCitations previous={finding.previous} current={finding.current} />
      </div>)}
    </section>}
  </div>
}

type Citation = { excerpt: string; capturedAt: string } | null
function PackagingCitations({ previous, current }: { previous: Citation; current: Citation }) {
  return <div className={grid}>{([{ label: 'Previous', evidence: previous }, { label: 'Current', evidence: current }]).map(({ label, evidence }) =>
    <div key={label} className="min-w-0">
      <p className="font-medium">{label}</p>
      {evidence ? <>
        <blockquote className="whitespace-pre-wrap [overflow-wrap:anywhere]">{evidence.excerpt}</blockquote>
        <time dateTime={evidence.capturedAt}>{new Date(evidence.capturedAt).toLocaleString()}</time>
      </> : <p>Evidence unavailable.</p>}
    </div>)}</div>
}
