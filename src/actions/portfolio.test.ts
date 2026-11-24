import { describe, expect, it, vi } from 'vitest'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Currency, Cadence, Portfolio, Watch } from '../changelens/contract'
import { calculateImpact } from '../changelens/pricing'
import { uiFixtures } from '../changelens/fixtures'
import { actions } from './index'

vi.mock('deepspace/worker', () => ({ RECORD_NOT_FOUND: 'not_found' }))

function row(currency: Currency, cadence: Cadence, ownerId = 'buyer', renewal = false) {
  const watch: Watch = structuredClone(uiFixtures.changed)
  watch.id = crypto.randomUUID()
  const { old, current } = uiFixtures.changed.latest.impact!
  const base = { ...old, currency, cadence, capturedAt: '2026-11-01T14:00:00Z' }
  const present = { ...current, currency, cadence, capturedAt: '2026-11-23T14:00:00Z' }
  const check = { ...uiFixtures.changed.latest, watchId: watch.id, id: crypto.randomUUID(),
    checkedAt: present.capturedAt, impact: calculateImpact(base, present, 10) }
  const prior = { ...check, id: crypto.randomUUID(), checkedAt: '2026-11-20T14:00:00Z' }
  Object.assign(watch, { currency, cadence, baseline: base, latest: check })
  if (renewal) watch.contract = { priceMinor: 2500, currency, cadence, renewalDate: '2026-12-30',
    noticeDate: '2026-12-15', timezone: 'America/New_York', leadDays: null }
  return { data: { ownerId, state: { watch, checks: [check, prior], comparable: present } } }
}

describe('watch portfolio groups', () => {
  it('uses the latest change per watch and separates currencies and periods', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T14:00:00Z'))
    try {
      const records = [row('USD', 'month', 'buyer', true), row('USD', 'year'), row('EUR', 'month'), row('GBP', 'year', 'other')]
      const query = vi.fn().mockResolvedValue({ success: true, data: { records } })
      const ctx = { params: {}, userId: 'buyer', tools: { query } } as unknown as ActionContext<Env>
      const response = await actions.getPortfolio(ctx)
      expect(response.success).toBe(true)
      const data = response.data as Portfolio
      expect(data.renewals).toHaveLength(1)
      expect(data.changes).toHaveLength(3)
      expect(data.totals).toEqual([
        { currency: 'USD', cadence: 'month', deltaMinor: 10000, watchCount: 1 },
        { currency: 'USD', cadence: 'year', deltaMinor: 10000, watchCount: 1 },
        { currency: 'EUR', cadence: 'month', deltaMinor: 10000, watchCount: 1 },
      ])
      expect(query).toHaveBeenCalledWith('changeLensWatches', { where: { ownerId: 'buyer' }, limit: 100 })
    } finally { vi.useRealTimers() }
  })
})
