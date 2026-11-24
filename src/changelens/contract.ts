export type Cadence = 'month' | 'year'
export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD'
export type ContractTerms = {
  priceMinor: number; currency: Currency; cadence: Cadence
  renewalDate: string; noticeDate: string; timezone: string; leadDays: number | null
}
export type Schedule = { frequency: 'daily' | 'weekly'; timezone: string; hour: number }
export type Monitoring = {
  nextAt: string | null; lastSuccessAt: string | null; consecutiveFailures: number
  lastSkip?: { at: string; reason: string }
}
export type AlertRule = { increases: boolean; decreases: boolean; minAmountMinor: number | null; minBasisPoints: number | null }
export type SeatMinimum = { seats: number | null; excerpt: string; capturedAt: string }
export type Packaging = {
  state: 'changed' | 'needs_review'
  previous: SeatMinimum | null
  current: SeatMinimum | null
  belowMinimum: boolean | null
}
export type PackagingFact =
  | { kind: 'feature'; label: string; included: boolean; excerpt: string; capturedAt: string }
  | { kind: 'allowance'; label: string; limit: number; period: Cadence; excerpt: string; capturedAt: string }
export type PackagingChange = {
  state: 'changed' | 'needs_review'
  previous: PackagingFact | null
  current: PackagingFact | null
}
export type FeatureClaim = { feature: string; state: 'included' | 'excluded' | 'unknown'; excerpt: string | null }
export type WatchInput = {
  vendor: string
  url: string
  plan: string
  currency: Currency
  cadence: Cadence
  seats: number
}
export type ScreenshotImage = { type: 'image/png' | 'image/jpeg'; base64: string }
export type Evidence = {
  snapshotId: string
  sourceUrl: string
  capturedAt: string
  plan: string
  currency: Currency
  cadence: Cadence
  unit: 'seat'
  priceMinor: number
  excerpt: string
  seatMinimum?: SeatMinimum | null
  packagingFacts?: PackagingFact[]
  screenshot?: 'available' | 'unavailable'
}
export type Outcome = 'baseline_ready' | 'unchanged' | 'cosmetic' | 'changed' | 'needs_review' | 'failed'
export type Alert = { state: 'not_applicable' | 'pending' | 'accepted' | 'failed' | 'unknown' | 'disabled' }
export type Context =
  | { state: 'not_applicable' | 'pending' | 'empty' | 'failed' }
  | { state: 'found'; sources: { title: string; url: string; publishedAt: string | null }[] }
export type Impact = {
  old: Evidence
  current: Evidence
  seats: number
  oldTotalMinor: number
  newTotalMinor: number
  deltaMinor: number
  assumptions: string[]
}
export type Check = {
  id: string
  watchId: string
  vendor?: string
  checkedAt: string
  outcome: Outcome
  message: string
  evidence: Evidence | null
  snapshot?: { id: string; markdown: string }
  impact: Impact | null
  packaging?: Packaging
  packagingChanges?: PackagingChange[]
  alertDecision?: { eligible: boolean; reason: string; rule: AlertRule | null }
  contractGap?: ContractGap
  alert: Alert
  context: Context
}
export type Watch = WatchInput & {
  id: string
  revision: number
  status: 'unarmed' | 'armed' | 'paused'
  baseline: Evidence | null
  candidate: Evidence | null
  latest: Check | null
  contract?: ContractTerms | null
  schedule?: Schedule | null
  monitoring?: Monitoring
  alertRule?: AlertRule | null
  reminder?: { state: 'pending' | 'accepted' | 'failed' | 'unknown' | 'expired'; at: string }
  contractGap?: ContractGap
}
export type ContractGap =
  | { state: 'unavailable'; reason: string }
  | { state: 'comparable'; seats: number; currency: Currency; cadence: Cadence; contractMinor: number; listedMinor: number; deltaMinor: number }
export type Comparison = {
  seats: number; currency: Currency; cadence: Cadence
  options: { id: string; vendor: string; plan: string; evidence: Evidence | null; totalMinor: number | null; reason: string | null; stale: boolean; features: FeatureClaim[] }[]
}
export type Portfolio = {
  windowDays: number
  changes: { watchId: string; vendor: string; checkId: string; checkedAt: string; impact: Impact }[]
  renewals: { watchId: string; vendor: string; noticeDate: string; renewalDate: string }[]
  attention: { watchId: string; vendor: string; checkId: string | null; at: string | null; reason: string }[]
  totals: { currency: Currency; cadence: Cadence; deltaMinor: number; watchCount: number }[]
  excluded: { watchId: string; reason: string }[]
}
export type Result<T> = { success: true; data: T } | { success: false; code: string; error: string }
type WatchVersion = { id: string; revision: number }
export type Capabilities = { vendorCapture: boolean; scheduledChecks: boolean; email: boolean; reminders: boolean }
export type ChangeLensActions = {
  getCapabilities: [Record<string, never>, Capabilities]
  createWatch: [WatchInput, Watch]
  listWatches: [Record<string, never>, Watch[]]
  getWatch: [{ id: string }, Watch]
  updateWatch: [WatchInput & WatchVersion, Watch]
  setWatchPaused: [WatchVersion & { paused: boolean }, Watch]
  removeWatch: [WatchVersion, null]
  captureBaseline: [WatchVersion, Watch]
  confirmBaseline: [WatchVersion & { snapshotId: string }, Watch]
  checkWatch: [WatchVersion, Watch]
  listChecks: [{ id: string; before?: string }, { checks: Check[]; nextBefore: string | null }]
  retryAlert: [WatchVersion & { checkId: string }, Watch]
  getScreenshot: [{ id: string; snapshotId: string }, ScreenshotImage]
  setContractTerms: [WatchVersion & { contract: ContractTerms | null }, Watch]
  setWatchSchedule: [WatchVersion & { schedule: Schedule | null }, Watch]
  setAlertRule: [WatchVersion & { rule: AlertRule | null }, Watch]
  compareWatches: [{ ids: string[]; seats: number; currency: Currency; cadence: Cadence; features: string[] }, Comparison]
  getPortfolio: [{ windowDays?: number }, Portfolio]
  getCheck: [{ id: string; checkId: string }, Check]
}
