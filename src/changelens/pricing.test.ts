import { describe, expect, it } from 'vitest'
import { demoMarkdown } from './fixtures'
import { cosmeticForm, verifyEvidence, verifyMonthlyAlternative, watchInput } from './pricing'
import type { WatchInput } from './contract'

const watch: WatchInput = {
  vendor: 'Alder Desk', url: 'https://alderdesk.com/pricing', plan: 'Pro',
  currency: 'USD', cadence: 'month', seats: 10,
}
const price = {
  plan: 'Pro', currency: 'USD', cadence: 'month', unit: 'seat', priceMinor: 2900,
  excerpt: '## Pro\n\nUSD $29 per seat per month',
}

describe('pricing evidence', () => {
  it('accepts the exact selected card even if another plan has the same price', () => {
    expect(verifyEvidence(demoMarkdown.repeated, price, watch)).toEqual(price)
    expect(verifyEvidence(demoMarkdown.repeated, {
      ...price, excerpt: '## Team\n\nUSD $29 per seat per month',
    }, watch)).toBeNull()
  })

  it('rejects ambiguity, other plans, currencies and annual monthly equivalents', () => {
    for (const source of [demoMarkdown.annual, demoMarkdown.ambiguous, demoMarkdown.wrongPlan, demoMarkdown.wrongCurrency]) {
      expect(verifyEvidence(source, price, watch)).toBeNull()
    }
    expect(verifyEvidence(demoMarkdown.annual, {
      ...price, priceMinor: 3900, excerpt: demoMarkdown.annual.split('\n\n').slice(1).join('\n\n'),
    }, watch)).toBeNull()
  })

  it('ties table prices to the exact plan row and applicable billing header', () => {
    const source = [
      '| Plan | Monthly (USD per seat) | Annual (USD per seat) |',
      '| --- | --- | --- |',
      '| Team | $29 | $348 |',
      '| Pro | $39 | $468 ($39 monthly equivalent) |',
    ].join('\n')
    expect(verifyEvidence(source, { ...price, priceMinor: 3900, excerpt: source }, watch)?.priceMinor).toBe(3900)
    expect(verifyEvidence(source, { ...price, excerpt: source }, watch)).toBeNull()
    expect(verifyEvidence(source, {
      ...price, priceMinor: 3900, excerpt: source, cadence: 'year',
    }, { ...watch, cadence: 'year' })).toBeNull()
    expect(verifyEvidence(source, {
      ...price, priceMinor: 3900, excerpt: source.split('\n').at(-1),
    }, watch)).toBeNull()
  })
  it('recognizes bold formatting without hiding a price change', () => {
    expect(cosmeticForm(demoMarkdown.cosmetic)).toEqual(cosmeticForm(demoMarkdown.increased))
    expect(cosmeticForm(demoMarkdown.baseline)).not.toEqual(cosmeticForm(demoMarkdown.increased))
  })

  it('verifies a named monthly alternative without using the annual equivalent', () => {
    const line = 'Starter is free for 2 users (new customers only). Team is US$39.90 per user per month billed annually, or US$49.90 monthly. Growth is US$59.90 annually, or US$74.90 monthly.'
    const input = { ...watch, plan: 'Team' }
    const price = verifyMonthlyAlternative(line, input)
    expect(price?.priceMinor).toBe(4990)
    expect(price && line.includes(price.excerpt)).toBe(true)
    expect(verifyMonthlyAlternative(line, { ...input, cadence: 'year' })).toBeNull()
    expect(verifyMonthlyAlternative(line, { ...input, plan: 'Growth' })).toBeNull()
    expect(verifyMonthlyAlternative(line + '\n' + line.replace('49.90', '55.90'), input)).toBeNull()
  })

  it('rejects local targets, credentials, non-HTTP and invalid seat counts', () => {
    for (const url of ['http://127.0.0.1/', 'http://[::1]/', 'http://localhost/', 'https://host.internal/',
      'https://user@alderdesk.com/', 'file:///pricing', 'https://alderdesk.com:8080/pricing']) {
      expect(watchInput.safeParse({ ...watch, url }).success).toBe(false)
    }
    expect(watchInput.safeParse({ ...watch, seats: 1.5 }).success).toBe(false)
    expect(watchInput.safeParse(watch).success).toBe(true)
  })
})
