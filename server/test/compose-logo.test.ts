import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeDesign } from '../platform/compose.ts'
import { GeminiImageClient } from '../platform/gemini.ts'
import { LocalObjectStorage, logoBelongsToCompany } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { MissingProviderError } from '../lib/errors.ts'
import { ScriptedLlm } from './hashingEmbeddings.ts'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function brand(companyId: string, logoPath: string | null = null, logoMime: string | null = null) {
  return {
    companyId,
    companyName: companyId === 'company_almarai' ? 'المراعي' : 'قمم',
    industry: 'ضيافة',
    description: '',
    language: 'ar' as const,
    contactName: 'ناصر الحربي',
    email: 'nasser@almarai.com',
    phone: '',
    city: '',
    primaryColor: '#1f2937',
    accentColor: '#d1d5db',
    slogan: '',
    tone: 'فاخر',
    logoPath,
    logoMime,
    updatedAt: new Date().toISOString(),
  }
}

function payload() {
  return {
    eventId: null,
    eventTitle: 'اليوم الوطني',
    productId: 'prd-poster',
    productName: 'ملصقات',
    purpose: 'تهنئة',
    audience: 'الضيوف',
    language: 'ar' as const,
    style: 'فاخر',
    dimensions: 'square',
    instructions: 'مساحة للنص',
    content: 'المراعي',
  }
}

