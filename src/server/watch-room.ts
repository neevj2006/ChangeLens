import { lookupOwn } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { ScreenshotImage } from '../changelens/contract'
import { actions, runScheduled } from '../actions'
import { createActionTools } from './action-routes'

type OwnerRequest = { name: string; userId: string; callerJwt: string; params: Record<string, unknown>; verifiedEmail?: string }
const queuePrefix = 'monitor:'
const dayMs = 86_400_000

export class WatchRoom {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private state: DurableObjectState, private env: Env) {}

  private serialize<T>(task: () => Promise<T>, followups: (() => Promise<unknown>)[] = []) {
    const run = this.tail.then(task)
    this.tail = run.then(async () => {
      for (const followup of followups) await followup()
    }).catch(() => undefined)
    this.state.waitUntil(this.tail)
    return run
  }

  private context(request: OwnerRequest, followups: (() => Promise<unknown>)[]) {
    const { userId, callerJwt, params, verifiedEmail } = request
    return {
      userId, callerJwt, params, env: this.env, tools: createActionTools(this.env, userId, callerJwt),
      screenshots: {
        get: (key: string) => this.state.storage.get<ScreenshotImage>(key),
        put: (key: string, image: ScreenshotImage) => this.state.storage.put(key, image),
        remove: async (prefix: string) => {
          const keys = [...(await this.state.storage.list({ prefix })).keys()]
          if (keys.length) await this.state.storage.delete(keys)
        },
      },
      reserve: async (kind?: 'reminder' | 'scheduled') => {
        const rooms = this.env.WATCH_ROOMS
        const room = rooms.get(rooms.idFromName('changelens:provider-budget'))
        const response = await room.fetch('https://internal/budget', { method: 'POST', body: JSON.stringify({ userId, kind }) })
        return response.status === 204
      },
      queue: async (id: string, at: number | null, onlyEarlier = false) => {
        const key = queuePrefix + id
        if (onlyEarlier) {
          const existing = await this.state.storage.get<{ at: number }>(key)
          if (existing && (at === null || existing.at <= at)) return
        }
        if (at === null) await this.state.storage.delete(key)
        else await this.state.storage.put(key, { userId, at })
        await this.armNext()
      },
      verifiedEmail, defer: (task: () => Promise<unknown>) => followups.push(task),
    }
  }

  private async armNext() {
    if (this.env.CHANGELENS_ENABLE_SCHEDULES !== 'true') return
    const entries = await this.state.storage.list<{ userId: string; at: number }>({ prefix: queuePrefix })
    const earliest = Math.min(...Array.from(entries.values(), entry => entry.at))
    if (Number.isFinite(earliest)) await this.state.storage.setAlarm(Math.max(Date.now() + 1_000, earliest))
    else await this.state.storage.deleteAlarm()
  }

  async alarm() {
    if (this.env.CHANGELENS_ENABLE_SCHEDULES !== 'true') return
    await this.serialize(async () => {
      const storage = this.state.storage
      const now = Date.now()
      const entries = await storage.list<{ userId: string; at: number }>({ prefix: queuePrefix })
      const due = [...entries].filter(([, entry]) => entry.at <= now).sort((a, b) => a[1].at - b[1].at)
      for (const [key, entry] of due.slice(0, 3)) {
        const followups: (() => Promise<unknown>)[] = []
        const context = this.context({ ...entry, name: '', callerJwt: '', params: {} }, followups)
        try {
          await runScheduled(context, key.slice(queuePrefix.length), now)
          for (const task of followups) await task()
        } catch {
          const pending = await storage.get<{ at: number }>(key)
          if (pending && pending.at <= now) await storage.put(key, { ...entry, at: now + 60_000 })
        }
      }
      await this.armNext()
    })
  }

  private async reserveBudget({ userId, kind }: { userId: string; kind?: 'reminder' | 'scheduled' }) {
    const testUntil = this.env.CHANGELENS_TEST_UNTIL
    if (testUntil && (!(Date.parse(testUntil) > Date.now()) || userId !== this.env.OWNER_USER_ID)) {
      return new Response(null, { status: 429 })
    }
    if (!userId || userId.length > 200) return new Response(null, { status: 400 })
    if (!testUntil && this.env.CHANGELENS_UNCAPPED === 'true') return new Response(null, { status: 204 })
    const accountLimit = Number(this.env.CHANGELENS_ACCOUNT_DAILY_LIMIT)
    const appLimit = Number(this.env.CHANGELENS_APP_DAILY_LIMIT)
    if (!Number.isSafeInteger(accountLimit) || !Number.isSafeInteger(appLimit) ||
        accountLimit < 1 || appLimit < 1 || appLimit > 1_000 || accountLimit > appLimit) {
      return new Response(null, { status: 429 })
    }
    const day = testUntil ?? Math.floor(Date.now() / dayMs)
    const allowed = await this.state.storage.transaction(async tx => {
      const previous = await tx.get<{ day: number | string; total: number; reminder?: boolean; scheduled?: boolean; byUser: Record<string, number> }>('budget')
      const budget = previous?.day === day ? previous : { day, total: 0, byUser: {} }
      const key = 'account:' + userId
      const used = budget.byUser[key] ?? 0
      if (budget.total >= appLimit || used >= accountLimit ||
          (testUntil && kind && budget[kind])) return false
      if (testUntil && kind) budget[kind] = true
      budget.total++
      budget.byUser[key] = used + 1
      await tx.put('budget', budget)
      return true
    })
    return new Response(null, { status: allowed ? 204 : 429 })
  }

  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (path === '/budget') return this.reserveBudget(await request.json())
    if (path !== '/action') return new Response(null, { status: 404 })
    const payload = await request.json<OwnerRequest>()
    const { name } = payload
    const action = lookupOwn(actions, name)
    if (!action) return new Response(null, { status: 404 })
    const followups: (() => Promise<unknown>)[] = []
    const context = this.context(payload, followups)
    const read = ['getWatch', 'getCheck', 'listChecks', 'listWatches', 'getScreenshot', 'getPortfolio', 'compareWatches', 'getCapabilities'].includes(name)
    try {
      if (read && this.env.CHANGELENS_ENABLE_SCHEDULES === 'true' && await this.state.storage.getAlarm() === null) {
        await this.armNext()
      }
      const result = read ? await action(context) : await this.serialize(() => action(context), followups)
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
    } catch {
      return Response.json({ success: false, code: 'storage_error', error: 'ChangeLens could not complete the request.' })
    }
  }
}
