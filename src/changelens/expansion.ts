import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'
import type { AlertRule, ContractTerms, Evidence, Impact, PackagingChange, PackagingFact, Schedule, SeatMinimum } from './contract'
import { watchInput } from './pricing'
import { totalsAtSeats } from './report'

const timezone = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return /^[A-Za-z]/.test(value) }
  catch { return false }
})
export const termsInput = z.object({
  priceMinor: z.number().int().min(0).max(100_000_000),
  currency: watchInput.shape.currency,
  cadence: watchInput.shape.cadence,
  renewalDate: z.iso.date(),
  noticeDate: z.iso.date(),
  timezone,
  leadDays: z.number().int().min(0).max(365).nullable(),
}).refine(value => value.noticeDate <= value.renewalDate)
export const scheduleInput = z.object({
  frequency: z.enum(['daily', 'weekly']), timezone, hour: z.number().int().min(0).max(23),
})
export const alertRuleInput = z.object({
  increases: z.boolean(), decreases: z.boolean(),
  minAmountMinor: z.number().int().min(0).max(10_000_000_000_000).nullable(),
  minBasisPoints: z.number().int().min(0).max(100_000_000).nullable(),
})

export function contractGap(terms: ContractTerms, quote: Evidence | null, seats: number) {
  if (!quote) return { state: 'unavailable' as const, reason: 'No verified listed price.' }
  if (terms.currency !== quote.currency || terms.cadence !== quote.cadence || quote.unit !== 'seat') {
    return { state: 'unavailable' as const, reason: 'Contract and public pricing must share currency, billing period, and per-seat unit.' }
  }
  const totals = totalsAtSeats(terms.priceMinor, quote.priceMinor, seats)
  return {
    state: 'comparable' as const, seats, currency: quote.currency, cadence: quote.cadence,
    contractMinor: totals.oldTotalMinor, listedMinor: totals.newTotalMinor, deltaMinor: totals.deltaMinor,
  }
}

export function nextCheck(schedule: Schedule, after: number, recurring = false): string {
  const now = Temporal.Instant.fromEpochMilliseconds(after).toZonedDateTimeISO(schedule.timezone)
  const today = now.toPlainDate()
  const atHour = (date: Temporal.PlainDate) => date.toZonedDateTime({ timeZone: schedule.timezone, plainTime: { hour: schedule.hour } })
  const todayRun = atHour(today)
  const next = !recurring && todayRun.epochMilliseconds > after
    ? todayRun : atHour(today.add({ days: schedule.frequency === 'weekly' ? 7 : 1 }))
  return next.toInstant().toString()
}

export function afterScheduledSlot(schedule: Schedule, slot: string, now: number) {
  const local = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(schedule.timezone).toPlainDate()
  const first = local(Date.parse(slot))
  const today = local(now)
  const interval = schedule.frequency === 'weekly' ? 7 : 1
  const days = first.until(today, { largestUnit: 'days' }).days
  const cycle = Math.max(1, Math.floor(days / interval))
  const atCycle = (index: number) => first.add({ days: index * interval })
    .toZonedDateTime({ timeZone: schedule.timezone, plainTime: { hour: schedule.hour } })
  const candidate = atCycle(cycle)
  return (candidate.epochMilliseconds > now ? candidate : atCycle(cycle + 1)).toInstant().toString()
}

export function reminderTiming(terms: ContractTerms) {
  if (terms.leadDays === null) return null
  const deadline = Temporal.PlainDate.from(terms.noticeDate)
  const local = { timeZone: terms.timezone, plainTime: { hour: 9 } }
  const due = deadline.subtract({ days: terms.leadDays }).toZonedDateTime(local).epochMilliseconds
  const cutoff = deadline.add({ days: 1 }).toZonedDateTime(terms.timezone).epochMilliseconds
  return { due, cutoff }
}

