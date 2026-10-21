import type { CompanyBrand, DesignDraft, PrintProduct } from '../types'

export function PrintPreview({
  brand,
  product,
  draft,
}: {
  brand: CompanyBrand
  product: PrintProduct
  draft: DesignDraft
}) {
  const logoSrc = brand.logoUrl || undefined
  if (draft.generatedImageDataUrl?.startsWith('data:image/svg')) {
    return <img className="preview-file" src={draft.generatedImageDataUrl} alt={`معاينة ${product.name}`} />
  }

  return (
    <div
      className={`preview preview-${product.kind}`}
      style={{
        background: brand.primaryColor,
        color: '#f7f3ec',
        borderColor: brand.accentColor,
      }}
    >
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
          alt={`شعار ${brand.companyName}`}
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      )}
      {draft.headline && <h3>{draft.headline}</h3>}
      {draft.subhead && draft.subhead !== draft.headline && (
        <p className="preview-sub">{draft.subhead}</p>
      )}
      <p className="preview-body">{draft.body}</p>
      <span className="preview-size">{draft.size}</span>
    </div>
  )
}
