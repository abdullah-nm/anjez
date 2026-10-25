import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CITY_NAMES } from '../../shared/cities.ts'
import { eventById, productById, products } from '../data'
import { PrintPreview } from '../components/PrintPreview'
import { DateField } from '../components/DateField'
import { useI18n } from '../i18n'
import { useStore } from '../store'

function defaultDelivery(leadDays: number, eventDate?: string) {
  if (eventDate) return eventDate
  const next = new Date()
  next.setDate(next.getDate() + leadDays)
  return next.toISOString().slice(0, 10)
}

export function Order() {
  const { brand, draft, placeOrder } = useStore()
  const { t, productLabel, formatMoney, formatNumber, cityLabel } = useI18n()
  const navigate = useNavigate()
  const product = productById(draft.productId) ?? products[0]
  const catalogEvent = eventById(draft.eventId)
  const eventTitle = draft.eventTitle || catalogEvent?.title || t('noOccasion')
  const [quantity, setQuantity] = useState(100)
  const [deliveryDate, setDeliveryDate] = useState(() => defaultDelivery(product.leadDays, catalogEvent?.date))
  const [city, setCity] = useState('')
  const [address, setAddress] = useState(brand.city || '')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(formEvent: FormEvent) {
    formEvent.preventDefault()
    setError(null)
    const order = await placeOrder({
      productId: product.id,
      eventId: draft.eventId,
      size: draft.size,
      quantity,
      deliveryDate,
      deliveryCity: city.trim(),
      address,
      notes,
      headline: draft.headline,
      subhead: draft.subhead,
      body: draft.body,
      eventTitle,
      designId: draft.savedDesignId,
    })
    if (!order) {
      setError(t('orderFailed'))
      return
    }
    navigate(`/order/${order.id}`)
  }

  return (
    <form className="studio" onSubmit={onSubmit}>
      <section className="stack">
        <div className="section-head">
          <h1>{t('orderTitle')}</h1>
        </div>

        <p>
          {t('productLine', { product: productLabel(product.id, product.name), size: draft.size, event: eventTitle })}
        </p>
        {!draft.generatedImageDataUrl && (
          <p className="notice">
            {t('noPreview')} <Link to="/studio">{t('backStudio')}</Link>
          </p>
        )}
        <p className="preview-caption">{t('previewNotFile')}</p>

        <label className="field">
          <span>{t('quantity')}</span>
          <input
            type="number"
            min={10}
            step={10}
            required
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>{t('deliveryDate')}</span>
          <DateField required value={deliveryDate} onChange={setDeliveryDate} />
        </label>
        <label className="field">
          <span>{t('deliveryCity')}</span>
          <input
            required
            list="delivery-cities"
            maxLength={80}
            value={city}
            placeholder={t('cityExample')}
            onChange={(e) => setCity(e.target.value)}
          />
          <datalist id="delivery-cities">
            {CITY_NAMES.map((name) => <option key={name} value={cityLabel(name)} />)}
          </datalist>
        </label>
        <label className="field">
          <span>{t('address')}</span>
          <textarea
            required
            rows={3}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('printNotes')}</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('notesExample')}
          />
        </label>

        <p className="muted">
          {t('catalogPrice', { price: formatMoney(product.fromPrice) })} {t('leadDays', { days: formatNumber(product.leadDays) })}
        </p>

        <button type="submit" className="btn btn-primary">
          {t('sendOrder')}
        </button>
        {error && <p className="notice err">{error}</p>}
      </section>

      <aside className="preview-panel card stack">
        <p className="eyebrow">{t('screenPreview')}</p>
        <PrintPreview brand={brand} product={product} draft={draft} />
        <p className="muted">{t('orderStored')}</p>
      </aside>
    </form>
  )
}
