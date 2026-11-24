import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capturePage, pinnedAddress, publicUrl } from './pricing-egress.mjs'

const address = { address: '93.184.216.34', family: 4 }
const page = 'https://example.org/pricing'

test('connects to a selected public address on each hop and preserves pricing headings', async () => {
  const hops = []
  const result = await capturePage(page, {
    resolve: async () => [address],
    fetchPinned: async (url, destination) => {
      assert.deepEqual(destination, address)
      hops.push(url.host)
      return hops.length === 1 ? { status: 302, location: 'https://vendor.org/pricing' } : {
        status: 200, type: 'text/html', body: '<h3>Pro</h3><p>USD 29 per user/month</p><script>ignored()</script>',
      }
    },
  })
  assert.deepEqual(hops, ['example.org', 'vendor.org'])
  assert.equal(result.url, 'https://vendor.org/pricing')
  assert.equal(result.markdown, '### Pro\n\nUSD 29 per user/month')
})

test('rejects private answers, including mixed DNS, and rejects private redirect destinations', async () => {
  for (const ip of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '100.64.0.1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1']) {
    await assert.rejects(pinnedAddress('example.org', async () => [address, { address: ip, family: ip.includes(':') ? 6 : 4 }]))
  }
  let fetched = 0
  await assert.rejects(capturePage(page, {
    resolve: async host => host === 'example.org' ? [address] : [{ address: '10.0.0.1', family: 4 }],
    fetchPinned: async () => { fetched++; return { status: 302, location: 'https://private.example.net/' } },
  }))
  assert.equal(fetched, 1)
  for (const bad of ['http://0177.0.0.1', 'https://[::1]', 'file:///price', 'https://secret@example.org/', 'https://example.org:8080']) {
    assert.throws(() => publicUrl(bad))
  }
})

test('bounds redirects and rejects blocked pages, downgrade and unsupported media', async () => {
  const resolve = async () => [address]
  for (const response of [{ status: 403 }, { status: 200, type: 'image/svg+xml' }, { status: 302, location: 'http://example.org/' }]) {
    await assert.rejects(capturePage(page, { resolve, fetchPinned: async () => response }))
  }
  let fetched = 0
  await assert.rejects(capturePage(page, {
    resolve, fetchPinned: async () => ({ status: 302, location: '/loop/' + ++fetched }),
  }))
  assert.equal(fetched, 5)
})

test('rejects a snapshot that exceeds the Markdown input budget', async () => {
  await assert.rejects(capturePage(page, {
    resolve: async () => [address],
    fetchPinned: async () => ({ status: 200, type: 'text/markdown', body: 'X'.repeat(30_001) }),
  }), /response size/)
})
