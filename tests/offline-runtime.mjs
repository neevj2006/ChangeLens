import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { exportSPKI, generateKeyPair, SignJWT } from 'jose'
import { chromium } from '@playwright/test'

const config = JSON.parse(await readFile('dist/changelens/wrangler.json', 'utf8'))
const issuer = 'https://changelens-offline.test'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxZkAAAAASUVORK5CYII=', 'base64')
const screenshotOrigin = 'https://storage.googleapis.com/changelens-fixture/'
let screenshotMode = 'available'
const pricingUrl = 'https://alderdesk.com/demo-pricing'
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
const tokenFor = sub => new SignJWT({}).setProtectedHeader({ alg: 'ES256' })
  .setIssuer(issuer).setSubject(sub).setExpirationTime('5m').sign(privateKey)
const owner = 'fixture-owner'
const [ownerToken, otherToken] = await Promise.all([tokenFor(owner), tokenFor('fixture-other')])
const calls = []
const direct = process.env.CHANGELENS_TEST_FIRECRAWL === 'direct'
let amount = 29
let cosmetic = false
let annual = false
let scrapeFails = false
let deliveryUnknown = false
let deliveryRejected = false
let incompleteModel = false
let vendorMinimum = 5
let vendorUnsupported = false
let vendorOversized = false
const runtime = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1',
  modules: true,
  scriptPath: 'dist/changelens/index.js',
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags,
  bindings: {
    ...config.vars,
    CHANGELENS_DEMO_VARIANT: 'baseline',
    OWNER_USER_ID: owner, APP_OWNER_JWT: 'mock-billing',
    AUTH_JWT_PUBLIC_KEY: await exportSPKI(publicKey), AUTH_JWT_ISSUER: issuer,
    AUTH_WORKER_URL: issuer,
    CHANGELENS_PRICING_URL: pricingUrl, CHANGELENS_ENABLE_CAPTURE: 'true',
    CHANGELENS_FIRECRAWL_MODE: direct ? 'direct' : 'gateway',
    CHANGELENS_VENDOR_EGRESS_URL: 'https://egress.example.org',
    CHANGELENS_EGRESS_TOKEN: 'offline-egress',
    CHANGELENS_ENABLE_SCHEDULES: 'true',
    CHANGELENS_ACCOUNT_DAILY_LIMIT: '7',
    CHANGELENS_APP_DAILY_LIMIT: '8',
    CHANGELENS_ENABLE_EMAIL: 'true', CHANGELENS_ENABLE_EXA: 'true',
  },
  outboundService: async request => {
    if (request.url === 'https://egress.example.org/capture') {
      assert.equal(request.headers.get('authorization'), 'Bearer offline-egress')
      const { url } = await request.json()
      if (vendorOversized) return Response.json({ code: 'unsupported_page' }, { status: 415 })
      assert.match(url, /^https:\/\/[a-z]+\.example\.org\/pricing$/)
      const price = vendorUnsupported ? 'Contact sales' : 'USD $' + amount + ' per seat per month'
      return Response.json({ url, markdown: '# Vendor\n\n## Pro\n\n' + price +
        '\n\n- Minimum ' + vendorMinimum + ' seats\n- Includes SSO' })
    }
    if (request.url.startsWith(screenshotOrigin)) {
      if (screenshotMode === 'invalid') return new Response('<html>', { headers: { 'content-type': 'text/html' } })
      if (screenshotMode === 'oversized') return new Response(png, {
        headers: { 'content-type': 'image/png', 'content-length': String(1024 * 1024 + 1) },
      })
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    }
    if (request.url === 'https://api.firecrawl.dev/v2/scrape') {
      assert.equal(direct, true)
      assert.equal(request.headers.get('authorization'), null)
      const body = await request.json()
      assert.equal(body.url, pricingUrl)
      assert.equal(body.maxAge, 0)
      assert.equal(body.storeInCache, false)
      if (scrapeFails) return new Response(null, { status: 402 })
      const price = annual ? 'USD $468 per seat per year (USD $39 per seat per month equivalent)' : 'USD $' + amount + ' per seat per month'
      return Response.json({ success: true, data: {
        markdown: '# Alder Desk\n\n## Pro\n\n' + (cosmetic ? '**' + price + '**' : price),
        metadata: { url: pricingUrl, statusCode: 200 },
        screenshot: screenshotOrigin + amount + '.png',
      } })
    }
    if (request.url.startsWith(pricingUrl + '?changelens_check=') && request.method === 'HEAD') return new Response(null)
    if (request.url === issuer + '/api/auth/get-session') {
      return Response.json({ user: { id: owner, email: 'owner@example.test', emailVerified: true } })
    }
    return new Response(null, { status: 404 })
  },
  durableObjects: Object.fromEntries(config.durable_objects.bindings.map(value => [
    value.name, { className: value.class_name, useSQLite: true },
  ])),
  serviceBindings: {
    ASSETS: async request => {
      const path = new URL(request.url).pathname
      const file = path === '/' ? 'index.html' : path === '/_spa' ? '_spa.html' : /^\/assets\/[\w.-]+$/.test(path) ? path.slice(1) : null
      if (!file) return new Response(null, { status: 404 })
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'
      return new Response(await readFile('dist/client/' + file), { headers: { 'Content-Type': type } })
    },
    API_WORKER: async request => {
      const path = new URL(request.url).pathname
      const endpoint = path.split('/').at(-1)
      const body = await request.json()
      assert.equal(request.headers.get('authorization'), 'Bearer mock-billing')
      calls.push({ endpoint, body })
      let data
      if (endpoint === 'scrape') {
        assert.match(body.url, /\?changelens_check=[0-9a-f-]+$/)
        assert.equal(body.url.split('?')[0], pricingUrl)
        if (scrapeFails) return Response.json({ success: false, error: 'fixture scrape failure' }, { status: 502 })
        const price = annual ? 'USD $468 per seat per year (USD $39 per seat per month equivalent)' : 'USD $' + amount + ' per seat per month'
        data = { markdown: '# Alder Desk\n\n## Pro\n\n' + (cosmetic ? '**' + price + '**' : price), metadata: { sourceURL: body.url, statusCode: 200 } }
      } else if (endpoint === 'chat-completion') {
        assert.equal(body.model, 'gpt-4.1-mini')
        if (incompleteModel) return Response.json({ success: true, data: { choices: [] } })
        const source = JSON.parse(body.messages[1].content).source
        data = { choices: [{ finish_reason: 'stop', message: { content: String.fromCharCode(96).repeat(3) + 'json\n' + JSON.stringify({
          plan: 'Pro', currency: 'USD', cadence: 'month', unit: 'seat',
          priceMinor: amount * 100, excerpt: source.slice(source.indexOf('## Pro')),
        }) + '\n' + String.fromCharCode(96).repeat(3) } }] }
      } else if (endpoint === 'send') {
        if (deliveryRejected) return Response.json({ success: false, error: 'rejected' }, { status: 422 })
        if (deliveryUnknown) return Response.json({ success: false, error: 'ambiguous' }, { status: 502 })
        data = { id: 'fixture-delivery' }
      } else if (endpoint === 'search') {
        data = { results: [{ title: 'Unrelated pricing changes', url: 'https://unrelated.com/', publishedDate: null }] }
      } else throw new Error('Unexpected integration ' + path)
      return Response.json({ success: true, data })
    },
  },
}))

