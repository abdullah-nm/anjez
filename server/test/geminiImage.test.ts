import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiImageClient } from '../platform/gemini.ts'

afterEach(() => vi.unstubAllGlobals())

describe('Gemini image generation', () => {
  it('uses generateContent and returns inline image data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'cG5n' } }] } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new GeminiImageClient('test-key').generatePngDataUrl('abstract print background')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/')
    expect(url).toContain(':generateContent')
    expect(url).not.toContain('openai')
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-key')
    expect(result).toBe('data:image/png;base64,cG5n')
  })

  it('gives a safe actionable message when Google rejects image access', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'secret api key is invalid' } }),
      { status: 403 },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new GeminiImageClient('test-key').generatePngDataUrl('abstract background'))
      .rejects.toThrow('تحقق من صلاحية GEMINI_API_KEY وإتاحة نموذج الصور للمشروع.')
    await expect(new GeminiImageClient('test-key').generatePngDataUrl('abstract background'))
      .rejects.not.toThrow('secret api key')
  })
})
