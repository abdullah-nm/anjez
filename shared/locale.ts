export function localeFromStored(value: string | null | undefined) {
  return value === 'en' ? 'en' as const : 'ar' as const
}
