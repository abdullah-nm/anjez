import type { CompanyBrand, DesignDraft, PrintProduct } from '../types'
import { useI18n } from '../i18n'

function channel(hex: string, index: number) {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
}

function darken(hex: string, amount: number) {
  const mix = 1 - amount
  const value = [0, 1, 2]
    .map((index) => Math.round(channel(hex, index) * mix).toString(16).padStart(2, '0'))
    .join('')
  return `#${value}`
}

function readable(hex: string) {
  const linear = (value: number) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2))
  return luminance > 0.42 ? '#172033' : '#ffffff'
}

export function PrintPreview({
  brand,
  product,
  draft,
}: {
  brand: CompanyBrand
  product: PrintProduct
  draft: DesignDraft
}) {
  const { t, productLabel } = useI18n()
  const logoSrc = brand.logoUrl || undefined
  const productName = productLabel(product.id, product.name)
  if (draft.generatedImageDataUrl?.startsWith('data:image/svg')) {
    return <img className="preview-file" src={draft.generatedImageDataUrl} alt={t('previewAlt')} />
  }

  const primary = /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor) ? brand.primaryColor : '#1e3a5f'
  const accent = /^#[0-9a-fA-F]{6}$/.test(brand.accentColor) ? brand.accentColor : '#dbe4f0'
  const deep = darken(primary, 0.38)
  const footer = darken(primary, 0.5)
  const ink = readable(primary)
  const subtitle = draft.subhead.trim() || draft.body.trim() || t('designForPrint')

  return (
    <div
      className={`preview preview-${product.kind}`}
      style={{
        background: `linear-gradient(145deg, ${primary}, ${deep})`,
        color: ink,
        borderColor: accent,
      }}
    >
      <span className="preview-orb preview-orb-a" style={{ background: accent }} aria-hidden="true" />
      <span className="preview-orb preview-orb-b" style={{ background: accent }} aria-hidden="true" />
      {draft.generatedImageDataUrl && (
        <>
          <img className="preview-artwork" src={draft.generatedImageDataUrl} alt="" />
          <div className="preview-shade" aria-hidden="true" />
        </>
      )}
      {logoSrc && (
        <img
          className="preview-logo"
          src={logoSrc}
          alt={t('logoOf', { name: brand.companyName })}
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      )}
      <span className="preview-pill" style={{ background: accent, color: readable(accent) }}>{productName}</span>
      {draft.headline && (
        <h3 style={{ fontSize: draft.headline.length > 32 ? '1.05rem' : undefined }}>{draft.headline}</h3>
      )}
      <p className="preview-sub">{subtitle}</p>
      <span className="preview-rule" style={{ background: accent }} />
      <footer className="preview-foot" style={{ background: footer, color: readable(footer) }}>
        <span>{brand.companyName}</span>
        {draft.size && <span>{t('sizeLine', { size: draft.size })}</span>}
      </footer>
    </div>
  )
}
