import { MAX_SEATS, totalsAtSeats } from './report'
import { z } from 'zod'
import type { Evidence, Impact, WatchInput } from './contract'

export const watchInput = z.object({
  vendor: z.string().trim().min(1).max(100),
  url: z.url({ protocol: /^https?$/ }).max(500).refine(value => {
    const url = new URL(value)
    return !url.username && !url.password && !url.port && !url.hash &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) &&
      !/\.(?:local|internal|localhost|test|invalid|example|onion|home|arpa)$/i.test(url.hostname)
  }).transform(value => new URL(value).href),
  plan: z.string().trim().min(1).max(100),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']),
  cadence: z.enum(['month', 'year']),
  seats: z.number().int().min(1).max(MAX_SEATS),
})

export const normalize = (source: string) => source.replace(/\r\n?/g, '\n').trim()
export const cosmeticForm = (source: string) => normalize(source)
  .replace(/\*\*([^*\n]+)\*\*/g, '$1')
  .replace(/[ \t]+$/gm, '')

export const extractedPrice = z.object({
  plan: z.string(),
  currency: watchInput.shape.currency,
  cadence: watchInput.shape.cadence,
  unit: z.literal('seat'),
  priceMinor: z.number().int().min(0).max(100_000_000),
  excerpt: z.string().min(1).max(1_000),
})

const priceLine = /^(USD|EUR|GBP|CAD|AUD)\s*([$€£])?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*(?:per|\/)\s*(?:seat|user)\s*(?:per|\/)\s*(month|year)$/i
const symbols = { USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$' }

const tableCells = (line: string) => line.trim().slice(1, -1).split('|').map(cell => cell.trim())

function matchesTable(source: string, facts: z.infer<typeof extractedPrice>): boolean {
  const tables = source.match(/(?:^[ \t]*\|[^\r\n]+\|[ \t]*(?:\r?\n|$)){3,}/gm) ?? []
  const headerLabel = (facts.cadence === 'month' ? 'monthly' : 'annual') + ' (' + facts.currency.toLowerCase() + ' per seat)'
  const candidates = tables.flatMap(table => {
    const lines = table.trim().split(/\r?\n/)
    const headers = tableCells(lines[0]).map(cell => cell.toLowerCase())
    if (headers[0] !== 'plan' || !tableCells(lines[1]).every(cell => /^:?-{3,}:?$/.test(cell))) return []
    const matchingColumns = headers.flatMap((header, index) => header === headerLabel ? [index] : [])
    return lines.slice(2).flatMap((line, index) => {
      const cells = tableCells(line)
      if (cells[0]?.toLowerCase() !== facts.plan.toLowerCase()) return []
      const amount = matchingColumns.length === 1 && cells.length === headers.length
        ? /^([$€£])(\d{1,7})(?:\.(\d{2}))?$/.exec(cells[matchingColumns[0]]) : null
      return [{ amount, evidence: lines.slice(0, index + 3).join(table.includes('\r\n') ? '\r\n' : '\n') }]
    })
  })
  if (candidates.length !== 1) return false
  const { amount, evidence } = candidates[0]
  return Boolean(amount && evidence === facts.excerpt && source.includes(evidence) &&
    source.indexOf(evidence) === source.lastIndexOf(evidence) && amount[1] === symbols[facts.currency] &&
    Number(amount[2]) * 100 + Number(amount[3] ?? 0) === facts.priceMinor)
}
export function planRegion(source: string, plan: string) {
  const regions = source.split(/(?=^#{1,6} )/m).filter(region => {
    const title = /^#{1,6} (.+)$/.exec(region.split(/\r?\n/, 1)[0].trim())?.[1]
    return title?.toLowerCase() === plan.toLowerCase()
  })
  return regions.length === 1 ? regions[0] : null
}
export function verifyEvidence(source: string, proposed: unknown, watch: WatchInput) {
  const parsed = extractedPrice.safeParse(proposed)
  if (!parsed.success) return null
  const facts = parsed.data
  if (facts.plan !== watch.plan || facts.currency !== watch.currency || facts.cadence !== watch.cadence) return null
  const region = planRegion(source, watch.plan)
  if (!region) {
    // A duplicated plan heading makes the offer ambiguous, even when a table is present.
    const matchingHeadings = source.split(/\r?\n/).filter(line =>
      /^#{1,6} (.+)$/.exec(line.trim())?.[1]?.toLowerCase() === watch.plan.toLowerCase())
    return !matchingHeadings.length && matchesTable(source, facts) ? facts : null
  }
  const start = source.indexOf(region)
  const excerptAt = source.indexOf(facts.excerpt)
  if (excerptAt !== start || !region.startsWith(facts.excerpt) || source.lastIndexOf(facts.excerpt) !== excerptAt) return null
  const lines = region.trim().split(/\r?\n/).slice(1).map(line => line.trim().replace(/^\*\*(.*)\*\*$/, '$1'))
  const prices = lines.filter(line => /[$€£]|\b(?:USD|EUR|GBP|CAD|AUD)\b|\bbilled\b|\bannual(?:ly)?\b/i.test(line))
  if (prices.length !== 1) return null
  const pricingLine = prices[0]
  const price = priceLine.exec(pricingLine)
  if (!price || !facts.excerpt.split(/\r?\n/).some(line =>
    line.trim().replace(/^\*\*(.*)\*\*$/, '$1') === pricingLine)) return null
  const [, currency, symbol, whole, fraction, cadence] = price
  return currency.toUpperCase() === facts.currency && (!symbol || symbol === symbols[facts.currency]) &&
    cadence.toLowerCase() === facts.cadence && Number(whole) * 100 + Number((fraction ?? '').padEnd(2, '0')) === facts.priceMinor
    ? facts : null
}

/** A named offer can state its monthly-billed rate as an alternative to an annual equivalent. */
export function verifyMonthlyAlternative(source: string, watch: WatchInput) {
  if (watch.currency !== 'USD' || watch.cadence !== 'month') return null
  const name = watch.plan.replace(/[.*+?^${}()|[\]\\]/g, '\$&')
  const pattern = new RegExp(
    '(?:^|[.!?]\\s+)(' + name +
    ' is US\\$\\d{1,7}(?:\\.\\d{2})? per user per month billed annually, or US\\$(\\d{1,7})(?:\\.(\\d{2}))? monthly)\\.(?=\\s|$)',
    'gim',
  )
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) return null
  const [, excerpt, whole, fraction] = matches[0]
  const parsed = extractedPrice.safeParse({
    plan: watch.plan, currency: 'USD', cadence: 'month', unit: 'seat',
    priceMinor: Number(whole) * 100 + Number(fraction ?? 0), excerpt: excerpt + '.',
  })
  return parsed.success ? parsed.data : null
}
export function calculateImpact(old: Evidence, current: Evidence, seats: number): Impact {
  const totals = totalsAtSeats(old.priceMinor, current.priceMinor, seats)
  return {
    old, current, seats, ...totals,
    assumptions: [
      ...(old.interpretation === 'ai' || current.interpretation === 'ai' ? ['AI-interpreted pricing. Verify the source before relying on these amounts.'] : []),
      'Public listed per-seat price. Taxes and contract terms are excluded.',
      'Check your contract to see whether this change applies to you.',
    ],
  }
}
