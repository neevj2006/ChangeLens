import { pathToFileURL } from 'node:url'
import { lookup } from 'node:dns/promises'
import { request as http } from 'node:http'
import { request as https } from 'node:https'
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import ipaddr from 'ipaddr.js'
import Turndown from 'turndown'
import gfm from 'turndown-plugin-gfm'

class UnsupportedPricingPage extends Error {}
const maxBytes = 2 * 1024 * 1024
const converter = new Turndown({ headingStyle: 'atx' })
converter.use(gfm.tables)
converter.remove(['script', 'style', 'noscript', 'iframe', 'svg'])

export function publicUrl(raw) {
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) ||
      /\.(?:local|internal|localhost|invalid|test|example|onion|home|arpa)$/i.test(url.hostname)) {
    throw new Error('Unsupported pricing URL.')
  }
  url.hash = ''
  return url
}

export async function pinnedAddress(host, resolve = lookup) {
  const rows = await resolve(host, { all: true, verbatim: true })
  if (!rows.length || rows.some(({ address }) => {
    const parsed = ipaddr.parse(address)
    return parsed.range() !== 'unicast' || (parsed.kind() === 'ipv6' && !parsed.match(ipaddr.parse('2000::'), 3))
  })) throw new Error('Pricing host did not resolve exclusively to public addresses.')
  return rows.find(row => row.family === 4) ?? rows[0]
}

function boundedLookup(host, options, resolve, signal) {
  return new Promise((complete, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => resolve(host, options)).then(complete, reject)
      .finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

export async function capturePage(raw, { resolve = lookup, fetchPinned = readPinned } = {}) {
  const signal = AbortSignal.timeout(12000)
  let url = publicUrl(raw)
  for (let hop = 0; hop < 5; hop++) {
    const address = await pinnedAddress(url.hostname, (host, options) => boundedLookup(host, options, resolve, signal))
    signal.throwIfAborted()
    const response = await fetchPinned(url, address, signal)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location) throw new Error('Missing redirect location.')
      const next = publicUrl(new URL(response.location, url).href)
      if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('HTTPS downgrade refused.')
      url = next
      continue
    }
    if (response.status === 200 && !/^(text\/html|text\/plain|text\/markdown)(?:;|$)/i.test(response.type ?? '')) {
      throw new UnsupportedPricingPage('Unsupported pricing response type.')
    }
    if (response.status !== 200) {
      throw new Error('Pricing page unavailable.')
    }
    const markdown = /^text\/html/i.test(response.type) ? converter.turndown(response.body) : response.body.trim()
    if (!markdown || markdown.length > 30000) throw new UnsupportedPricingPage('Unsupported pricing response size.')
    return { markdown, url: url.href }
  }
  throw new Error('Too many redirects.')
}

function readPinned(url, address, signal) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http)(url, {
      agent: false, signal, family: address.family,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [address])
        : callback(null, address.address, address.family),
      headers: { 'User-Agent': 'ChangeLens pricing watch', Accept: 'text/html,text/plain,text/markdown', 'Accept-Encoding': 'identity' },
    }, response => {
      const status = response.statusCode
      const type = response.headers['content-type']
      if (status !== 200) {
        response.destroy()
        resolve({ status, location: response.headers.location, type })
        return
      }
      const chunks = []
      let length = 0
      response.on('data', chunk => {
        length += chunk.length
        if (length > maxBytes) request.destroy(new UnsupportedPricingPage('Pricing response too large.'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve({ status, type, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', reject)
    request.end()
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.CHANGELENS_EGRESS_TOKEN
  if (!token || token.length < 32) throw new Error('Set CHANGELENS_EGRESS_TOKEN.')
  const expected = Buffer.from('Bearer ' + token)
  createServer(async (req, res) => {
    const received = Buffer.from(req.headers.authorization ?? '')
    if (req.method !== 'POST' || req.url !== '/capture' ||
        received.length !== expected.length || !timingSafeEqual(expected, received)) {
      res.writeHead(404).end()
      return
    }
    let input = ''
    try {
      for await (const chunk of req) {
        input += chunk
        if (input.length > 2048) throw new Error('Request too large.')
      }
      const result = await capturePage(JSON.parse(input).url)
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(result))
    } catch (error) {
      if (error instanceof UnsupportedPricingPage) {
        res.writeHead(415, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify({ code: 'unsupported_page' }))
      } else res.writeHead(422).end()
    }
  }).listen(Number(process.env.PORT ?? 8788), process.env.HOST ?? '127.0.0.1')
}
