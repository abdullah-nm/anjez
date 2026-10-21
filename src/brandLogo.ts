export async function fetchBrandLogoObjectUrl() {
  const response = await fetch('/api/brand/logo', { credentials: 'include' })
  if (!response.ok) return null
  const blob = await response.blob()
  if (!blob.size) return null
  return URL.createObjectURL(blob)
}
