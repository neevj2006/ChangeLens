import type { Check, Evidence, Result, Watch } from './contract'

export const demoMarkdown = {
  baseline: '# Alder Desk\n\n## Pro\n\nUSD $29 per seat per month\n\n## Team\n\nUSD $49 per seat per month',
  increased: '# Alder Desk\n\n## Pro\n\nUSD $39 per seat per month\n\n## Team\n\nUSD $49 per seat per month',
  cosmetic: '# Alder Desk\n\n## Pro\n\n**USD $39 per seat per month**\n\n## Team\n\nUSD $49 per seat per month',
  annual: '# Alder Desk\n\n## Pro\n\nUSD $468 per seat per year (USD $39 per seat per month equivalent)',
  wrongPlan: '# Alder Desk\n\n## Team\n\nUSD $39 per seat per month',
  wrongCurrency: '# Alder Desk\n\n## Pro\n\nEUR €39 per seat per month',
  repeated: '# Alder Desk\n\n## Pro\n\nUSD $29 per seat per month\n\n## Team\n\nUSD $29 per seat per month',
  ambiguous: '# Alder Desk\n\n## Pro\n\nUSD $39 per seat per month or USD $29 per seat per month',
  failed: null,
} as const

const old: Evidence = {
  snapshotId: 'snapshot-29',
  sourceUrl: 'https://vendor.example/pricing',
  capturedAt: '2026-11-23T15:00:00Z',
  plan: 'Pro',
  currency: 'USD',
  cadence: 'month',
  unit: 'seat',
  priceMinor: 2900,
  excerpt: '## Pro\n\nUSD $29 per seat per month',
}
const current: Evidence = {
  ...old,
  snapshotId: 'snapshot-39',
  capturedAt: '2026-11-23T15:10:00Z',
  priceMinor: 3900,
  excerpt: '## Pro\n\nUSD $39 per seat per month',
}
const baseline: Check = {
  id: old.snapshotId,
  watchId: 'watch-demo',
  checkedAt: old.capturedAt,
  outcome: 'baseline_ready',
  message: 'Review the pricing evidence and confirm the baseline.',
  evidence: old,
  impact: null,
  alert: { state: 'not_applicable' },
  context: { state: 'not_applicable' },
}
const changed: Check = {
  ...baseline,
  id: current.snapshotId,
  checkedAt: current.capturedAt,
  outcome: 'changed',
  message: 'The listed price changed.',
  evidence: current,
  impact: {
    old, current, seats: 10, oldTotalMinor: 29000, newTotalMinor: 39000, deltaMinor: 10000,
    assumptions: ['Public listed price for 10 seats.', 'Check your contract to see whether this change applies to you.'],
  },
  alert: { state: 'accepted' },
  context: { state: 'empty' },
}
const candidate: Watch = {
  id: baseline.watchId, vendor: 'Alder Desk', url: old.sourceUrl, plan: old.plan,
  currency: old.currency, cadence: old.cadence, seats: 10, revision: 2,
  status: 'unarmed', baseline: null, candidate: old, latest: baseline,
}

export const uiFixtures = {
  setup: { ...candidate, revision: 1, candidate: null, latest: null },
  candidate,
  confirmed: { ...candidate, revision: 3, status: 'armed', baseline: old, candidate: null } satisfies Watch,
  changed: { ...candidate, revision: 4, status: 'armed', baseline: old, candidate: null, latest: changed } satisfies Watch,
  withScreenshots: {
    ...changed,
    vendor: 'Alder Desk',
    impact: {
      ...changed.impact!,
      old: { ...old, screenshot: 'available' },
      current: { ...current, screenshot: 'available' },
    },
  } satisfies Check,
  followups: {
    pending: { ...changed, alert: { state: 'pending' }, context: { state: 'pending' } },
    unknown: { ...changed, alert: { state: 'unknown' }, context: { state: 'failed' } },
    cited: {
      ...changed,
      context: {
        state: 'found',
        sources: [{ title: 'Alder Desk updates its Pro pricing', url: 'https://vendor.example/updates', publishedAt: '2026-11-23' }],
      },
    },
  } satisfies Record<string, Check>,
  history: {
    checks: [
      { ...baseline, id: 'check-failed', checkedAt: '2026-11-23T15:40:00Z', outcome: 'failed', message: 'The pricing page could not be captured.', evidence: null },
      { ...baseline, id: 'check-annual', checkedAt: '2026-11-23T15:30:00Z', outcome: 'needs_review', message: 'The selected monthly offer could not be verified.', evidence: null },
      { ...baseline, id: 'check-cosmetic', checkedAt: '2026-11-23T15:25:00Z', outcome: 'cosmetic', message: 'Only formatting changed.', evidence: current },
      { ...baseline, id: 'check-repeat', checkedAt: '2026-11-23T15:20:00Z', outcome: 'unchanged', message: 'The listed price is unchanged.', evidence: current },
      changed, baseline,
    ] satisfies Check[],
    nextBefore: null,
  },
  stale: { success: false, code: 'stale_revision', error: 'Reload the watch and try again.' } satisfies Result<never>,
}

export const expandedWatchFixture = {
  ...uiFixtures.changed,
  contract: {
    priceMinor: 2500, currency: 'USD', cadence: 'month',
    renewalDate: '2027-01-10', noticeDate: '2026-12-20',
    timezone: 'America/New_York', leadDays: 7,
  },
  contractGap: {
    state: 'comparable', currency: 'USD', cadence: 'month', seats: 10,
    contractMinor: 25000, listedMinor: 39000, deltaMinor: 14000,
  },
  schedule: { frequency: 'weekly', timezone: 'America/New_York', hour: 9 },
  monitoring: {
    nextAt: '2026-11-30T14:00:00Z', lastSuccessAt: '2026-11-23T15:10:00Z', consecutiveFailures: 0,
  },
  alertRule: { increases: true, decreases: false, minAmountMinor: 10000, minBasisPoints: null },
} satisfies Watch
