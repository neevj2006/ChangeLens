export type Cadence = 'month' | 'year'
export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD'
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
}
export type Result<T> = { success: true; data: T } | { success: false; code: string; error: string }
type WatchVersion = { id: string; revision: number }
export type ChangeLensActions = {
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
  getCheck: [{ id: string; checkId: string }, Check]
}
