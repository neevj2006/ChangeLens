import { getAuthToken } from 'deepspace'
import type { ChangeLensActions, Result } from './contract'

export async function callAction<K extends keyof ChangeLensActions>(
  name: K, input: ChangeLensActions[K][0],
): Promise<ChangeLensActions[K][1]> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in to continue.')
  const response = await fetch('/api/actions/' + name, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const result = await response.json().catch(() => null) as Result<ChangeLensActions[K][1]> | null
  if (!response.ok || !result?.success) {
    throw new Error(result?.success === false ? result.error : response.status === 401
      ? 'Sign in to continue.' : 'The request could not be completed.')
  }
  return result.data
}
