import { lookupOwn } from 'deepspace/worker'
import type { Env } from '../../worker'
import { actions } from '../actions'
import { createActionTools } from './action-routes'

export class WatchRoom {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request) {
    const { name, userId, callerJwt, params, verifiedEmail } = await request.json<{
      name: string; userId: string; callerJwt: string; params: Record<string, unknown>; verifiedEmail?: string
    }>()
    const action = lookupOwn(actions, name)
    if (!action) return new Response(null, { status: 404 })
    const tasks: (() => Promise<unknown>)[] = []
    const context = {
      userId, callerJwt, params, env: this.env, tools: createActionTools(this.env, userId, callerJwt),
      verifiedEmail, defer: (task: () => Promise<unknown>) => tasks.push(task),
    }
    // Reads can show the saved report while its independent follow-ups are running.
    if (name === 'getWatch' || name === 'getCheck' || name === 'listChecks' || name === 'listWatches') {
      try {
        return Response.json(await action(context))
      } catch {
        return Response.json({ success: false, code: 'storage_error', error: 'ChangeLens could not load the data.' })
      }
    }
    const run = this.tail.then(() => action(context))
    this.tail = run.then(async () => {
      for (const task of tasks) await task()
    }).catch(() => undefined)
    this.state.waitUntil(this.tail)
    try {
      return Response.json(await run)
    } catch {
      return Response.json({ success: false, code: 'storage_error', error: 'ChangeLens could not complete the request.' })
    }
  }
}


