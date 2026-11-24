import { describe, expect, it } from 'vitest'
import { uiFixtures } from './fixtures'
import { comparePackaging, contractGap, evaluateAlert, featureClaim, nextCheck, packagingFacts, reminderTiming, seatMinimum, termsInput } from './expansion'
import { verifyEvidence } from './pricing'

const impact = uiFixtures.changed.latest.impact!
const quote = impact.current
const terms = { priceMinor: 2500, currency: 'USD', cadence: 'month', renewalDate: '2027-01-10',
  noticeDate: '2027-01-01', leadDays: 3, timezone: 'America/New_York' } as const
const rule = { increases: true, decreases: false, minAmountMinor: 10000, minBasisPoints: 3000 }

describe('watch expansion', () => {
  it('validates contract dates and calculates only comparable contract gaps', () => {
    expect(termsInput.safeParse(terms).success).toBe(true)
    expect(termsInput.safeParse({ ...terms, noticeDate: '2027-02-30' }).success).toBe(false)
    expect(termsInput.safeParse({ ...terms, noticeDate: '2027-01-11' }).success).toBe(false)
    expect(contractGap(terms, quote, 10)).toMatchObject({ state: 'comparable', deltaMinor: 14000 })
    expect(contractGap({ ...terms, currency: 'EUR' }, quote, 10).state).toBe('unavailable')
    expect(contractGap({ ...terms, cadence: 'year' }, quote, 10).state).toBe('unavailable')
  })

  it('uses calendar days for notice offsets and daily or weekly schedules across DST', () => {
    expect(new Date(reminderTiming(terms)!.due).toISOString()).toBe('2026-12-29T14:00:00.000Z')
    expect(new Date(reminderTiming({ ...terms, timezone: 'Asia/Tokyo' })!.due).toISOString()).toBe('2026-12-29T00:00:00.000Z')
    const at = Date.parse('2027-03-13T14:00:00Z')
    expect(nextCheck({ frequency: 'daily', hour: 9, timezone: terms.timezone }, at, true)).toBe('2027-03-14T13:00:00Z')
    expect(nextCheck({ frequency: 'weekly', hour: 9, timezone: terms.timezone }, at, true)).toBe('2027-03-20T13:00:00Z')
  })

  it('requires both configured thresholds and handles zero prices without division', () => {
    expect(evaluateAlert(impact, rule).eligible).toBe(true)
    expect(evaluateAlert(impact, { ...rule, minAmountMinor: 10001 }).eligible).toBe(false)
    expect(evaluateAlert(impact, { ...rule, minBasisPoints: 3449 }).eligible).toBe(false)
    expect(evaluateAlert({ ...impact, deltaMinor: -10000 }, rule).eligible).toBe(false)
    expect(evaluateAlert({ ...impact, oldTotalMinor: 0 }, rule).eligible).toBe(false)
    expect(evaluateAlert({ ...impact, oldTotalMinor: 0 }, { ...rule, minBasisPoints: null }).eligible).toBe(true)
  })

  it('keeps dated evidence for changes to named features and usage limits', () => {
    const before = packagingFacts('Includes SSO\nIncludes 500 API calls per month', '2026-11-20')
    const after = packagingFacts('Excludes SSO\nIncludes 250 API calls per month', '2026-11-24')
    expect(comparePackaging(before, after)).toMatchObject([
      { state: 'changed', previous: { included: true }, current: { included: false, capturedAt: '2026-11-24' } },
      { state: 'changed', previous: { limit: 500, excerpt: 'Includes 500 API calls per month' }, current: { limit: 250 } },
    ])
    expect(comparePackaging(before, []).every(item => item.state === 'needs_review')).toBe(true)
  })

  it('verifies explicit user pricing and preserves plan-scoped packaging evidence', () => {
    const excerpt = '### Pro\n\nUSD 39.5 per user/month'
    const source = excerpt + '\n\n- Minimum 12 seats\n- Includes SSO\n\n### Team\n\n- Excludes SSO'
    expect(verifyEvidence(source, { ...quote, priceMinor: 3950, excerpt }, uiFixtures.changed)?.priceMinor).toBe(3950)
    expect(seatMinimum('- Minimum 12 seats', quote.capturedAt)).toMatchObject({ seats: 12, excerpt: '- Minimum 12 seats' })
    expect(seatMinimum('No seat minimum.', quote.capturedAt)).toMatchObject({ seats: null })
    expect(seatMinimum('Minimum 10 seats\nMinimum 20 seats', quote.capturedAt)).toBeNull()
    expect(seatMinimum('Contact sales for seat requirements', quote.capturedAt)).toBeNull()
    expect(featureClaim('- Includes SSO', 'SSO').state).toBe('included')
    expect(featureClaim('Does not include SSO', 'SSO').state).toBe('excluded')
    expect(featureClaim('Includes SSO\nExcludes SSO', 'SSO').state).toBe('unknown')
  })
})