describe('design compose uses the session company logo', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.()
  })

  it('sends the stored company logo to Gemini and overlays the original file in SVG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-logo-'))
    const storage = new LocalObjectStorage(join(dir, 'up'))
    const platform = new PlatformStore(join(dir, 'p.sqlite'))
    cleanups.push(() => platform.close())
    const saved = storage.saveLogo('company_almarai', 'image/png', PNG)
    const sent: Array<{ mimeType: string; data: string } | null | undefined> = []
    const geminiImage = {
      configured: () => true,
      generatePngDataUrl: async (_prompt: string, reference?: { mimeType: string; data: string } | null) => {
        sent.push(reference)
        return 'data:image/png;base64,QkFH'
      },
    }
    const design = await composeDesign({
      platform,
      storage,
      brand: brand('company_almarai', saved.path, saved.mime),
      userId: 'user_almarai_admin',
      companyId: 'company_almarai',
      llm: new ScriptedLlm(),
      geminiText: { configured: () => false, generateJson: async () => '' },
      geminiImage,
      payload: payload(),
    })
    expect(sent[0]?.mimeType).toBe('image/png')
    expect(sent[0]?.data).toBe(PNG.toString('base64'))
    expect(design.svg).toContain(PNG.toString('base64'))
    expect(design.svg).toContain('data:image/png;base64,QkFH')
    expect(design.backgroundKind).toBe('ai_bitmap_background')
    expect(design.backgroundNote).toContain('الملف الأصلي')
  })

  it('does not read another company logo path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-logo-'))
    const storage = new LocalObjectStorage(join(dir, 'up'))
    const saved = storage.saveLogo('company_almarai', 'image/png', PNG)
    expect(logoBelongsToCompany('company_qimam', saved.path)).toBe(false)
    const stolen = storage.readCompanyLogo('company_qimam', saved.path, 'image/png')
    expect(stolen.ok).toBe(false)
    if (!stolen.ok) expect(stolen.reason).toMatch(/لا يخص هذه الشركة/)
  })

  it('falls back to SVG when no logo is saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-logo-'))
    const storage = new LocalObjectStorage(join(dir, 'up'))
    const platform = new PlatformStore(join(dir, 'p.sqlite'))
    cleanups.push(() => platform.close())
    const design = await composeDesign({
      platform,
      storage,
      brand: brand('company_almarai'),
      userId: 'user_almarai_admin',
      companyId: 'company_almarai',
      llm: new ScriptedLlm(),
      geminiText: { configured: () => false, generateJson: async () => '' },
      geminiImage: {
        configured: () => true,
        generatePngDataUrl: async () => {
          throw new Error('Gemini must not run without a company logo file')
        },
      },
      payload: payload(),
    })
    expect(design.backgroundKind).toBe('branded_svg')
    expect(design.backgroundNote).toMatch(/لا يوجد شعار|تعذر/)
    expect(design.svg).not.toContain('data:image/png;base64,')
  })

  it('puts model-written lines on the poster instead of the description', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-logo-'))
    const storage = new LocalObjectStorage(join(dir, 'up'))
    const platform = new PlatformStore(join(dir, 'p.sqlite'))
    cleanups.push(() => platform.close())
    const saved = storage.saveLogo('company_almarai', 'image/png', PNG)
    const design = await composeDesign({
      platform,
      storage,
      brand: brand('company_almarai', saved.path, saved.mime),
      userId: 'user_almarai_admin',
      companyId: 'company_almarai',
      llm: new ScriptedLlm(),
      geminiText: {
        configured: () => true,
        generateJson: async () => '{"headline":"رمضان كريم","subhead":"كل عام وأنتم بخير"}',
      },
      geminiImage: {
        configured: () => true,
        generatePngDataUrl: async () => {
          throw new MissingProviderError('IMAGE_GENERATION_UNAVAILABLE', 'رفض Gemini الصورة.')
        },
      },
      alternateImage: async () => {
        throw new MissingProviderError('IMAGE_GENERATION_UNAVAILABLE', 'تعذر المزوّد البديل.')
      },
      payload: { ...payload(), eventTitle: 'رمضان', instructions: 'تهنئة رمضانية قصيرة للموظفين', content: '' },
    })
    expect(design.headline).toBe('رمضان كريم')
    expect(design.subhead).toBe('كل عام وأنتم بخير')
    expect(design.svg).toContain('رمضان كريم')
    expect(design.svg).not.toContain('تهنئة رمضانية قصيرة')
  })

  it('uses an alternate background when Gemini rejects the image and keeps the original logo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-logo-'))
    const storage = new LocalObjectStorage(join(dir, 'up'))
    const platform = new PlatformStore(join(dir, 'p.sqlite'))
    cleanups.push(() => platform.close())
    const saved = storage.saveLogo('company_almarai', 'image/png', PNG)
    const seen: string[] = []
    const design = await composeDesign({
      platform,
      storage,
      brand: brand('company_almarai', saved.path, saved.mime),
      userId: 'user_almarai_admin',
      companyId: 'company_almarai',
      llm: new ScriptedLlm(),
      geminiText: { configured: () => false, generateJson: async () => '' },
      geminiImage: {
        configured: () => true,
        generatePngDataUrl: async () => {
          throw new MissingProviderError('IMAGE_GENERATION_UNAVAILABLE', 'فشل Gemini (429). quota')
        },
      },
      alternateImage: async (prompt) => {
        seen.push(prompt)
        return 'data:image/jpeg;base64,QUxU'
      },
      payload: payload(),
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/National Day|palm/)
    expect(seen[0]).not.toMatch(/abstract print background/)
    expect(seen[0]).not.toContain(PNG.toString('base64'))
    expect(design.backgroundKind).toBe('ai_bitmap_background')
    expect(design.backgroundNote).toContain('مزود بديل')
    expect(design.backgroundNote).not.toMatch(/نجاح|openai/i)
    expect(design.svg).toContain('data:image/jpeg;base64,QUxU')
    expect(design.svg).toContain(PNG.toString('base64'))
  })

  it('keeps the original logo in SVG when Gemini rejects the image', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-logo-'))
    const storage = new LocalObjectStorage(join(dir, 'up'))
    const platform = new PlatformStore(join(dir, 'p.sqlite'))
    cleanups.push(() => platform.close())
    const saved = storage.saveLogo('company_almarai', 'image/png', PNG)
    const design = await composeDesign({
      platform,
      storage,
      brand: brand('company_almarai', saved.path, saved.mime),
      userId: 'user_almarai_admin',
      companyId: 'company_almarai',
      llm: new ScriptedLlm(),
      geminiText: { configured: () => false, generateJson: async () => '' },
      geminiImage: {
        configured: () => true,
        generatePngDataUrl: async () => {
          throw new MissingProviderError('IMAGE_GENERATION_UNAVAILABLE', 'رفض Gemini الصورة.')
        },
      },
      alternateImage: async () => {
        throw new MissingProviderError('IMAGE_GENERATION_UNAVAILABLE', 'تعذر المزوّد البديل.')
      },
      payload: payload(),
    })
    expect(design.backgroundKind).toBe('branded_svg')
    expect(design.svg).toContain(PNG.toString('base64'))
    expect(design.backgroundNote).toMatch(/تعذر توليد الخلفية/)
    expect(design.backgroundNote).not.toMatch(/نجاح|openai/i)
  })

  it('posts the logo as Gemini inlineData and does not put the API key in the JSON body', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.contents[0].parts.some((part: { inlineData?: { data?: string } }) => part.inlineData?.data === 'LOGO')).toBe(
        true,
      )
      expect(String(init?.body)).not.toContain('secret-key')
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'BG' } }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new GeminiImageClient('secret-key', 'gemini-2.5-flash-image')
      const result = await client.generatePngDataUrl('inspire from logo', { mimeType: 'image/png', data: 'LOGO' })
      expect(result).toContain('BG')
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
