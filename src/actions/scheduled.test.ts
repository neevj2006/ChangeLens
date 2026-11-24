import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { runScheduled } from './index'
import { demoMarkdown, uiFixtures } from '../changelens/fixtures'
import type { Check, Watch } from '../changelens/contract'

vi.mock('deepspace/worker', () => ({ RECORD_NOT_FOUND: 'not_found', readBoundedBodyText: (source: Response) => source.text() }))

const now = Date.parse('2027-01-01T15:00:00Z')
const url = 'https://vendor.example.org/pricing'
const account = 'fixture-owner'

function setup(watch: Watch, checks: Check[] = []) {
  let state = { watch, checks, snapshots: [], comparable: watch.baseline, reminderRecipient: 'verified@example.test' }
  const integration = vi.fn().mockResolvedValue({ success: true, data: { id: 'provider-id' } })
  const reserve = vi.fn().mockResolvedValue(true)
  const queue = vi.fn()
  const ctx = {
    userId: account, params: {}, reserve, queue,
    env: { CHANGELENS_VENDOR_EGRESS_URL: 'https://egress.example.org', CHANGELENS_EGRESS_TOKEN: 'fixture-token',
      CHANGELENS_ENABLE_EMAIL: 'true' },
    tools: {
      get: async () => ({ success: true, data: { record: { data: { ownerId: account, state: structuredClone(state) } } } }),
      update: async (_collection: string, _id: string, value: { state: typeof state }) => {
        state = structuredClone(value.state)
        return { success: true }
      },
      integration,
    },
  } as unknown as ActionContext<Env>
  return { ctx, reserve, queue, integration, state: () => state }
}

function makeWatch() {
  return {
    ...structuredClone(uiFixtures.confirmed), id: crypto.randomUUID(), url, status: 'armed' as const,
    schedule: { frequency: 'daily' as const, hour: 9, timezone: 'America/New_York' },
    monitoring: { consecutiveFailures: 0, nextAt: '2027-01-01T14:00:00Z', lastSuccessAt: null },
  }
}

describe('scheduled backend work', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('reserves once per due slot, tracks failure and recovers on the next slot', async () => {
    const watch = makeWatch()
    const fixture = setup(watch)
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('egress timeout'))
      .mockRejectedValueOnce(new Error('egress timeout'))
      .mockResolvedValueOnce(Response.json({ url, markdown: demoMarkdown.baseline }))
    vi.stubGlobal('fetch', fetcher)
    await runScheduled(fixture.ctx, watch.id, now)
    expect(fixture.state().watch.monitoring?.consecutiveFailures).toBe(1)
    expect(fixture.state().watch.latest?.outcome).toBe('failed')
    await runScheduled(fixture.ctx, watch.id, now)
    expect(fetcher).toHaveBeenCalledTimes(2)

    const excerpt = '## Pro\n\nUSD $29 per seat per month'
    fixture.integration.mockResolvedValueOnce({ success: true, data: { choices: [{
      finish_reason: 'stop', message: { content: JSON.stringify({
        plan: 'Pro', currency: 'USD', cadence: 'month', unit: 'seat', priceMinor: 2900, excerpt,
      }) },
    }] } })
    vi.useFakeTimers()
    vi.setSystemTime(now + 86_400_000)
    await runScheduled(fixture.ctx, watch.id, now + 86_400_000)
    expect(fixture.state().watch.monitoring).toMatchObject({
      consecutiveFailures: 0, lastSuccessAt: '2027-01-02T15:00:00.000Z',
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('continues scheduled checks after the rolling history fills', async () => {
    const watch = makeWatch()
    const history = Array.from({ length: 30 }, () => ({ ...uiFixtures.changed.latest, id: crypto.randomUUID() }))
    const fixture = setup(watch, history)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ url, markdown: demoMarkdown.baseline })))
    fixture.integration.mockResolvedValueOnce({ success: true, data: { choices: [{
      finish_reason: 'stop', message: { content: JSON.stringify({
        plan: 'Pro', currency: 'USD', cadence: 'month', unit: 'seat', priceMinor: 2900,
        excerpt: '## Pro\n\nUSD $29 per seat per month',
      }) },
    }] } })
    await runScheduled(fixture.ctx, watch.id, now)
    expect(fixture.state().checks).toHaveLength(30)
    expect(fixture.state().checks[0].outcome).toBe('unchanged')
    expect(fixture.state().watch.baseline?.priceMinor).toBe(2900)
    expect(fixture.state().watch.monitoring?.nextAt).toBe('2027-01-02T14:00:00Z')
  })

  it('records exhausted budgets and avoids provider work for paused watches', async () => {
    const watch = makeWatch()
    const fixture = setup(watch)
    fixture.reserve.mockResolvedValue(false)
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await runScheduled(fixture.ctx, watch.id, now)
    expect(fixture.state().watch.monitoring?.lastSkip?.reason).toContain('credit limit')
    expect(fetcher).not.toHaveBeenCalled()
    const paused = setup({ ...watch, status: 'paused' })
    await runScheduled(paused.ctx, watch.id, now)
    expect(paused.reserve).not.toHaveBeenCalled()
  })

  it('delivers one same-deadline reminder and ignores an expired deadline', async () => {
    const watch = makeWatch()
    const contract = {
      priceMinor: 2500, currency: 'USD' as const, cadence: 'month' as const, renewalDate: '2027-01-20',
      noticeDate: '2027-01-03', timezone: 'America/New_York', leadDays: 2,
    }
    const due = setup({ ...watch, schedule: null, monitoring: undefined, contract })
    await runScheduled(due.ctx, watch.id, now)
    await runScheduled(due.ctx, watch.id, now)
    expect(due.integration).toHaveBeenCalledTimes(1)
    expect(due.integration).toHaveBeenCalledWith('email/send', expect.objectContaining({ to: 'verified@example.test' }))
    expect(due.state().watch.reminder?.state).toBe('accepted')
    const expired = setup({ ...watch, schedule: null, monitoring: undefined, contract: { ...contract, noticeDate: '2026-12-31' } })
    await runScheduled(expired.ctx, watch.id, now)
    expect(expired.integration).not.toHaveBeenCalled()
    expect(expired.state().watch.reminder?.state).toBe('expired')
  })
})
