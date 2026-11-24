import type { Impact } from './contract'

export const MAX_SEATS = 100_000

export function totalsAtSeats(oldPrice: number, newPrice: number, seats: number) {
  const oldTotalMinor = oldPrice * seats
  const newTotalMinor = newPrice * seats
  return { oldTotalMinor, newTotalMinor, deltaMinor: newTotalMinor - oldTotalMinor }
}

export const money = (minor: number, currency: string, locale?: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100)

export function formatSummary(impact: Impact, vendor?: string, locale?: string) {
  const { old, current, seats, oldTotalMinor, newTotalMinor, deltaMinor } = impact
  const amount = (value: number) => money(value, current.currency, locale)
  return [
    (vendor ?? new URL(current.sourceUrl).hostname) + ' · ' + current.plan,
    current.currency + ' · ' + seats + ' seats · per ' + current.cadence,
    amount(oldTotalMinor) + ' → ' + amount(newTotalMinor) +
      ' (' + (deltaMinor > 0 ? '+' : '') + amount(deltaMinor) + '/' + current.cadence + ')',
    '',
    'Previous pricing evidence', old.excerpt, old.sourceUrl,
    '',
    'Current pricing evidence', current.excerpt, current.sourceUrl,
    '',
    ...impact.assumptions,
  ].join('\n')
}
