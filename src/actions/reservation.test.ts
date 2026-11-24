import { describe, expect, it, vi } from 'vitest'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { uiFixtures } from '../changelens/fixtures'
import { actions } from './index'

vi.mock('deepspace/worker', () => ({ RECORD_NOT_FOUND: 'not_found' }))

describe('alert reservation persistence', () => {
  it('sends only after a durable reservation and suppresses resends if settlement cannot be saved', async () => {
    const watch = structuredClone(uiFixtures.changed)
    watch.id = crypto.randomUUID()
    watch.latest.id = crypto.randomUUID()
    watch.latest.alert = { state: 'failed' }
    const userId = 'owner'
    let state = { watch, checks: [watch.latest], snapshots: [], comparable: watch.baseline }
    const update = vi.fn()
      .mockResolvedValueOnce({ success: false })
      .mockImplementationOnce(async (_collection, _id, data) => {
        state = structuredClone(data.state)
        return { success: true }
      })
      .mockResolvedValueOnce({ success: false })
    const send = vi.fn().mockResolvedValue({ success: true, data: { id: 'accepted' } })
    const tasks: (() => Promise<unknown>)[] = []
    const ctx = {
      userId,
      params: { id: watch.id, revision: watch.revision, checkId: watch.latest.id },
      verifiedEmail: 'owner@example.test',
      defer: (task: () => Promise<unknown>) => tasks.push(task),
      tools: {
        get: async () => ({ success: true, data: { record: { data: { ownerId: userId, state: structuredClone(state) } } } }),
        update, integration: send,
      },
      env: { OWNER_USER_ID: userId, CHANGELENS_ENABLE_EMAIL: 'true' },
    } as unknown as ActionContext<Env>

    await expect(actions.retryAlert(ctx)).rejects.toThrow('Watch write failed.')
    expect(tasks).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()

    expect((await actions.retryAlert(ctx)).success).toBe(true)
    expect(state.checks[0].alert.state).toBe('pending')
    await expect(tasks[0]()).rejects.toThrow('Watch write failed.')
    expect(send).toHaveBeenCalledTimes(1)
    ctx.params.revision = state.watch.revision
    expect(await actions.retryAlert(ctx)).toMatchObject({ success: false, code: 'retry_unavailable' })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
