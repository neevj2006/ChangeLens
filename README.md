# ChangeLens

ChangeLens helps software buyers understand what a vendor's public subscription price change means for their team. Create a private watch for a plan, confirm the starting price, and compare later captures at your seat count. Reports preserve the old and new pricing evidence so you can verify the change and decide what to review before renewal.

[Open ChangeLens](https://changelens.app.space/home) · [Demo pricing page](https://changelens.app.space/demo-pricing) · [Action and UI contract](UI_CONTRACT.md)

## Core features

| Feature | What it does |
| --- | --- |
| **Private pricing watches** | Track a public pricing URL, plan, currency, billing period, and seat count. Capture and confirm a baseline, then keep a history of checks. |
| **Evidence and cost impact** | See the previous and current price, dated excerpts, source links, and privately saved screenshots when available. Get the listed team totals and the difference per billing period. |
| **AI guidance** | OpenAI automatically explains ambiguous results when it has enough evidence. A usable AI-interpreted price carries an uncertainty label and can be used for a confirmed baseline or a comparable price alert. If the model returns neither useful guidance nor a usable price, the report shows **Needs review**. |
| **Manual and scheduled checks** | Check on demand or set a daily or weekly schedule in your timezone. Pause and resume a watch, see the last successful check and next scheduled time, and review failures. |
| **Price alerts and public context** | Choose increases, decreases, and optional team-cost and percentage thresholds. Qualifying changes can send an email to your verified address. Exa looks for related announcements and links relevant sources when available. |
| **Contract and renewal tracking** | Record your contracted rate, renewal date, and cancellation notice deadline. See the contract-to-list gap when the rates are comparable, and optionally get a reminder before the notice deadline. |
| **Packaging changes** | See dated before-and-after evidence for supported changes to seat minimums, named features, and usage allowances, even when the listed price stays the same. |
| **Report tools** | Copy a summary with the original totals and evidence, or try another team size in the calculator while keeping the saved report intact. |
| **Plan comparison and portfolio** | Compare watched plans at a common seat count, currency, and billing period. See evidence dates and must-have feature status. The portfolio brings together recent changes, upcoming renewals, and watches needing attention, with listed cost impacts grouped by currency and period. |

## Workflow

1. **Add a watch.** Sign in and enter the vendor, pricing URL, exact plan name, currency, billing period, and seat count.
2. **Capture and confirm the baseline.** Review the extracted price and its excerpt. Open the screenshot if one was saved. Confirm the baseline to arm the watch. If the price couldn't be established, read the AI guidance or review status and check the source before trying again.
3. **Set your preferences.** Optionally add a daily or weekly schedule, choose alert directions and thresholds, and save contract terms with a renewal reminder. If you set both alert thresholds, both must be met.
4. **Run a check.** Click **Check now** or let the schedule run. ChangeLens saves the result in **Check history**. Failed captures and incomparable offers leave the last comparable price intact. Packaging findings can appear independently of a price change.
5. **Review and share the impact.** Open the report to inspect both excerpts, screenshots, the email status, and any Exa context. Use **Copy summary** to share the saved numbers or the calculator to explore a different seat count.
6. **Decide what to review.** Compare alternatives or open Portfolio to see which changes and notice dates deserve attention. Check your contract before treating a public-price change as a change to your bill.

### Controlled walkthrough

Use **Alder Desk · Pro · USD · Monthly · 10 seats** with the [demo pricing page](https://changelens.app.space/demo-pricing). The deployment operator sets the page to the baseline variant, then the buyer captures and confirms **$29 per seat per month**. After the operator deploys the increased variant at the same URL, **Check now** produces **$290 → $390**, or **+$100/month**. At 25 seats, the calculator shows **$725 → $975**, or **+$250/month**.

The live walkthrough verified both screenshots, the copied summary, the calculator, and delivery of one test price-change email. Repeating the same price, changing only formatting, an unavailable page, and switching to annual billing produced no additional price alert. The demo variants are configured with `CHANGELENS_DEMO_VARIANT` in [wrangler.toml](wrangler.toml). Restore `baseline` to stage a fresh walkthrough.

## Pricing and capture scope

ChangeLens compares flat per-seat offers when the plan, currency, and billing period match. Base fees combined with optional seats, usage-based pricing, annual-billing equivalents, and regional variants may need separate interpretation or stay unverified. Public listed costs exclude taxes and account-specific contract terms.

The controlled page uses Firecrawl v2 and can return screenshots with the pricing text. Real vendor URLs use an authenticated Node fetch service that validates public DNS destinations and pins the connection on each redirect. That service reads server-rendered HTML or text, caps responses at 2 MiB, and does not produce screenshots. Pages that require JavaScript or exceed capture limits may need review. Watch history retains the most recent 30 checks and preserves evidence referenced by the baseline and retained reports.

## Development

The main app uses React, TypeScript, Vite, and DeepSpace. DeepSpace provides authentication, records, server actions, and Worker hosting. Watch Durable Objects store private screenshots, serialize checks, and schedule background work. OpenAI handles extraction and review guidance. Exa supplies related context and DeepSpace transactional email delivers alerts and reminders.

Use Node 22.15+ on the 22 line, Node 24, or Node 26, with npm 11.6+.

```sh
npm ci
npm run login
npm run dev
```

For local verification, build the app and run the Worker suite with simulated provider responses. The browser variable is optional and can be set to another installed Playwright Chromium channel.

```powershell
npm run type-check
npm run lint
npm run test:unit
node --test services/pricing-egress.test.mjs
npm run build
$env:CHANGELENS_TEST_FIRECRAWL = 'direct'
$env:CHANGELENS_TEST_BROWSER = 'msedge'
node tests/offline-runtime.mjs
Remove-Item Env:CHANGELENS_TEST_FIRECRAWL, Env:CHANGELENS_TEST_BROWSER
```

### Deployment configuration

- **DeepSpace.** Use your own app registration and deployment settings if you fork the project. Configure the demo URL and capture settings in `wrangler.toml`. Direct Firecrawl mode can use keyless access or a server-side `FIRECRAWL_API_KEY`.
- **Vendor capture.** Run [services/pricing-egress.mjs](services/pricing-egress.mjs) behind HTTPS. Set `CHANGELENS_VENDOR_EGRESS_URL` to its origin and configure matching `CHANGELENS_EGRESS_TOKEN` values in the service environment and DeepSpace secrets. The public testing release used temporary Vercel hosting for this service.
- **Scheduled work and email.** Deployment flags control scheduled checks, price-change emails, renewal reminders, and Exa. Deployments can also set account and app-wide daily provider-work limits or explicitly enable uncapped mode. Provider limits and billing still apply. Email is addressed to the verified account.
