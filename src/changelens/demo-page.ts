import { demoMarkdown } from './fixtures'

const escapeHtml = (text: string) => text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)

export function demoPricing(variant: string | undefined): Response {
  const name = variant ?? 'baseline'
  if (!Object.hasOwn(demoMarkdown, name)) return new Response('Unknown demo variant', { status: 404 })
  const markdown = demoMarkdown[name as keyof typeof demoMarkdown]
  if (!markdown) return new Response('Demo scrape failure', { status: 503 })
  const content = markdown.split('\n\n').map(line => {
    if (line.startsWith('## ')) return '<h2>' + escapeHtml(line.slice(3)) + '</h2>'
    if (line.startsWith('# ')) return '<h1>' + escapeHtml(line.slice(2)) + '</h1>'
    if (line.startsWith('**')) return '<p><strong>' + escapeHtml(line.slice(2, -2)) + '</strong></p>'
    return '<p>' + escapeHtml(line) + '</p>'
  }).join('\n')
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>Alder Desk pricing</title><main>' + content + '</main></html>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
