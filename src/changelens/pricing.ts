import { z } from 'zod'
import type { Evidence, Impact, WatchInput } from './contract'

export const watchInput = z.object({
  vendor: z.string().trim().min(1).max(100),
  url: z.url({ protocol: /^https?$/ }).max(500).refine(value => {
    const url = new URL(value)
    return !url.username && !url.password && !url.port && !url.hash &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) &&
      !/\.(?:local|internal|localhost|test|invalid|example)$/i.test(url.hostname)
  }),
  plan: z.string().trim().min(1).max(100),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']),
  cadence: z.enum(['month', 'year']),
  seats: z.number().int().min(1).max(100_000),
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

const priceLine = /^(USD|EUR|GBP|CAD|AUD) ([$€£])(\d{1,7})(?:\.(\d{2}))? per seat per (month|year)$/i
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
export function verifyEvidence(source: string, proposed: unknown, watch: WatchInput) {
  const parsed = extractedPrice.safeParse(proposed)
  if (!parsed.success) return null
  const facts = parsed.data
  if (facts.plan !== watch.plan || facts.currency !== watch.currency || facts.cadence !== watch.cadence) return null
  // The supported card is a level-two plan heading followed by a standalone exact price line.
  // Reject additional price-like lines and annual terms in that card.
  const regions = source.split(/(?=^#{1,2} )/m).filter(region =>
    region.split(/\r?\n/, 1)[0].trim().toLowerCase() === ('## ' + watch.plan).toLowerCase())
  if (regions.length === 0) return matchesTable(source, facts) ? facts : null
  if (regions.length !== 1) return null
  const region = regions[0]
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
  return currency.toUpperCase() === facts.currency && symbol === symbols[facts.currency] &&
    cadence.toLowerCase() === facts.cadence && Number(whole) * 100 + Number(fraction ?? 0) === facts.priceMinor
    ? facts : null
}

export function calculateImpact(old: Evidence, current: Evidence, seats: number): Impact {
  const oldTotalMinor = old.priceMinor * seats
  const newTotalMinor = current.priceMinor * seats
  return {
    old, current, seats, oldTotalMinor, newTotalMinor, deltaMinor: newTotalMinor - oldTotalMinor,
    assumptions: [
      'Public listed per-seat price. Taxes and contract terms are excluded.',
      'Check your contract to see whether this change applies to you.',
    ],
  }
}



