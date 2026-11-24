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


Confirmed email rejections can be retried through `retryAlert({ id, revision, checkId })`. The action requires the verified demo account and returns the updated watch revision. The saved report identifies the exact delivery. Accepted, pending, unknown and disabled deliveries are ineligible for retry.

## Report tools

Evidence may include screenshot status. Existing reports may omit the field. For available images call `getScreenshot({ id, snapshotId })` with the watch ID and evidence snapshot ID. The authenticated action returns a raster MIME type and base64 bytes. Render privately in the report and keep provider URLs out of the client. Screenshot capture is best effort on the direct Firecrawl v2 path and is available only for new verified evidence.

A changed check may include its captured vendor name. The copy summary uses the saved report and original seat count. For historical records without a captured vendor, use the source hostname. The calculator uses the same integer minor-unit arithmetic and keeps hypothetical amounts local to the page.

## Expanded backend actions

These actions use the normal signed-in action route and owner-scoped watches.

| Action | Behavior |
| --- | --- |
| setContractTerms | Takes id, revision, and contract or null. Returns a watch with the comparable gap or an unavailable reason. A non-null leadDays requires a verified account session. |
| setWatchSchedule | Takes id, revision, and schedule or null. The schedule is daily or weekly at a local hour in an IANA timezone. The watch returns monitoring state with last successful capture, next attempt, failure count, and any budget skip. |
| setAlertRule | Takes id, revision, and rule or null. Both configured thresholds must pass. Dollar thresholds use the saved team total in minor units. Percentage thresholds use basis points and cannot be met from a zero base when a positive percentage is required. |
| compareWatches | Takes two to eight watch IDs, a shared seat count, currency, cadence, and up to 20 must-have features. Returns evidence, comparable cost or a reason, 30-day staleness, and included, excluded, or unknown claims. |
| getPortfolio | Takes optional windowDays, default 30 and maximum 365. Returns the latest transition per current watch, upcoming notice dates, attention items, currency-and-period groups, and exclusions. |

Comparable checks can include contractGap, alertDecision, a dated seat-minimum finding, and packagingChanges for explicitly evidenced feature and allowance changes. Packaging findings do not turn an unchanged listed price into a price change. Scheduled work uses the latest confirmed scope. Missing evidence stays unknown. Monitoring rolls the visible history to 30 checks and retains evidence referenced by those reports or the current baseline.