export function evaluateAlert(impact: Impact, selected?: AlertRule | null) {
  const rule = selected ?? null
  const answer = (eligible: boolean, reason: string) => ({ eligible, reason, rule })
  if (!rule) return answer(true, 'Default rule allows comparable transitions.')
  const delta = impact.deltaMinor
  if ((delta > 0 && !rule.increases) || (delta < 0 && !rule.decreases)) {
    return answer(false, 'Price direction is disabled.')
  }
  if (rule.minAmountMinor !== null && Math.abs(delta) < rule.minAmountMinor) {
    return answer(false, 'The listed team cost change is below the dollar threshold.')
  }
  if (rule.minBasisPoints !== null && rule.minBasisPoints > 0) {
    if (impact.oldTotalMinor === 0) return answer(false, 'Percentage change is undefined from a zero price.')
    if (BigInt(Math.abs(delta)) * 10_000n < BigInt(impact.oldTotalMinor) * BigInt(rule.minBasisPoints)) {
      return answer(false, 'The listed team cost change is below the percentage threshold.')
    }
  }
  return answer(true, 'All configured alert thresholds passed.')
}

export function seatMinimum(region: string | null, capturedAt: string): SeatMinimum | null {
  const lines = region?.split(/\r?\n/).filter(line => /\b(?:no seat minimum|min(?:imum)?\.?\s+(?:of\s+)?(?:\d+\s+)?seats?|\d+\s+seats?\s+min(?:imum)?)\b/i.test(line)) ?? []
  if (lines.length !== 1) return null
  const excerpt = lines[0]
  const line = excerpt.trim().replace(/^(?:[-*] )/, '').replace(/[.!]$/, '')
  if (/^no (?:seat minimum|minimum seats?)$/i.test(line)) return { seats: null, excerpt, capturedAt }
  const match = /^(?:minimum(?: of)? (\d+) seats?|(\d+) seats? minimum)$/i.exec(line)
  const seats = Number(match?.[1] ?? match?.[2])
  return Number.isSafeInteger(seats) && seats > 0 && seats <= 100_000 ? { seats, excerpt, capturedAt } : null
}

export function featureClaim(region: string | null, feature: string) {
  const key = feature.toLowerCase()
  const lines = region?.split(/\r?\n/).flatMap(excerpt => {
    const line = excerpt.trim().replace(/^(?:[-*] )/, '').replace(/[.!]$/, '')
    const match = /^(includes?|does not include|excludes?) (.+)$/i.exec(line)
    if (!match || match[2].toLowerCase() !== key) return []
    return [{ state: /^includes?$/i.test(match[1]) ? 'included' as const : 'excluded' as const, excerpt }]
  }) ?? []
  return lines.length === 1 ? { feature, ...lines[0] } : { feature, state: 'unknown' as const, excerpt: null }
}


export function packagingFacts(region: string | null, capturedAt: string): PackagingFact[] {
  const facts: PackagingFact[] = []
  for (const excerpt of region?.split(/\r?\n/) ?? []) {
    const line = excerpt.trim().replace(/^(?:[-*] )/, '').replace(/[.!]$/, '')
    const allowance = /^(?:includes?|allows?) (?:up to )?(\d{1,9}) ([a-z][a-z0-9 -]{1,50}) per (month|year)$/i.exec(line)
    if (allowance) {
      facts.push({ kind: 'allowance', label: allowance[2], limit: Number(allowance[1]),
        period: allowance[3].toLowerCase() as 'month' | 'year', excerpt, capturedAt })
      continue
    }
    const feature = /^(includes?|does not include|excludes?) ([a-z][a-z0-9 -]{1,80})$/i.exec(line)
    if (feature && !/\b(?:seats?|per|up to|usage)\b/i.test(feature[2])) {
      facts.push({ kind: 'feature', label: feature[2], included: /^includes?$/i.test(feature[1]), excerpt, capturedAt })
    }
  }
  return facts.filter(fact => facts.filter(other => packagingKey(other) === packagingKey(fact)).length === 1).slice(0, 20)
}

const packagingKey = (fact: PackagingFact) => fact.kind + ':' + fact.label.toLowerCase()

export function comparePackaging(previous: PackagingFact[], current: PackagingFact[]) {
  const before = new Map(previous.map(fact => [packagingKey(fact), fact]))
  const after = new Map(current.map(fact => [packagingKey(fact), fact]))
  const findings: PackagingChange[] = []
  for (const [key, old] of before) {
    const fresh = after.get(key)
    if (!fresh) findings.push({ state: 'needs_review', previous: old, current: null })
    else if ((old.kind === 'feature' && fresh.kind === 'feature' && old.included !== fresh.included) ||
        (old.kind === 'allowance' && fresh.kind === 'allowance' && (old.limit !== fresh.limit || old.period !== fresh.period))) {
      findings.push({ state: 'changed', previous: old, current: fresh })
    }
  }
  return findings
}
