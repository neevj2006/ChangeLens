import { describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { sendAlert, searchContext } from './followups'
import { uiFixtures } from './fixtures'

const watch = uiFixtures.changed
const impact = watch.latest.impact!
const mockTools = (integration: unknown) => ({ integration }) as ActionTools

describe('report follow-ups', () => {
  it('filters to relevant Exa links and preserves citation dates', async () => {
    const response = { success: true, data: { results: [
      { title: 'Alder Desk revises subscription pricing', url: 'https://alderdesk.com/update', publishedDate: '2026-11-23' },
      { title: 'Alder Desk opens new office', url: 'https://alderdesk.com/office', publishedDate: null },
      { title: 'Other vendor raises prices', url: 'https://unrelated.com/', publishedDate: null },
    ] } }
    expect(await searchContext(mockTools(vi.fn().mockResolvedValue(response)), watch)).toEqual({
      state: 'found', sources: [{
        title: 'Alder Desk revises subscription pricing',
        url: 'https://alderdesk.com/update', publishedAt: '2026-11-23',
      }],
    })
  })

  it('distinguishes empty results from search failures', async () => {
    const integration = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { results: [] } })
      .mockRejectedValueOnce(new Error('fixture search failed'))
    expect(await searchContext(mockTools(integration), watch)).toEqual({ state: 'empty' })
    expect(await searchContext(mockTools(integration), watch)).toEqual({ state: 'failed' })
  })

  it('distinguishes a definite rejection from an uncertain delivery', async () => {
    const integration = vi.fn()
      .mockResolvedValueOnce({ success: false, status: 422 })
      .mockResolvedValueOnce({ success: false, status: 502 })
      .mockResolvedValueOnce({ success: true, data: {} })
    const send = () => sendAlert(mockTools(integration), watch, impact, 'owner@example.test')
    expect(await send()).toEqual({ state: 'failed' })
    expect(await send()).toEqual({ state: 'unknown' })
    expect(await send()).toEqual({ state: 'unknown' })
  })
})
