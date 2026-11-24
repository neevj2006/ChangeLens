import { describe, expect, it, vi } from 'vitest'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Check, Evidence, Watch } from '../changelens/contract'
import { actions } from './index'

vi.mock('deepspace/worker', async importOriginal => ({
  ...await importOriginal<object>(),
  readBoundedBodyText: (response: Response) => response.text(),
}))

describe('AI interpretation on an unverified offer', () => {
  it('can arm a watch and send a flagged alert for a later comparable price', async () => {
    const owner = 'buyer'
    const id = crypto.randomUUID()
    const url = 'https://vendor.example.org/pricing'
    const watch: Watch = { id, vendor: 'Vendor', url, plan: 'Pro', currency: 'USD', cadence: 'month',
      seats: 10, revision: 1, status: 'unarmed', baseline: null, candidate: null, latest: null }
    let state = { watch, checks: [] as Check[], snapshots: [], comparable: null as Evidence | null }
    let amount = 29
    const excerpt = () => 'Pro membership costs USD $' + amount + ' per billed seat each month.'
    const integration = vi.fn(async (endpoint: string, args: { max_tokens?: number }) => {
      if (endpoint === 'email/send') return { success: true, data: { id: 'sent' } }
      const content = args.max_tokens !== 220 ? 'null' : JSON.stringify({
        explanation: 'I found an explicit monthly per-seat offer in the text.',
        price: { plan: 'Pro', currency: 'USD', cadence: 'month', unit: 'seat', priceMinor: amount * 100, excerpt: excerpt() },
      })
      return { success: true, data: { choices: [{ finish_reason: 'stop', message: { content } }] } }
    })
    const tasks: (() => Promise<unknown>)[] = []
    const ctx = {
      userId: owner, params: { id, revision: 1 }, verifiedEmail: 'buyer@example.test',
      reserve: async () => true, defer: (task: () => Promise<unknown>) => tasks.push(task),
      env: { CHANGELENS_VENDOR_EGRESS_URL: 'https://egress.example.org', CHANGELENS_EGRESS_TOKEN: 'test',
        CHANGELENS_ENABLE_EMAIL: 'true' },
      tools: {
        integration,
        get: async () => ({ success: true, data: { record: { data: { ownerId: owner, state: structuredClone(state) } } } }),
        update: async (_: string, _id: string, row: { state: typeof state }) => {
          state = structuredClone(row.state)
          return { success: true }
        },
      },
    } as unknown as ActionContext<Env>
    vi.stubGlobal('fetch', async () => Response.json({ url, markdown: excerpt() }))
    try {
      await actions.captureBaseline(ctx)
      expect(state.watch.candidate?.interpretation).toBe('ai')
      expect(state.watch.latest?.reviewExplanation?.source).toBe('ai')
      ctx.params = { id, revision: state.watch.revision, snapshotId: state.watch.candidate?.snapshotId }
      await actions.confirmBaseline(ctx)
      expect(state.watch.status).toBe('armed')
      amount = 39
      ctx.params = { id, revision: state.watch.revision }
      await actions.checkWatch(ctx)
      expect(state.watch.latest?.impact?.deltaMinor).toBe(10000)
      expect(state.watch.latest?.impact?.current.interpretation).toBe('ai')
      for (const task of tasks) await task()
      expect(state.watch.latest?.alert.state).toBe('accepted')
      expect(integration).toHaveBeenCalledWith('email/send', expect.objectContaining({ text: expect.stringContaining('AI-interpreted pricing') }))
    } finally { vi.unstubAllGlobals() }
  })
})
