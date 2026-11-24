import { Activity, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-[radial-gradient(ellipse_at_top_right,#253745,transparent_55%)] px-5 sm:px-10">
        <header className="mx-auto flex h-20 max-w-6xl items-center gap-3 border-b border-border font-semibold">
          <span className="rounded-lg border border-input bg-card p-2"><Activity size={20} aria-hidden="true" /></span>
          {APP_NAME}
        </header>
        <main className="mx-auto grid max-w-6xl items-center gap-12 py-16 lg:min-h-[70vh] lg:grid-cols-[1fr_.85fr]">
          <div>
            <h1 className="max-w-xl text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">See what a price change costs your team</h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">Track vendor pricing, verify what changed, and see the impact at your seat count.</p>
            <Link to="/home" className="mt-8 inline-flex items-center gap-3 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground hover:opacity-90">
              Open ChangeLens <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <section aria-label="Example price report" className="space-y-6 rounded-3xl border border-input bg-card p-6 shadow-2xl sm:p-8">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Alder Desk · Pro</h2>
              <span className="rounded-full border border-input bg-muted px-3 py-1 text-sm">Example report</span>
            </header>
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-input bg-muted p-4 sm:p-5">
              <div><p className="text-sm text-muted-foreground">Previous total</p><p className="text-3xl font-semibold">$290</p></div>
              <div><p className="text-sm text-muted-foreground">Current total</p><p className="text-3xl font-semibold">$390</p></div>
            </div>
            <p className="text-xl font-semibold">+$100/month <span className="text-base font-normal text-muted-foreground">for 10 seats</span></p>
            <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
              <p><span className="block text-sm text-muted-foreground">Previous evidence</span>$29 per seat per month</p>
              <p><span className="block text-sm text-muted-foreground">Current evidence</span>$39 per seat per month</p>
            </div>
          </section>
        </main>
      </div>
    </>
  )
}
