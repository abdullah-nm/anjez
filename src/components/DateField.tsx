import { useI18n } from '../i18n'

export function DateField({
  value,
  onChange,
  required,
}: {
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  const { t, monthNames } = useI18n()
  const [year = '', month = '', day = ''] = value.split('-')
  const years = Array.from({ length: 8 }, (_, index) => new Date().getFullYear() - 1 + index)
  const days = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'))
  function write(nextYear: string, nextMonth: string, nextDay: string) {
    if (!nextYear && !nextMonth && !nextDay) {
      onChange('')
      return
    }
    if (nextYear && nextMonth && nextDay) onChange(`${nextYear}-${nextMonth}-${nextDay}`)
  }
  return (
    <span className="date-field" role="group" aria-label={t('dateAria')}>
      <select aria-label={t('dayAria')} required={required} value={day} onChange={(event) => write(year || String(years[1]), month || '01', event.target.value)}>
        <option value="">{t('dayAria')}</option>
        {days.map((item) => <option key={item} value={item}>{Number(item)}</option>)}
      </select>
      <select aria-label={t('monthAria')} required={required} value={month} onChange={(event) => write(year || String(years[1]), event.target.value, day || '01')}>
        <option value="">{t('monthAria')}</option>
        {monthNames().map((name, index) => {
          const valueMonth = String(index + 1).padStart(2, '0')
          return <option key={valueMonth} value={valueMonth}>{name}</option>
        })}
      </select>
      <select aria-label={t('yearAria')} required={required} value={year} onChange={(event) => write(event.target.value, month || '01', day || '01')}>
        <option value="">{t('yearAria')}</option>
        {years.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </span>
  )
}