async function post(name, body = {}, token = ownerToken) {
  const response = await runtime.dispatchFetch('http://localhost/api/actions/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  })
  return response.json()
}
async function ok(name, body) {
  const result = await post(name, body)
  assert.equal(result.success, true, JSON.stringify(result))
  return result.data
}

try {
  assert.equal((await post('listWatches', {}, 'invalid')).error, 'Unauthorized')
  assert.deepEqual(await ok('listWatches'), [])
  const input = { vendor: 'Alder Desk', url: pricingUrl, plan: 'Pro', currency: 'USD', cadence: 'month', seats: 10 }
  assert.equal((await post('createWatch', { ...input, seats: 0 })).code, 'invalid_input')
  let watch = await ok('createWatch', input)
  const key = () => ({ id: watch.id, revision: watch.revision })
  assert.equal((await post('getWatch', key(), otherToken)).code, 'not_found')
  assert.equal((await post('removeWatch', key(), otherToken)).code, 'not_found')
  assert.deepEqual((await post('listWatches', {}, otherToken)).data, [])
  assert.equal((await post('checkWatch', key())).code, 'not_armed')
  watch = await ok('captureBaseline', key())
  assert.equal(watch.candidate.priceMinor, 2900)
  assert.equal((await post('confirmBaseline', { ...key(), snapshotId: 'wrong' })).code, 'stale_candidate')
  const confirmation = { ...key(), snapshotId: watch.candidate.snapshotId }
  watch = await ok('confirmBaseline', confirmation)
  assert.equal((await post('confirmBaseline', confirmation)).code, 'stale_revision')
  assert.equal((await ok('getWatch', key())).baseline.priceMinor, 2900)

  amount = 39
  const results = await Promise.all([post('checkWatch', key()), post('checkWatch', key())])
  assert.equal(results.filter(result => result.success).length, 1)
  assert.equal(results.find(result => !result.success).code, 'stale_revision')
  watch = results.find(result => result.success).data
  assert.equal(watch.latest.outcome, 'changed')
  assert.equal(watch.latest.impact.oldTotalMinor, 29000)
  assert.equal(watch.latest.impact.newTotalMinor, 39000)
  assert.equal(watch.latest.impact.deltaMinor, 10000)
  let changed = await ok('getCheck', { ...key(), checkId: watch.latest.id })
  for (let i = 0; i < 25 && (changed.alert.state === 'pending' || changed.context.state === 'pending'); i++) {
    await new Promise(resolve => setTimeout(resolve, 30))
    changed = await ok('getCheck', { ...key(), checkId: watch.latest.id })
  }
  if (direct) {
    assert.equal(changed.impact.old.screenshot, 'available')
    assert.equal(changed.impact.current.screenshot, 'available')
    assert.notEqual(changed.impact.old.snapshotId, changed.impact.current.snapshotId)
    const shot = { id: watch.id, snapshotId: changed.impact.current.snapshotId }
    assert.deepEqual(await ok('getScreenshot', shot), { type: 'image/png', base64: png.toString('base64') })
    assert.equal((await post('getScreenshot', shot, otherToken)).code, 'not_found')
  }
  assert.equal(changed.alert.state, 'accepted')
  assert.equal(changed.context.state, 'empty')
  assert.match(calls.find(call => call.endpoint === 'send').body.text, /\+\$100\.00\/month/)
  assert.equal(calls.find(call => call.endpoint === 'send').body.to, 'owner@example.test')

  watch = await ok('checkWatch', key())
  assert.equal(watch.latest.outcome, 'unchanged')
  cosmetic = true
  watch = await ok('checkWatch', key())
  assert.equal(watch.latest.outcome, 'cosmetic')
  scrapeFails = true
  watch = await ok('checkWatch', key())
  assert.equal(watch.latest.outcome, 'failed')
  scrapeFails = cosmetic = false
  annual = true
  watch = await ok('checkWatch', key())
  assert.equal(watch.latest.outcome, 'needs_review')
  assert.equal(watch.baseline.priceMinor, 2900)
  const { checks } = await ok('listChecks', key())
  assert.equal(checks.length, 6)
  assert.equal(calls.filter(call => call.endpoint === 'send').length, 1)
  assert.equal(calls.filter(call => call.endpoint === 'chat-completion').length, 3)

  annual = false
  amount = 29
  deliveryUnknown = true
  const formerRevision = key()
  watch = await ok('updateWatch', { ...input, ...key(), seats: 8 })
  assert.equal(watch.baseline.priceMinor, 2900)
  assert.equal((await post('checkWatch', formerRevision)).code, 'stale_revision')
  watch = await ok('setWatchPaused', { ...key(), paused: true })
  assert.equal((await post('checkWatch', key())).code, 'not_armed')
  watch = await ok('setWatchPaused', { ...key(), paused: false })
  watch = await ok('checkWatch', { ...key(), recipient: 'unexpected@example.test' })
  assert.equal(watch.latest.impact.deltaMinor, -8000)
  const decreaseId = watch.latest.id
  watch = await ok('checkWatch', key())
  assert.equal(watch.latest.outcome, 'unchanged')
  const decrease = await ok('getCheck', { ...key(), checkId: decreaseId })
  assert.equal(decrease.alert.state, 'unknown')
  assert.equal(calls.filter(call => call.endpoint === 'send').length, 2)
  assert.equal(calls.filter(call => call.endpoint === 'send').at(-1).body.to, 'owner@example.test')
  assert.equal((await post('retryAlert', { ...key(), checkId: decreaseId })).code, 'retry_unavailable')
  deliveryUnknown = false
  amount = 38
  incompleteModel = true
  watch = await ok('checkWatch', key())
  assert.equal(watch.latest.outcome, 'failed')
  assert.match(watch.latest.message, /extraction did not complete/)
  assert.equal(calls.filter(call => call.endpoint === 'send').length, 2)
  incompleteModel = false
  screenshotMode = 'invalid'
  deliveryRejected = true
  watch = await ok('checkWatch', key())
  const rejectedId = watch.latest.id
  assert.equal(watch.latest.evidence.screenshot, 'unavailable')
  // A serial action waits for the saved delivery result before using the revision.
  assert.equal((await post('retryAlert', { ...key(), revision: 1, checkId: rejectedId })).code, 'stale_revision')
  assert.equal((await ok('getCheck', { ...key(), checkId: rejectedId })).alert.state, 'failed')
  deliveryRejected = false
  const retry = await Promise.all([
    post('retryAlert', { ...key(), checkId: rejectedId }), post('retryAlert', { ...key(), checkId: rejectedId }),
  ])
  assert.equal(retry.filter(result => result.success).length, 1)
  watch = retry.find(result => result.success).data
  assert.equal((await ok('getCheck', { ...key(), checkId: rejectedId })).alert.state, 'accepted')
  assert.equal(calls.filter(call => call.endpoint === 'send').length, 4)
  amount = 29
  const original = await ok('getCheck', { ...key(), checkId: changed.id })
  assert.equal(original.impact.seats, 10)
  if (direct) {
    screenshotMode = 'oversized'
    watch = await ok('captureBaseline', key())
    assert.equal(watch.candidate.screenshot, 'unavailable')
  }
  watch = await ok('updateWatch', { ...input, ...key(), plan: 'Team' })
  assert.equal(watch.baseline, null)
  assert.equal(watch.status, 'unarmed')
  await ok('removeWatch', key())
  assert.equal((await post('getScreenshot', { id: watch.id, snapshotId: changed.impact.current.snapshotId })).code, 'not_found')
  screenshotMode = 'available'
  assert.deepEqual(await ok('listWatches'), [])

  const vendorInput = { ...input, url: 'https://vendor.example.org/pricing' }
  const alternativeInput = { ...input, vendor: 'Another vendor', url: 'https://another.example.org/pricing' }
  let vendorWatch = await ok('createWatch', vendorInput)
  const v = () => ({ id: vendorWatch.id, revision: vendorWatch.revision })
  vendorWatch = await ok('captureBaseline', v())
  assert.equal(vendorWatch.candidate.seatMinimum.seats, 5)
  vendorWatch = await ok('confirmBaseline', { ...v(), snapshotId: vendorWatch.candidate.snapshotId })
  vendorWatch = await ok('setContractTerms', { ...v(), contract: {
    priceMinor: 2500, currency: 'USD', cadence: 'month', renewalDate: '2026-12-23',
    noticeDate: '2026-12-01', timezone: 'America/New_York', leadDays: null,
  } })
  assert.equal(vendorWatch.contractGap.deltaMinor, 4000)
  vendorWatch = await ok('setWatchSchedule', { ...v(), schedule: {
    timezone: 'America/New_York', hour: 9, frequency: 'weekly',
  } })
  assert.ok(Date.parse(vendorWatch.monitoring.nextAt) > Date.now())
  vendorWatch = await ok('setAlertRule', { ...v(), rule: {
    increases: true, decreases: false, minAmountMinor: 15000, minBasisPoints: null,
  } })
  vendorMinimum = 12
  vendorWatch = await ok('checkWatch', v())
  assert.equal(vendorWatch.latest.outcome, 'unchanged')
  assert.equal(vendorWatch.latest.packaging.current.seats, 12)
  assert.equal(vendorWatch.latest.packaging.belowMinimum, true)
  amount = 39
  vendorWatch = await ok('checkWatch', v())
  assert.equal(vendorWatch.latest.impact.deltaMinor, 10000)
  assert.equal(vendorWatch.latest.alertDecision.eligible, false)
  assert.equal(vendorWatch.latest.contractGap.deltaMinor, 14000)
  vendorUnsupported = true
  vendorWatch = await ok('checkWatch', v())
  assert.equal(vendorWatch.latest.outcome, 'needs_review')
  vendorUnsupported = false
  vendorOversized = true
  vendorWatch = await ok('checkWatch', v())
  assert.equal(vendorWatch.latest.outcome, 'needs_review')
  assert.match(vendorWatch.latest.message, /supported capture size/)
  vendorOversized = false
  let alternative = await ok('createWatch', alternativeInput)
  alternative = await ok('captureBaseline', { id: alternative.id, revision: alternative.revision })
  alternative = await ok('confirmBaseline', {
    id: alternative.id, revision: alternative.revision, snapshotId: alternative.candidate.snapshotId,
  })
  const comparisonInput = {
    ids: [vendorWatch.id, alternative.id], seats: 25, currency: 'USD', cadence: 'month',
    features: ['SSO', 'SCIM'],
  }
  const comparison = await ok('compareWatches', comparisonInput)
  assert.equal(comparison.options[0].totalMinor, 97500)
  assert.equal(comparison.options[0].features[0].state, 'included')
  assert.equal(comparison.options[0].features[1].state, 'unknown')
  assert.equal((await ok('compareWatches', { ...comparisonInput, currency: 'EUR' })).options[0].totalMinor, null)
  assert.equal((await post('compareWatches', comparisonInput, otherToken)).code, 'not_found')
  const portfolio = await ok('getPortfolio')
  assert.deepEqual(portfolio.totals, [{ currency: 'USD', cadence: 'month', deltaMinor: 10000, watchCount: 1 }])
  assert.equal(portfolio.attention[0].watchId, vendorWatch.id)
  assert.equal((await post('getPortfolio', {}, otherToken)).data.changes.length, 0)
  const dateAhead = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  vendorWatch = await ok('setContractTerms', { ...v(), contract: {
    priceMinor: 2500, currency: 'USD', cadence: 'month', renewalDate: dateAhead(20),
    noticeDate: dateAhead(1), timezone: 'UTC', leadDays: 2,
  } })
  for (let i = 0; i < 30 && vendorWatch.reminder?.state !== 'accepted'; i++) {
    await new Promise(resolve => setTimeout(resolve, 150))
    vendorWatch = await ok('getWatch', { id: vendorWatch.id })
  }
  assert.equal(vendorWatch.reminder?.state, 'accepted')
  vendorWatch = await ok('setContractTerms', { ...v(), contract: { ...vendorWatch.contract, leadDays: 3 } })
  assert.equal(vendorWatch.reminder?.state, 'accepted')
  assert.equal((await post('checkWatch', v())).code, 'budget_limit')
  const buyer = (await post('createWatch', alternativeInput, otherToken)).data
  const buyerCapture = await post('captureBaseline', { id: buyer.id, revision: buyer.revision }, otherToken)
  assert.equal(buyerCapture.data.candidate.priceMinor, 3900)
  assert.equal((await post('captureBaseline', {
    id: buyer.id, revision: buyerCapture.data.revision,
  }, otherToken)).code, 'budget_limit')
  assert.equal((await post('removeWatch', { id: buyer.id, revision: buyerCapture.data.revision }, otherToken)).success, true)
  assert.equal(calls.filter(call => call.endpoint === 'send').length, 5)
  await ok('removeWatch', v())
  await ok('removeWatch', { id: alternative.id, revision: alternative.revision })
  amount = 29
  const demo = await runtime.dispatchFetch('http://localhost/demo-pricing')
  assert.equal(demo.status, 200)
  assert.match(await demo.text(), /USD \$29 per seat per month/)
  if (process.env.CHANGELENS_TEST_BROWSER) {
    const browser = await chromium.launch({ channel: process.env.CHANGELENS_TEST_BROWSER })
    try {
      const page = await browser.newPage()
      const base = await runtime.ready
      await page.goto(new URL('/demo-pricing', base).href)
      assert.equal(await page.getByRole('heading', { name: 'Pro' }).count(), 1)
      assert.equal(await page.getByText('USD $29 per seat per month', { exact: true }).count(), 1)
      await page.goto(base.href)
      assert.equal(await page.getByTestId('static-landing').count(), 1)
      const home = new URL('/home', base).href
      await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }))
      await page.goto(home)
      await page.getByText('Use Sign in in the navigation to create a private watch.').waitFor()
      await page.unroute('**/api/auth/get-session')
      await page.route('**/api/auth/get-session', route => route.fulfill({ json: {
        session: { id: 'fixture-session', userId: owner, expiresAt: new Date(Date.now() + 3600000).toISOString() },
        user: { id: owner, name: 'Fixture Owner', email: 'owner@example.test', emailVerified: true },
      } }))
      await page.route('**/api/auth/token', route => route.fulfill({ json: { token: ownerToken } }))
      await page.goto(home)
      const add = page.getByRole('button', { name: 'Add watch', exact: true })
      await add.waitFor()
      await add.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Tab')
      assert.equal(await page.getByLabel('Vendor', { exact: true }).evaluate(el => el === document.activeElement), true)
      const audit = async () => {
        await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') })
        const failures = await page.evaluate(async () => (await window.axe.run()).violations.map(rule =>
          ({ id: rule.id, nodes: rule.nodes.map(node => node.target) })))
        assert.deepEqual(failures, [])
      }
      await audit()
      await page.getByLabel('Vendor', { exact: true }).fill('Alder Desk')
      await page.getByLabel('Pricing URL').fill(pricingUrl)
      await page.getByLabel('Plan', { exact: true }).fill('Pro')
      await page.getByRole('button', { name: 'Save watch' }).click()
      await page.getByRole('button', { name: 'Capture baseline', exact: true }).click()
      await page.getByRole('button', { name: 'Confirm baseline and arm' }).click()
      await page.getByRole('heading', { name: 'Confirmed baseline' }).waitFor()
      amount = 39
      deliveryUnknown = false
      await page.getByRole('button', { name: 'Check now' }).click()
      await page.getByText('+$100.00/month for 10 seats', { exact: true }).waitFor()
      const report = page.getByRole('region', { name: 'Check report' })
      await report.getByText('USD $29 per seat per month', { exact: false }).waitFor()
      await report.getByText('USD $39 per seat per month', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Refresh report' }).click()
      await report.getByText('No relevant context found').waitFor()
      await report.getByText('Accepted by email provider', { exact: false }).waitFor()
      if (direct) {
        await report.getByRole('button', { name: 'Show screenshot', exact: true }).first().click()
        await report.getByRole('img', { name: /Pricing page captured for Pro/ }).waitFor()
      }
      const callsBeforeCalculator = calls.length
      await report.getByLabel('Hypothetical seats').fill('25')
      await report.getByText(/\$725\.00 → \$975\.00.*\+\$250\.00\/month/).waitFor()
      await report.getByLabel('Hypothetical seats').fill('0')
      await report.getByText(/Enter a whole seat count/).waitFor()
      assert.equal(calls.length, callsBeforeCalculator)
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: text => { window.fixtureClipboard = text; return Promise.resolve() },
      } }))
      await report.getByRole('button', { name: 'Copy summary', exact: true }).click()
      await report.getByText('Impact summary copied.').waitFor()
      assert.match(await page.evaluate(() => window.fixtureClipboard), /10 seats/)
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: () => Promise.reject(new Error('fixture clipboard unavailable')),
      } }))
      await report.getByRole('button', { name: 'Copy summary', exact: true }).click()
      const summary = await report.getByLabel('Copy the summary below').inputValue()
      assert.match(summary, /\$290\.00 → \$390\.00 \(\+\$100\.00\/month\)/)
      assert.match(summary, /10 seats/)
      await page.reload()
      await page.getByRole('button', { name: /Alder Desk · Pro.*Price changed/ }).click()
      await page.getByText('+$100.00/month for 10 seats', { exact: true }).waitFor()
      await page.route('**/api/actions/getCheck', async route => {
        const response = await route.fetch()
        const body = await response.json()
        body.data.impact.current.excerpt += '\n' + 'x'.repeat(500)
        body.data.snapshot.markdown += '\n' + 'y'.repeat(500)
        body.data.packaging = {
          state: 'changed', belowMinimum: true,
          previous: { seats: 5, excerpt: 'Minimum 5 seats', capturedAt: body.data.impact.old.capturedAt },
          current: { seats: 12, excerpt: 'Minimum 12 seats', capturedAt: body.data.impact.current.capturedAt },
        }
        await route.fulfill({ response, json: body })
      })
      await page.getByRole('button', { name: 'Refresh report' }).click()
      if (direct) {
        const buttons = report.getByRole('button', { name: 'Show screenshot', exact: true })
        const images = report.getByRole('img', { name: /Pricing page captured for Pro/ })
        await buttons.first().click()
        await images.first().waitFor()
        await buttons.first().click()
        await images.nth(1).waitFor()
      }
      const packaging = report.getByRole('region', { name: 'Packaging findings' })
      await packaging.getByText('Minimum 5 seats', { exact: true }).waitFor()
      await packaging.getByText('Minimum 12 seats', { exact: true }).waitFor()
      await packaging.getByText('The current minimum exceeds your seat count.').waitFor()
      await page.getByText('Captured page text').click()
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await audit()
      const settings = page.getByRole('region', { name: 'Watch settings' })
      await settings.getByText('Contract and renewal', { exact: true }).click()
      await settings.getByLabel('Contracted rate per seat').fill('25')
      await settings.getByLabel('Renewal date', { exact: true }).fill(dateAhead(20))
      await settings.getByLabel('Cancellation notice deadline').fill(dateAhead(10))
      await settings.getByRole('button', { name: 'Save contract' }).click()
      await settings.getByText(/Contract \$250\.00 · listed \$390\.00.*\+\$140\.00\/month/).waitFor()
      await settings.getByText('Scheduled checks', { exact: true }).click()
      await settings.getByLabel('Frequency').selectOption('weekly')
      await settings.getByLabel('Local hour (0–23)', { exact: true }).fill(String((new Date().getUTCHours() + 2) % 24))
      await settings.getByLabel('Check timezone').fill('UTC')
      await settings.getByRole('button', { name: 'Save schedule' }).click()
      await settings.getByRole('button', { name: 'Clear schedule' }).waitFor()
      await settings.getByText('Price alert rules', { exact: true }).click()
      await settings.getByLabel('Decreases', { exact: true }).uncheck()
      await settings.getByLabel('Minimum team cost change (USD)').fill('125')
      await settings.getByRole('button', { name: 'Save alert rule' }).click()
      await settings.getByRole('button', { name: 'Restore default' }).waitFor()
      const savedBrowserWatch = (await ok('listWatches')).find(item => item.vendor === 'Alder Desk')
      assert.equal(savedBrowserWatch.contract.priceMinor, 2500)
      assert.equal(savedBrowserWatch.schedule.frequency, 'weekly')
      assert.equal(savedBrowserWatch.alertRule.minAmountMinor, 12500)
      assert.equal(savedBrowserWatch.alertRule.decreases, false)

      const otherPlan = await ok('createWatch', { ...input, vendor: 'Fixture alternative' })
      const ready = await ok('captureBaseline', { id: otherPlan.id, revision: otherPlan.revision })
      await ok('confirmBaseline', { id: otherPlan.id, revision: ready.revision, snapshotId: ready.candidate.snapshotId })
      await page.reload()
      const portfolio = page.getByRole('region', { name: 'Portfolio' })
      await portfolio.getByRole('button', { name: 'Load portfolio' }).click()
      await portfolio.getByText(/USD · \+\$100\.00\/month across 1 watch/).waitFor()
      await portfolio.getByText(/Notice by/).waitFor()
      await portfolio.getByRole('button', { name: 'Alder Desk report' }).click()
      await page.getByText('+$100.00/month for 10 seats', { exact: true }).waitFor()

      const comparison = page.getByRole('region', { name: 'Compare plans' })
      await comparison.getByRole('checkbox', { name: 'Alder Desk · Pro' }).check()
      await comparison.getByRole('checkbox', { name: 'Fixture alternative · Pro' }).check()
      await comparison.getByLabel('Comparison seats').fill('25')
      await comparison.getByLabel('Must-have features').fill('SSO')
      await comparison.getByRole('button', { name: 'Compare selected watches' }).click()
      await comparison.getByRole('heading', { name: /Listed prices at 25 seats/ }).waitFor()
      assert.equal(await comparison.getByText('$975.00/month', { exact: true }).count(), 2)
      assert.equal(await comparison.getByText('SSO · unknown', { exact: true }).count(), 2)
      await audit()
      console.log('Axe, keyboard focus, mobile, watch settings, portfolio, and comparison passed.')
      console.log('Browser signed-out, setup, baseline, report, history reload and mobile width passed.')
    } finally {
      await browser.close()
    }
  }
  console.log('Worker/API baseline, comparison, ownership, history, single email and Exa passed with mock providers.')
} finally {
  await runtime.dispose()
}
