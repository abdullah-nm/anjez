import { afterEach, describe, expect, it, vi } from 'vitest'
import { alternateScenePrompt, generateAlternateBackground } from '../platform/alternateImage.ts'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22])

afterEach(() => vi.unstubAllGlobals())

describe('alternate print background', () => {
  it('describes Founding Day as Diriyah instead of an abstract swirl', () => {
    const prompt = alternateScenePrompt({
      headline: '[تجريبي] يوم التأسيس 2027',
      eventTitle: 'يوم التأسيس',
      purpose: 'المراعي',
      instructions: 'جعل التصميم ليوم التاسيس',
      productName: 'بنر داخلي',
      primaryColor: '#1f2937',
      accentColor: '#d1d5db',
      tone: 'فاخر',
    })
    expect(prompt).toMatch(/Diriyah/)
    expect(prompt).not.toMatch(/abstract swirl|abstract print/)
    expect(prompt).toMatch(/no flag/i)
  })

  it('returns a data URL from a raster response and does not send a key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JPEG, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateAlternateBackground('abstract olive background', { width: 512, height: 768 })

    expect(result.startsWith('data:image/jpeg;base64,')).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const address = String(url)
    expect(address).toContain('https://image.pollinations.ai/prompt/')
    expect(address).toContain('width=512')
    expect(address).toContain('height=768')
    expect(address).not.toMatch(/key=|authorization/i)
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it('explains the free interval when the provider asks to wait', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(generateAlternateBackground('abstract background', { width: 256, height: 256 }))
      .rejects.toThrow('45 ثانية')
  })
})
