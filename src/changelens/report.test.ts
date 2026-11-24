import { describe, expect, it } from 'vitest'
import { uiFixtures } from './fixtures'
import { calculateImpact } from './pricing'
import { formatSummary, totalsAtSeats } from './report'

describe('buyer report tools', () => {
  const impact = uiFixtures.changed.latest.impact!

  it('calculates hypothetical totals without altering the saved amounts or summary', () => {
    expect(totalsAtSeats(impact.old.priceMinor, impact.current.priceMinor, 25)).toEqual({
      oldTotalMinor: 72500, newTotalMinor: 97500, deltaMinor: 25000,
    })
    const summary = formatSummary(impact, 'Alder Desk', 'en-US')
    expect(summary).toContain('Alder Desk · Pro')
    expect(summary).toContain('USD · 10 seats · per month')
    expect(summary).toContain('$290.00 → $390.00 (+$100.00/month)')
    expect(summary).toContain(impact.old.excerpt)
    expect(summary).toContain(impact.current.excerpt)
    expect(summary).toContain(impact.old.sourceUrl)
    expect(summary).toContain('Check your contract')
  })

  it('formats a negative annual change from the captured billing cadence', () => {
    const saved = calculateImpact({ ...impact.current, cadence: 'year' }, { ...impact.old, cadence: 'year' }, 10)
    expect(formatSummary(saved, 'Alder Desk', 'en-US')).toContain('$390.00 → $290.00 (-$100.00/year)')
  })
})
