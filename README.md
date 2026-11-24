# ChangeLens backend

ChangeLens tracks a selected plan's public per-seat price and reports the impact at the buyer's seat count. The scaffold uses DeepSpace 0.44.2. UI integration types and provider-free examples are linked in [UI_CONTRACT.md](UI_CONTRACT.md).

## Local verification

From this checkout in PowerShell:

```powershell
npm ci
(Get-Content wrangler.toml -Raw).Replace('__APP_ID__', 'app_00000000000000000000000000') |
  Set-Content .wrangler.deepspace.offline.toml
$env:CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH = '.wrangler.deepspace.offline.toml'
npm run type-check
npm run lint
npm run test:unit
npm run build
$env:CHANGELENS_TEST_BROWSER = 'msedge'
node tests/offline-runtime.mjs
Remove-Item Env:CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH
Remove-Item Env:CHANGELENS_TEST_BROWSER
```

Use an installed Playwright Chromium channel or omit the browser variable for the Worker/API suite alone. The fixture ID is for the isolated build and is excluded from Git. The Worker suite uses real local DeepSpace Records, mocked sign-in and mocked provider responses.

## Controlled page

The Worker serves /demo-pricing without sign-in. Its pricing state comes from CHANGELENS_DEMO_VARIANT in wrangler.toml. For the hosted demo, release the baseline variant first, then change and release the variant while keeping the watched URL fixed. Use baseline, increased, cosmetic, failed, and annual for the walkthrough. Reset with baseline. Fixture previews also include wrongPlan, wrongCurrency, repeated and ambiguous.

Live deployment requires a ChangeLens registration and the intended app slug. Before any authorized live call, configure CHANGELENS_PRICING_URL to the exact public HTTPS URL of the controlled pricing route. The capture flow is restricted to that configured pricing page and rejects failed or redirected preflight requests for an external controlled page. The built-in pricing route serves a response directly. Each scrape adds a check-specific query parameter to avoid reusing the same provider cache key. Evidence links retain the configured URL. Enable CHANGELENS_ENABLE_CAPTURE for Firecrawl and OpenAI, CHANGELENS_ENABLE_EMAIL for transactional delivery, and CHANGELENS_ENABLE_EXA for context after authorization. All four integrations charge the app developer. Live email recipients come from the verified DeepSpace account.

| Integration | Published contract and current verification |
| --- | --- |
| Firecrawl | firecrawl/scrape accepts url, formats, onlyMainContent and timeout. Catalog output exposes data, creditsUsed and costUsd. The adapter expects Markdown and source URL in the provider data. Live envelope and scrape behavior remain open. |
| OpenAI | openai/chat-completion accepts messages, model, max_tokens and temperature. The advertised gpt-4.1-mini model uses the Chat Completions response shape previously exercised by Handoff Check. ChangeLens validates the JSON and the exact associated plan-card text. |
| Transactional email | email/send accepts a recipient, subject and plain text. Catalog price is $0.013 per request. Handoff Check verified a provider ID and inbox receipt from DeepSpace Apps. ChangeLens has verified the request and acceptance state with a mock. |
| Exa | exa/search accepts query, numResults, type and contents. Catalog results include title, URL and publication date. ChangeLens checks vendor and pricing-change relevance. The mock verifies unrelated results are dropped. A real-vendor result remains open. |

## Demo limits

The current backend supports Markdown pricing cards with a standalone per-seat price and tables whose price columns explicitly identify currency, unit and billing period. Unsupported layouts and ambiguous cards require review. Watch history retains up to 30 checks per watch. A timed-out or interrupted email is surfaced as unknown and stays reserved. The verified demo account can explicitly retry a confirmed rejection through the retryAlert server action.



## Screenshot citations

A screenshot can sit alongside each text citation with its captured timestamp and original URL. Capturing both the baseline and later check is necessary to show how the page looked at each time. A later screenshot cannot reconstruct the old page. Store verified image bytes in owner-scoped storage if the provider returns a usable asset. Keep comparison and cost calculations grounded in the exact stored text. Screenshots are a possible follow-up. The current DeepSpace catalog accepts a format list, but ChangeLens has yet to verify screenshot support, asset lifetime, or billing through that integration. [Firecrawl scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape)


### Firecrawl v2 connection

CHANGELENS_FIRECRAWL_MODE=direct calls Firecrawl v2 from the authenticated Worker action. It uses Firecrawl keyless access by default and requests a fresh scrape. If keyless access is limited on the Worker network, the owner can configure FIRECRAWL_API_KEY as a DeepSpace secret. Gateway mode remains available by omitting CHANGELENS_FIRECRAWL_MODE. The direct path still uses Firecrawl, with DeepSpace handling hosting, authentication, records, and the other three integrations. [Firecrawl Keyless documentation](https://www.firecrawl.dev/blog/firecrawl-keyless-launch)

## Submission walkthrough

[Open ChangeLens](https://changelens.app.space/home) · [Controlled pricing page](https://changelens.app.space/demo-pricing)

ChangeLens shows software buyers what a public subscription price change means at their seat count. It stores exact pricing evidence so a buyer can compare the offers and check their contract. The app uses DeepSpace Auth, Records and server actions, Firecrawl v2 for fresh snapshots, OpenAI for pricing facts, DeepSpace email for transaction alerts, and Exa for related public context.

1. Sign in as the demo owner and set up Alder Desk Pro at 10 seats, USD, monthly on the controlled pricing page.
2. With the page on baseline, capture and confirm $29 per seat. Advance the hosted pricing variant to increased.
3. Check now. The report shows $290 to $390, +$100 per month, both dated excerpts and the source URL.
4. Refresh the report to see email provider acceptance and Exa context. Verify inbox receipt independently.
5. Repeat the check with the page still at $39. The result should be unchanged. The cosmetic, failed and annual variants can then be tested in that order.
6. To stage a fresh walkthrough, restore the baseline variant and create a fresh watch before advancing the page again. Leave email disabled until another test send is authorized.

The live walkthrough verified the cost change, both excerpts, saved history, one inbox receipt and an unchanged repeat without another send in the billing ledger. Exa search settled for that report. Separate live testing returned Atlassian pricing links. The cosmetic page was deployed and its formatting was verified in the raw Firecrawl Markdown.

