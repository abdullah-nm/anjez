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
      <p className="preview-kicker" style={{ color: brand.accentColor }}>
        {brand.companyName}
      </p>
      <h3>{draft.headline || 'عنوان التصميم'}</h3>
      <p className="preview-sub">{draft.subhead}</p>
      <p className="preview-body">{draft.body}</p>
      <span className="preview-size">{draft.size}</span>
    </div>
  )
}
