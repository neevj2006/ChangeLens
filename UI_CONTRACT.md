# ChangeLens UI contract

Import the request and response types from `src/changelens/contract.ts` and the provider-free examples from `src/changelens/fixtures.ts`. These are usable for UI development now. See the action registry for endpoints currently implemented.

Send JSON to `POST /api/actions/<name>` with the signed-in DeepSpace bearer token and same-origin session. Successful actions return `{ success: true, data }`. Business errors return `{ success: false, code, error }`. Handle HTTP 401 separately as signed out. Render evidence excerpts as text.

| Interaction | Action and response |
| --- | --- |
| Setup | `createWatch(input)` saves settings and returns the unarmed watch. `captureBaseline({ id, revision })` returns a watch with its latest check and a candidate when evidence passes. |
| Confirm or rebaseline | Show the candidate and call `confirmBaseline({ id, revision, snapshotId })` with the displayed values. Confirmation replaces the active baseline and arms the watch. |
| Dashboard | `listWatches({})` and `getWatch({ id })` return watch summaries. |
| Manage | `updateWatch` takes complete settings plus the current ID and revision. Vendor, URL, plan, currency or cadence edits invalidate the active baseline. Seat-only changes apply to future checks. `setWatchPaused` takes the desired paused state. `removeWatch` takes ID and revision. |
| Check now | `checkWatch({ id, revision })` returns the updated watch. A persisted scrape failure is a successful action with `latest.outcome = 'failed'`. |
| History | `listChecks({ id, before? })` returns newest first. Replay its opaque `nextBefore` verbatim for the next page. `getCheck({ id, checkId })` refreshes a report, its alert and context, and its captured Markdown when available. |

All amounts are integer minor units for the supported currencies. Render the signed delta per month or year from the evidence cadence. The baseline stays visible while the impact uses the previous comparable price. Show older checks using the seat count in their own impact.

Render `needs_review` as **Needs review** and show the supplied reason. A stale revision means reload the watch. Use the revision in the latest response for each mutation. Alert acceptance is provider acceptance. Show unknown delivery as requiring review. A pending alert or context can be refreshed by reading the check. Render empty context as **No relevant context found**. Cited links provide possible context for the change.

For the demo, use Alder Desk Pro, USD, monthly, 10 seats. The fixtures cover baseline confirmation, $290 → $390, +$100/month, saved history, unchanged and cosmetic checks, an annual offer and a scrape error.

