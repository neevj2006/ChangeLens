import { z } from 'zod'
import type { ActionTools } from 'deepspace/worker'
import type { Alert, Context, Impact, Watch } from './contract'

const sendResult = z.object({ id: z.string().min(1) })

export async function sendAlert(tools: ActionTools, watch: Watch, impact: Impact, recipient: string): Promise<Alert> {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: impact.current.currency })
  const amount = (minor: number) => money.format(minor / 100)
  const delta = (impact.deltaMinor > 0 ? '+' : '') + amount(impact.deltaMinor)
  try {
    const response = await tools.integration('email/send', {
      to: recipient,
      subject: 'ChangeLens: listed price change for ' + watch.vendor.replace(/[\r\n]/g, ' '),
      text: [
        watch.vendor + ' / ' + watch.plan,
        amount(impact.oldTotalMinor) + ' → ' + amount(impact.newTotalMinor) + ' per ' + watch.cadence +
          ' (' + delta + '/' + watch.cadence + ') for ' + impact.seats + ' seats.',
        'Previous evidence:\n' + impact.old.excerpt, 'Current evidence:\n' + impact.current.excerpt,
        impact.current.sourceUrl, ...impact.assumptions,
      ].join('\n\n'),
    })
    if (response.success && sendResult.safeParse(response.data).success) return { state: 'accepted' }
    if (!response.success && (response.code === 'insufficient_credits' ||
      [400, 401, 403, 422, 429].includes(response.status ?? 0))) return { state: 'failed' }
  } catch {
    // The provider may have accepted a request whose response was lost.
  }
  return { state: 'unknown' }
}

export function cleanContext(context: Context): Context {
  if (context.state !== 'found') return context
  const sources = context.sources.filter(source => source.title.trim() !== '')
  return sources.length ? { state: 'found', sources } : { state: 'empty' }
}

const results = z.object({ results: z.array(z.object({
  title: z.string(),
  url: z.url({ protocol: /^https?$/ }),
  publishedDate: z.string().nullable(),
  text: z.string().optional().nullable(),
})) })

export async function searchContext(tools: ActionTools, watch: Watch): Promise<Context> {
  try {
    const response = await tools.integration('exa/search', {
      query: watch.vendor + ' ' + watch.plan + ' subscription pricing price increase change',
      numResults: 5, type: 'auto', contents: { text: { maxCharacters: 1000 } },
    })
    const parsed = results.safeParse(response.success ? response.data : null)
    if (!parsed.success) return { state: 'failed' }
    const vendor = watch.vendor.toLowerCase()
    const sources = parsed.data.results.filter(item => {
      if (!item.title.trim() || item.url === watch.url) return false
      const copy = (item.title + ' ' + (item.text ?? '')).toLowerCase()
      return copy.includes(vendor) && /\bpric(?:e|es|ing)\b.{0,90}\b(?:increas\w*|decreas\w*|chang\w*|updat\w*|revis\w*)\b|\b(?:increas\w*|decreas\w*|chang\w*|updat\w*|revis\w*)\b.{0,90}\bpric(?:e|es|ing)\b/.test(copy)
    }).slice(0, 3).map(item => ({ title: item.title.trim(), url: item.url, publishedAt: item.publishedDate }))
    return sources.length ? { state: 'found', sources } : { state: 'empty' }
  } catch {
    return { state: 'failed' }
  }
}


