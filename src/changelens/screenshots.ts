import type { ScreenshotImage } from './contract'

const limit = 1024 * 1024
const png = [137, 80, 78, 71, 13, 10, 26, 10]
const jpeg = [255, 216, 255]

export async function downloadScreenshot(input: unknown): Promise<ScreenshotImage | undefined> {
  if (typeof input !== 'string' || input.length > 4096) return
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' ||
        url.port || url.username || url.password) return
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    const type = response.headers.get('content-type')?.split(';')[0]
    if (!response.ok || !response.body) return
    if ((type !== 'image/png' && type !== 'image/jpeg') ||
      Number(response.headers.get('content-length')) > limit) {
      await response.body.cancel()
      return
    }

    const reader = response.body.getReader()
    const bytes = new Uint8Array(limit)
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (size + value.length > limit) {
        await reader.cancel()
        return
      }
      bytes.set(value, size)
      size += value.length
    }
    const signature = type === 'image/png' ? png : jpeg
    if (size <= signature.length || !signature.every((byte, index) => bytes[index] === byte)) return

    const parts: string[] = []
    for (let offset = 0; offset < size; offset += 8192) {
      parts.push(String.fromCharCode(...bytes.subarray(offset, Math.min(size, offset + 8192))))
    }
    return { type, base64: btoa(parts.join('')) }
  } catch {
    return undefined
  }
}
