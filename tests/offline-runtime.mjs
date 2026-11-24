import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { exportSPKI, generateKeyPair, SignJWT } from 'jose'
import { chromium } from '@playwright/test'

const config = JSON.parse(await readFile('dist/changelens/wrangler.json', 'utf8'))
const issuer = 'https://changelens-offline.test'
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
    CHANGELENS_ENABLE_EMAIL: 'true', CHANGELENS_ENABLE_EXA: 'true',
  },
  outboundService: async request => {
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
  deliveryRejected = true
  watch = await ok('checkWatch', key())
  const rejectedId = watch.latest.id
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
  watch = await ok('updateWatch', { ...input, ...key(), plan: 'Team' })
  assert.equal(watch.baseline, null)
  assert.equal(watch.status, 'unarmed')
  await ok('removeWatch', key())
  assert.deepEqual(await ok('listWatches'), [])

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
      await page.reload()
      await page.getByRole('button', { name: /Alder Desk · Pro.*Price changed/ }).click()
      await page.getByText('+$100.00/month for 10 seats', { exact: true }).waitFor()
      await page.route('**/api/actions/getCheck', async route => {
        const response = await route.fetch()
        const body = await response.json()
        body.data.impact.current.excerpt += '\n' + 'x'.repeat(500)
        body.data.snapshot.markdown += '\n' + 'y'.repeat(500)
        await route.fulfill({ response, json: body })
      })
      await page.getByRole('button', { name: 'Refresh report' }).click()
      await page.getByText('Captured page text').click()
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await audit()
      console.log('Axe, keyboard focus, and mobile checks passed.')
      console.log('Browser signed-out, setup, baseline, report, history reload and mobile width passed.')
    } finally {
      await browser.close()
    }
  }
  console.log('Worker/API baseline, comparison, ownership, history, single email and Exa passed with mock providers.')
} finally {
  await runtime.dispose()
}












